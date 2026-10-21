import type { IScannerControls } from "@zxing/browser"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Camera, CameraOff, Keyboard, Minus, Plus, ScanBarcode } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"
import { StockBadge } from "@/components/badges"
import { EmptyState, PageHeader, Spinner } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { client, errorMessage, unwrap } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useWarehouses, type ProductDetail } from "@/lib/queries"
import { formatQty } from "@/lib/utils"

function beep(ok = true) {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = ok ? 880 : 220
    gain.gain.value = 0.08
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.12)
    navigator.vibrate?.(ok ? 60 : [60, 60, 60])
  } catch {
    /* sem áudio disponível */
  }
}

function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 })
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    setActive(false)
  }, [])

  const start = async () => {
    setError(null)
    if (!window.isSecureContext) {
      setError("A câmera só funciona em HTTPS ou em localhost. Use o leitor USB/digitação ou acesse pelo link seguro.")
      return
    }
    try {
      // Carregado sob demanda: a biblioteca de leitura só entra quando a câmera é usada.
      const { BrowserMultiFormatReader } = await import("@zxing/browser")
      const reader = new BrowserMultiFormatReader()
      controlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoRef.current!,
        (result) => {
          if (!result) return
          const code = result.getText()
          const now = Date.now()
          if (code === lastRef.current.code && now - lastRef.current.at < 2500) return
          lastRef.current = { code, at: now }
          onCode(code)
        },
      )
      setActive(true)
    } catch (err) {
      setError(`Não foi possível abrir a câmera: ${errorMessage(err)}`)
    }
  }

  useEffect(() => stop, [stop])

  return (
    <div className="grid gap-3">
      <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} className="size-full object-cover" muted playsInline />
        {active ? (
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-red-500/80" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
            <Camera className="size-8" />
            <p className="text-sm">Câmera desligada</p>
          </div>
        )}
      </div>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {active ? (
        <Button variant="outline" onClick={stop}><CameraOff /> Parar câmera</Button>
      ) : (
        <Button onClick={start}><Camera /> Ligar câmera</Button>
      )}
    </div>
  )
}

function KeyboardScanner({ onCode }: { onCode: (code: string) => void }) {
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onCode(value.trim())
        setValue("")
      }}
    >
      <p className="text-sm text-muted-foreground">
        Leitores de código de barras USB/Bluetooth funcionam como teclado: deixe o campo selecionado e faça a leitura.
      </p>
      <Input ref={inputRef} placeholder="Código de barras ou SKU" value={value} onChange={(e) => setValue(e.target.value)} className="h-12 font-mono text-lg" autoComplete="off" />
      <Button type="submit" variant="secondary"><ScanBarcode /> Buscar</Button>
    </form>
  )
}

export default function ScannerPage() {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const { data: warehouses } = useWarehouses(true)
  const [mode, setMode] = useState<"camera" | "keyboard">("keyboard")
  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const [kind, setKind] = useState<"exit" | "entry">("exit")
  const [chosenWarehouse, setWarehouseId] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [history, setHistory] = useState<{ sku: string; name: string; kind: string; qty: number; at: string }[]>([])

  const warehouseId = chosenWarehouse || (warehouses?.length ? String(warehouses[0].id) : "")

  const lookup = useCallback(async (code: string) => {
    setLooking(true)
    setLookupError(null)
    try {
      const found = await unwrap(client.GET("/api/v1/products/lookup", { params: { query: { code } } }))
      setProduct(found)
      setQuantity(1)
      const withStock = found.stock.find((s) => s.quantity > 0)
      if (withStock) setWarehouseId(String(withStock.warehouse_id))
      beep(true)
    } catch (err) {
      setProduct(null)
      setLookupError(errorMessage(err))
      beep(false)
    } finally {
      setLooking(false)
    }
  }, [])

  const register = useMutation({
    mutationFn: () => {
      const body = { product_id: product!.id, warehouse_id: Number(warehouseId), quantity, reference: "Scanner" }
      return kind === "exit"
        ? unwrap(client.POST("/api/v1/stock/exits", { body }))
        : unwrap(client.POST("/api/v1/stock/entries", { body }))
    },
    onSuccess: (movement) => {
      toast.success(`${kind === "exit" ? "Saída" : "Entrada"} de ${formatQty(quantity)} ${product!.unit} registrada.`)
      setHistory((h) => [{ sku: product!.sku, name: product!.name, kind, qty: quantity, at: movement.created_at }, ...h].slice(0, 10))
      queryClient.invalidateQueries({ queryKey: ["products"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      lookup(product!.barcode ?? product!.sku)
    },
  })

  return (
    <>
      <PageHeader title="Scanner" description="Leia o código de barras ou QR Code de um produto para consultar e movimentar na hora." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="keyboard"><Keyboard /> Leitor USB / digitação</TabsTrigger>
                <TabsTrigger value="camera"><Camera /> Câmera</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {mode === "camera" ? <CameraScanner onCode={lookup} /> : <KeyboardScanner onCode={lookup} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Produto lido</CardTitle>
            <CardDescription>{looking ? "Buscando..." : "O resultado aparece aqui."}</CardDescription>
          </CardHeader>
          <CardContent>
            {looking ? (
              <div className="flex justify-center py-10"><Spinner className="size-6" /></div>
            ) : product ? (
              <div className="grid gap-4">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/produtos/${product.id}`} className="text-lg font-semibold hover:underline">{product.name}</Link>
                    <StockBadge stock={product.total_stock} min={product.min_stock} />
                  </div>
                  <p className="font-mono text-sm text-muted-foreground">{product.sku}{product.barcode && ` · ${product.barcode}`}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  {product.stock.map((s) => (
                    <div key={s.warehouse_id} className="rounded-md border px-3 py-2">
                      <p className="text-xs text-muted-foreground">{s.warehouse_code}</p>
                      <p className="tabular font-semibold">{formatQty(s.quantity)} {product.unit}</p>
                    </div>
                  ))}
                </div>
                {can("operator") && (
                  <div className="grid gap-3 rounded-lg bg-muted/60 p-4">
                    <Tabs value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="exit">Saída</TabsTrigger>
                        <TabsTrigger value="entry">Entrada</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <Select value={warehouseId} onValueChange={setWarehouseId}>
                      <SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {warehouses?.map((w) => <SelectItem key={w.id} value={String(w.id)}>{w.code} — {w.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Diminuir"><Minus /></Button>
                      <Input className="tabular h-10 bg-background text-center text-lg" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(Number(e.target.value.replace(",", ".")) || 0)} />
                      <Button variant="outline" size="icon" onClick={() => setQuantity((q) => q + 1)} aria-label="Aumentar"><Plus /></Button>
                    </div>
                    <Button size="lg" disabled={quantity <= 0 || register.isPending} onClick={() => register.mutate()}>
                      {register.isPending && <Spinner />} Registrar {kind === "exit" ? "saída" : "entrada"}
                    </Button>
                  </div>
                )}
              </div>
            ) : lookupError ? (
              <EmptyState title="Código não encontrado" description={lookupError} />
            ) : (
              <EmptyState icon={<ScanBarcode />} title="Aguardando leitura" description="Use a câmera do celular ou um leitor de código de barras." />
            )}
          </CardContent>
        </Card>
      </div>

      {history.length > 0 && (
        <Card className="mt-6">
          <CardHeader><CardTitle>Lidos nesta sessão</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {history.map((h, i) => (
                <li key={i} className="flex justify-between gap-2 py-2">
                  <span className="truncate">{h.name} <span className="font-mono text-xs text-muted-foreground">{h.sku}</span></span>
                  <span className={h.kind === "exit" ? "text-destructive" : "text-success"}>{h.kind === "exit" ? "−" : "+"}{formatQty(h.qty)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  )
}
