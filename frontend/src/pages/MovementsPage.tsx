import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Download, Plus, Search } from "lucide-react"
import { useState } from "react"
import { Link, useSearchParams } from "react-router"
import { toast } from "sonner"
import { MovementBadge } from "@/components/badges"
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination } from "@/components/common"
import { MovementDialog, type MovementKind } from "@/components/MovementDialog"
import type { PickedProduct } from "@/components/ProductPicker"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useDebounce } from "@/hooks/use-debounce"
import { client, errorMessage, fetchFile, unwrap } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { MOVEMENT_LABELS, useWarehouses, type MovementType } from "@/lib/queries"
import { cn, downloadBlob, formatCurrency, formatDateTime, formatQty, todayISO } from "@/lib/utils"

const KINDS = new Set(["entry", "exit", "transfer", "adjustment"])

export default function MovementsPage() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const { data: warehouses } = useWarehouses()
  const [search, setSearch] = useState("")
  const q = useDebounce(search, 300)
  const [type, setType] = useState<string>("all")
  const [warehouse, setWarehouse] = useState<string>("all")
  const [dateFrom, setDateFrom] = useState(todayISO(-30))
  const [dateTo, setDateTo] = useState(todayISO())

  // A página volta para 1 sempre que um filtro muda (estado derivado, sem efeito).
  const filterKey = JSON.stringify([q, type, warehouse, dateFrom, dateTo])
  const [pageState, setPageState] = useState({ page: 1, key: filterKey })
  const page = pageState.key === filterKey ? pageState.page : 1
  const setPage = (next: number) => setPageState({ page: next, key: filterKey })

  // ?nova=entry&produto=12 abre o formulário já preenchido (links do dashboard e dos produtos)
  const nova = params.get("nova")
  const productParam = params.get("produto")
  const fromUrl = Boolean(nova && KINDS.has(nova))
  const urlProduct = useQuery({
    queryKey: ["product", Number(productParam)],
    queryFn: () =>
      unwrap(client.GET("/api/v1/products/{product_id}", { params: { path: { product_id: Number(productParam) } } })),
    enabled: fromUrl && Boolean(productParam),
  })
  const [manual, setManual] = useState({ open: false, key: 0 })
  const dialogOpen = manual.open || (fromUrl && (!productParam || !urlProduct.isLoading))
  const initialProduct: PickedProduct | null = fromUrl && !manual.open ? (urlProduct.data ?? null) : null

  const query = useQuery({
    queryKey: ["movements", { page, q, type, warehouse, dateFrom, dateTo }],
    queryFn: () =>
      unwrap(
        client.GET("/api/v1/stock/movements", {
          params: {
            query: {
              page,
              page_size: 25,
              q: q || undefined,
              type: type === "all" ? undefined : [type as MovementType],
              warehouse_id: warehouse === "all" ? undefined : Number(warehouse),
              date_from: dateFrom || undefined,
              date_to: dateTo || undefined,
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  })

  const exportReport = async (format: "xlsx" | "pdf" | "csv") => {
    try {
      const blob = await fetchFile("/api/v1/reports/export/movements", {
        query: {
          format,
          date_from: dateFrom,
          date_to: dateTo,
          warehouse_id: warehouse === "all" ? undefined : warehouse,
        },
      })
      downloadBlob(blob, `movimentacoes.${format}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <>
      <PageHeader
        title="Movimentações"
        description="Livro imutável de entradas, saídas, transferências e ajustes."
        actions={
          <>
            <Button variant="outline" onClick={() => exportReport("xlsx")}>
              <Download /> Excel
            </Button>
            <Button variant="outline" onClick={() => exportReport("pdf")}>
              <Download /> PDF
            </Button>
            {can("operator") && (
              <Button onClick={() => setManual((m) => ({ open: true, key: m.key + 1 }))}>
                <Plus /> Nova movimentação
              </Button>
            )}
          </>
        }
      />

      <Card className="gap-0 py-0">
        <div className="grid gap-3 border-b p-4 md:grid-cols-[1fr_auto_auto_auto_auto]">
          <div className="relative">
            <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input placeholder="SKU, produto ou referência" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-full md:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              {Object.entries(MOVEMENT_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={warehouse} onValueChange={setWarehouse}>
            <SelectTrigger className="w-full md:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os depósitos</SelectItem>
              {warehouses?.map((w) => (
                <SelectItem key={w.id} value={String(w.id)}>{w.code} — {w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" aria-label="Data inicial" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="date" aria-label="Data final" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>

        {query.error ? (
          <ErrorState error={query.error} onRetry={query.refetch} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="hidden md:table-cell">Depósito</TableHead>
                <TableHead className="text-right">Qtd.</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Saldo</TableHead>
                <TableHead className="hidden text-right xl:table-cell">Custo un.</TableHead>
                <TableHead className="hidden lg:table-cell">Referência</TableHead>
                <TableHead className="hidden xl:table-cell">Usuário</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <LoadingRows columns={9} />
              ) : query.data?.items.length ? (
                query.data.items.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="pl-4 text-sm whitespace-nowrap">{formatDateTime(m.created_at)}</TableCell>
                    <TableCell><MovementBadge type={m.type} /></TableCell>
                    <TableCell className="max-w-64">
                      <Link to={`/produtos/${m.product.id}`} className="block truncate font-medium hover:underline">{m.product.name}</Link>
                      <span className="font-mono text-xs text-muted-foreground">{m.product.sku}</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{m.warehouse.code}</TableCell>
                    <TableCell className={cn("tabular text-right font-medium whitespace-nowrap", m.quantity < 0 ? "text-destructive" : "text-success")}>
                      {m.quantity > 0 ? "+" : ""}{formatQty(m.quantity)} <span className="text-xs font-normal text-muted-foreground">{m.product.unit}</span>
                    </TableCell>
                    <TableCell className="tabular hidden text-right lg:table-cell">{formatQty(m.balance_after)}</TableCell>
                    <TableCell className="tabular hidden text-right xl:table-cell">{formatCurrency(m.unit_cost)}</TableCell>
                    <TableCell className="hidden max-w-40 truncate text-muted-foreground lg:table-cell" title={m.notes ?? undefined}>{m.reference ?? "—"}</TableCell>
                    <TableCell className="hidden text-muted-foreground xl:table-cell">{m.user?.name ?? "—"}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={9}>
                    <EmptyState title="Nenhuma movimentação no período" description="Ajuste os filtros ou registre uma movimentação." />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
        {query.data && query.data.total > 0 && (
          <Pagination page={query.data.page} pages={query.data.pages} total={query.data.total} onPage={setPage} />
        )}
      </Card>

      <MovementDialog
        key={manual.open ? `manual-${manual.key}` : `url-${nova}-${productParam}-${urlProduct.isSuccess}`}
        open={dialogOpen}
        onOpenChange={(open) => {
          if (open) return
          setManual((m) => ({ ...m, open: false }))
          if (nova) setParams({}, { replace: true })
        }}
        initialKind={(fromUrl && !manual.open ? nova : "entry") as MovementKind}
        initialProduct={initialProduct}
      />
    </>
  )
}
