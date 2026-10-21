import { Printer, Search, X } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { EmptyState, Field, PageHeader, Spinner } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useDebounce } from "@/hooks/use-debounce"
import { errorMessage, fetchFile } from "@/lib/api"
import { useProducts, type Product } from "@/lib/queries"
import { openBlob } from "@/lib/utils"

export default function LabelsPage() {
  const [search, setSearch] = useState("")
  const q = useDebounce(search, 250)
  const products = useProducts({ q: q || undefined, page_size: 50, sort: "name" })
  const [selected, setSelected] = useState<Map<number, Product>>(new Map())
  const [copies, setCopies] = useState("1")
  const [layout, setLayout] = useState<"a4-3x8" | "a4-2x5">("a4-3x8")
  const [busy, setBusy] = useState(false)

  const toggle = (product: Product) =>
    setSelected((current) => {
      const next = new Map(current)
      if (next.has(product.id)) next.delete(product.id)
      else next.set(product.id, product)
      return next
    })

  const generate = async () => {
    setBusy(true)
    try {
      const blob = await fetchFile("/api/v1/labels/pdf", {
        method: "POST",
        body: { product_ids: [...selected.keys()], copies: Math.max(1, Number(copies) || 1), layout },
      })
      openBlob(blob)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const totalLabels = selected.size * Math.max(1, Number(copies) || 1)
  const perPage = layout === "a4-3x8" ? 24 : 10

  return (
    <>
      <PageHeader
        title="Etiquetas"
        description="Gere etiquetas em PDF com código de barras (Code 128) e QR Code para imprimir em folhas A4 adesivas."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Produtos</CardTitle>
            <CardDescription>Marque os produtos que receberão etiquetas.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative mb-3">
              <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar produto" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="max-h-[60dvh] divide-y overflow-y-auto rounded-md border">
              {products.data?.items.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-accent/40">
                  <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{p.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{p.sku} · {p.barcode ?? "sem EAN (usa o SKU)"}</p>
                  </div>
                </label>
              ))}
              {products.data?.items.length === 0 && <EmptyState title="Nenhum produto encontrado" />}
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Impressão</CardTitle>
            <CardDescription>
              {totalLabels} etiquetas · {Math.ceil(totalLabels / perPage) || 0} folha(s)
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Formato da folha">
              <Select value={layout} onValueChange={(v) => setLayout(v as typeof layout)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="a4-3x8">A4 — 24 etiquetas (70 × 37 mm)</SelectItem>
                  <SelectItem value="a4-2x5">A4 — 10 etiquetas (99 × 57 mm)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Cópias por produto" htmlFor="copies">
              <Input id="copies" type="number" min={1} max={50} value={copies} onChange={(e) => setCopies(e.target.value)} />
            </Field>
            {selected.size > 0 && (
              <ul className="grid max-h-56 gap-1 overflow-y-auto text-sm">
                {[...selected.values()].map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 rounded bg-muted px-2 py-1">
                    <span className="truncate">{p.name}</span>
                    <button type="button" onClick={() => toggle(p)} aria-label={`Remover ${p.name}`}>
                      <X className="size-3.5 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Button disabled={!selected.size || busy} onClick={generate}>
              {busy ? <Spinner /> : <Printer />} Gerar PDF
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
