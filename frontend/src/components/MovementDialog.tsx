import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, ClipboardCheck } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Field, Spinner } from "@/components/common"
import { ProductPicker, type PickedProduct } from "@/components/ProductPicker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { client, unwrap } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useWarehouses } from "@/lib/queries"
import { formatQty } from "@/lib/utils"

export type MovementKind = "entry" | "exit" | "transfer" | "adjustment"

const KIND_INFO: Record<MovementKind, { label: string; description: string }> = {
  entry: { label: "Entrada", description: "Compra avulsa, devolução, doação ou saldo inicial." },
  exit: { label: "Saída", description: "Consumo, requisição de setor, venda ou perda." },
  transfer: { label: "Transferência", description: "Move o saldo entre depósitos sem alterar o total." },
  adjustment: { label: "Ajuste", description: "Informe a quantidade contada; o sistema lança a diferença." },
}

function parseNumber(value: string) {
  const n = Number(value.replace(",", "."))
  return Number.isFinite(n) ? n : NaN
}

export function MovementDialog({
  open,
  onOpenChange,
  initialKind = "entry",
  initialProduct = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialKind?: MovementKind
  initialProduct?: PickedProduct | null
}) {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const { data: warehouses } = useWarehouses(true)
  // Quem abre o diálogo troca a `key` a cada abertura: o estado sempre nasce dos props.
  const [kind, setKind] = useState<MovementKind>(initialKind)
  const [product, setProduct] = useState<PickedProduct | null>(initialProduct)
  const [chosenWarehouse, setWarehouseId] = useState("")
  const [toWarehouseId, setToWarehouseId] = useState("")
  const [quantity, setQuantity] = useState("")
  const [unitCost, setUnitCost] = useState("")
  const [reference, setReference] = useState("")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState<string | null>(null)
  const warehouseId = chosenWarehouse || (warehouses?.length ? String(warehouses[0].id) : "")

  const save = useMutation({
    mutationFn: async () => {
      if (!product) throw new Error("Selecione um produto.")
      const qty = parseNumber(quantity)
      const base = { product_id: product.id }
      if (kind === "adjustment") {
        if (Number.isNaN(qty) || qty < 0) throw new Error("Informe a quantidade contada.")
        return unwrap(
          client.POST("/api/v1/stock/adjustments", {
            body: { ...base, warehouse_id: Number(warehouseId), counted_quantity: qty, notes },
          }),
        )
      }
      if (Number.isNaN(qty) || qty <= 0) throw new Error("Informe uma quantidade maior que zero.")
      if (kind === "transfer") {
        return unwrap(
          client.POST("/api/v1/stock/transfers", {
            body: {
              ...base,
              from_warehouse_id: Number(warehouseId),
              to_warehouse_id: Number(toWarehouseId),
              quantity: qty,
              notes: notes || null,
            },
          }),
        )
      }
      if (kind === "entry") {
        const cost = unitCost.trim() ? parseNumber(unitCost) : null
        return unwrap(
          client.POST("/api/v1/stock/entries", {
            body: {
              ...base,
              warehouse_id: Number(warehouseId),
              quantity: qty,
              unit_cost: cost,
              reference: reference || null,
              notes: notes || null,
            },
          }),
        )
      }
      return unwrap(
        client.POST("/api/v1/stock/exits", {
          body: { ...base, warehouse_id: Number(warehouseId), quantity: qty, reference: reference || null, notes: notes || null },
        }),
      )
    },
    onSuccess: (result) => {
      toast.success(result === null ? "Contagem confere com o sistema. Nada a ajustar." : `${KIND_INFO[kind].label} registrada.`)
      for (const key of ["movements", "products", "product", "kardex", "dashboard", "alerts", "forecast", "replenishment"]) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
      onOpenChange(false)
    },
    onError: (err) => setError(err.message),
  })

  const kinds: MovementKind[] = can("manager") ? ["entry", "exit", "transfer", "adjustment"] : ["entry", "exit", "transfer"]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova movimentação</DialogTitle>
          <DialogDescription>{KIND_INFO[kind].description}</DialogDescription>
        </DialogHeader>
        <form
          id="movement-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            save.mutate()
          }}
        >
          <Tabs value={kind} onValueChange={(v) => setKind(v as MovementKind)}>
            <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${kinds.length}, 1fr)` }}>
              {kinds.map((k) => (
                <TabsTrigger key={k} value={k} className="gap-1.5" aria-label={KIND_INFO[k].label}>
                  {k === "entry" && <ArrowDownToLine className="size-4" />}
                  {k === "exit" && <ArrowUpFromLine className="size-4" />}
                  {k === "transfer" && <ArrowRightLeft className="size-4" />}
                  {k === "adjustment" && <ClipboardCheck className="size-4" />}
                  <span className="hidden sm:inline">{KIND_INFO[k].label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Field label="Produto">
            <ProductPicker value={product} onChange={setProduct} />
          </Field>
          {product && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Saldo total atual: {formatQty(product.total_stock)} {product.unit}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={kind === "transfer" ? "Depósito de origem" : "Depósito"}>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {warehouses?.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.code} — {w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {kind === "transfer" ? (
              <Field label="Depósito de destino">
                <Select value={toWarehouseId} onValueChange={setToWarehouseId}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {warehouses?.filter((w) => String(w.id) !== warehouseId).map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.code} — {w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <Field label={kind === "adjustment" ? "Quantidade contada" : "Quantidade"} htmlFor="qty">
                <Input id="qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </Field>
            )}
          </div>

          {kind === "transfer" && (
            <Field label="Quantidade" htmlFor="qty-t">
              <Input id="qty-t" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
          )}

          {(kind === "entry" || kind === "exit") && (
            <div className="grid gap-4 sm:grid-cols-2">
              {kind === "entry" && (
                <Field label="Custo unitário (R$)" htmlFor="cost" hint="Opcional: atualiza o custo médio">
                  <Input id="cost" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
                </Field>
              )}
              <Field label="Referência" htmlFor="ref" hint={kind === "exit" ? "Ex.: requisição, setor" : "Ex.: nota fiscal"} className={kind === "exit" ? "sm:col-span-2" : undefined}>
                <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
              </Field>
            </div>
          )}

          <Field label={kind === "adjustment" ? "Motivo do ajuste" : "Observações"} htmlFor="notes">
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} required={kind === "adjustment"} minLength={kind === "adjustment" ? 3 : undefined} />
          </Field>

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="movement-form" disabled={save.isPending}>
            {save.isPending && <Spinner />} Registrar {KIND_INFO[kind].label.toLowerCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
