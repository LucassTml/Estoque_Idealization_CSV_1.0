import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Info, ShoppingCart } from "lucide-react"
import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"
import { EmptyState, ErrorState, LoadingRows, PageHeader, Spinner, StatCard } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { client, unwrap } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { FORECAST_METHOD_LABELS, useWarehouses } from "@/lib/queries"
import { cn, formatCurrency, formatDate, formatQty } from "@/lib/utils"

export default function ReplenishmentPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: warehouses } = useWarehouses(true)
  const [chosenWarehouse, setWarehouseId] = useState("")
  // Guardamos só o que o usuário desmarcou: por padrão tudo que tem fornecedor vem selecionado.
  const [deselected, setDeselected] = useState<Set<number>>(new Set())
  const query = useQuery({
    queryKey: ["replenishment"],
    queryFn: () => unwrap(client.GET("/api/v1/reports/replenishment")),
  })
  const items = useMemo(() => query.data ?? [], [query.data])
  const warehouseId = chosenWarehouse || (warehouses?.length ? String(warehouses[0].id) : "")
  const selected = useMemo(
    () => new Set(items.filter((i) => i.supplier_id !== null && !deselected.has(i.product_id)).map((i) => i.product_id)),
    [items, deselected],
  )

  const selectedItems = items.filter((i) => selected.has(i.product_id))
  const urgent = items.filter((i) => i.days_until_stockout !== null && i.days_until_stockout <= i.lead_time_days)

  const generate = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST("/api/v1/purchase-orders/from-suggestions", {
          body: { warehouse_id: Number(warehouseId), product_ids: [...selected] },
        }),
      ),
    onSuccess: (orders) => {
      toast.success(`${orders.length} ${orders.length === 1 ? "pedido criado" : "pedidos criados"} como rascunho.`)
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] })
      queryClient.invalidateQueries({ queryKey: ["replenishment"] })
      navigate(orders.length === 1 ? `/compras/${orders[0].id}` : "/compras?filtro=draft")
    },
  })

  const toggle = (id: number) =>
    setDeselected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      <PageHeader
        title="Reposição inteligente"
        description="O que comprar, quanto e quando — calculado a partir do histórico de consumo de cada produto."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Produtos a repor" value={items.length} />
        <StatCard
          label="Acabam antes da entrega"
          value={urgent.length}
          hint="Estoque dura menos que o prazo do fornecedor"
          tone={urgent.length ? "danger" : "success"}
        />
        <StatCard label="Custo estimado" value={formatCurrency(items.reduce((s, i) => s + i.estimated_cost, 0))} />
      </div>

      <Card className="mb-6 border-primary/20 bg-primary/5">
        <CardContent className="flex gap-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-muted-foreground">
            Para consumo regular usamos <strong className="text-foreground">suavização exponencial de Holt</strong> com
            tendência amortecida; para consumo esporádico, o método de{" "}
            <strong className="text-foreground">Croston (SBA)</strong>. O estoque de segurança considera a variabilidade
            da demanda e o nível de serviço configurado. A sugestão cobre o prazo de entrega + o horizonte de
            planejamento, descontando o saldo e os pedidos já em aberto.
          </p>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0">
        {can("manager") && items.length > 0 && (
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {selectedItems.length} selecionados ·{" "}
              {formatCurrency(selectedItems.reduce((s, i) => s + i.estimated_cost, 0))}
            </p>
            <div className="flex gap-2">
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Depósito de entrega" /></SelectTrigger>
                <SelectContent>
                  {warehouses?.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>Entregar em {w.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button disabled={!selected.size || generate.isPending} onClick={() => generate.mutate()}>
                {generate.isPending ? <Spinner /> : <ShoppingCart />} Gerar pedidos
              </Button>
            </div>
          </div>
        )}
        {query.error ? (
          <ErrorState error={query.error} onRetry={query.refetch} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {can("manager") && <TableHead className="w-10 pl-4" />}
                <TableHead className={cn(!can("manager") && "pl-4")}>Produto</TableHead>
                <TableHead className="hidden lg:table-cell">Fornecedor</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead className="hidden text-right md:table-cell">Consumo/dia</TableHead>
                <TableHead className="text-right">Acaba em</TableHead>
                <TableHead className="hidden text-right xl:table-cell">Ponto de pedido</TableHead>
                <TableHead className="text-right">Comprar</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Custo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <LoadingRows columns={9} />
              ) : items.length ? (
                items.map((item) => {
                  const critical = item.days_until_stockout !== null && item.days_until_stockout <= item.lead_time_days
                  return (
                    <TableRow key={item.product_id}>
                      {can("manager") && (
                        <TableCell className="pl-4">
                          <Checkbox
                            checked={selected.has(item.product_id)}
                            onCheckedChange={() => toggle(item.product_id)}
                            disabled={item.supplier_id === null}
                            aria-label={`Selecionar ${item.name}`}
                          />
                        </TableCell>
                      )}
                      <TableCell className={cn("max-w-64", !can("manager") && "pl-4")}>
                        <Link to={`/produtos/${item.product_id}`} className="block truncate font-medium hover:underline">{item.name}</Link>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="font-mono">{item.sku}</span>
                          <Badge variant="outline" className="h-4 px-1 text-[10px]">{FORECAST_METHOD_LABELS[item.method] ?? item.method}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-44 truncate lg:table-cell">
                        {item.supplier_name ?? <span className="text-destructive">Sem fornecedor</span>}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {formatQty(item.current_stock)}
                        {item.on_order > 0 && <p className="text-xs text-muted-foreground">+{formatQty(item.on_order)} pedido</p>}
                      </TableCell>
                      <TableCell className="tabular hidden text-right md:table-cell">{formatQty(item.avg_daily_demand, 2)}</TableCell>
                      <TableCell className="text-right">
                        {item.days_until_stockout === null ? (
                          "—"
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={cn("tabular cursor-help", critical && "font-semibold text-destructive")}>
                                {Math.round(item.days_until_stockout)} dias
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              Previsão: {formatDate(item.stockout_date)} · entrega em {item.lead_time_days} dias
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell className="tabular hidden text-right xl:table-cell">{formatQty(item.reorder_point, 1)}</TableCell>
                      <TableCell className="tabular text-right font-semibold">{formatQty(item.suggested_quantity)} <span className="text-xs font-normal text-muted-foreground">{item.unit}</span></TableCell>
                      <TableCell className="tabular hidden text-right sm:table-cell">{formatCurrency(item.estimated_cost)}</TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={9}>
                    <EmptyState title="Nada para repor agora" description="Todos os produtos têm estoque (ou pedidos em aberto) suficiente para o horizonte planejado." />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  )
}
