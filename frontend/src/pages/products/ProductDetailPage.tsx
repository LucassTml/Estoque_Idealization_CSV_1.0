import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, ArrowUpDown, Pencil, Tag } from "lucide-react"
import { useState } from "react"
import { Link, useParams } from "react-router"
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { toast } from "sonner"
import { ActiveBadge, MovementBadge, StockBadge } from "@/components/badges"
import { axisProps, ChartTooltip } from "@/components/charts"
import { ErrorState, LoadingRows, Pagination, Spinner, StatCard } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { client, errorMessage, fetchFile, unwrap } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { FORECAST_METHOD_LABELS, keys } from "@/lib/queries"
import { cn, formatCurrency, formatDate, formatDateTime, formatQty, openBlob } from "@/lib/utils"
import { ProductFormDialog } from "./ProductFormDialog"

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular mt-0.5 font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function ForecastPanel({ productId, unit }: { productId: number; unit: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["forecast", productId],
    queryFn: () =>
      unwrap(client.GET("/api/v1/products/{product_id}/forecast", { params: { path: { product_id: productId } } })),
  })
  if (isLoading) return <div className="flex justify-center py-16"><Spinner className="size-6" /></div>
  if (error || !data) return <ErrorState error={error} />

  const chart = [
    ...data.history.map((h) => ({ date: h.date, consumo: h.quantity })),
    ...data.forecast.map((f) => ({ date: f.date, previsao: f.quantity })),
  ]
  const today = data.history.at(-1)?.date

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Consumo diário e previsão</CardTitle>
          <CardDescription>
            Últimos {data.history.length} dias de saídas e os próximos {data.horizon_days} dias previstos pelo método{" "}
            <strong>{FORECAST_METHOD_LABELS[data.method] ?? data.method}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-72 pl-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ left: 8, right: 12 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="date" {...axisProps} minTickGap={28} tickFormatter={(d: string) => formatDate(d).slice(0, 5)} />
              <YAxis {...axisProps} width={40} allowDecimals />
              <Tooltip
                content={<ChartTooltip formatter={(v) => `${formatQty(v)} ${unit}`} labelFormatter={formatDate} />}
              />
              {today && <ReferenceLine x={today} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: "hoje", fontSize: 11, fill: "var(--muted-foreground)", position: "insideTopRight" }} />}
              <Bar dataKey="consumo" name="Consumo" fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Line dataKey="previsao" name="Previsão" stroke="var(--chart-3)" strokeWidth={2.5} dot={false} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Planejamento de reposição</CardTitle>
          <CardDescription>Lead time do fornecedor: {data.lead_time_days} dias</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Consumo médio/dia" value={`${formatQty(data.avg_daily_demand, 2)} ${unit}`} />
            <Metric
              label="Acaba em"
              value={data.days_until_stockout !== null ? `${Math.round(data.days_until_stockout)} dias` : "—"}
              hint={data.stockout_date ? formatDate(data.stockout_date) : undefined}
            />
            <Metric label="Estoque de segurança" value={formatQty(data.safety_stock, 1)} />
            <Metric label="Ponto de pedido" value={formatQty(data.reorder_point, 1)} />
            <Metric label="Em pedidos abertos" value={formatQty(data.on_order)} />
            <Metric label={`Previsto (${data.horizon_days}d)`} value={formatQty(data.forecast_total, 1)} />
          </div>
          <div
            className={cn(
              "rounded-lg p-4",
              data.suggested_quantity > 0 ? "bg-warning/15" : "bg-success/10",
            )}
          >
            {data.suggested_quantity > 0 ? (
              <>
                <p className="text-sm">Sugestão de compra</p>
                <p className="tabular text-2xl font-semibold">
                  {formatQty(data.suggested_quantity)} {unit}
                </p>
                <p className="text-xs text-muted-foreground">
                  Custo estimado {formatCurrency(data.estimated_cost)}
                </p>
              </>
            ) : (
              <p className="text-sm">Estoque suficiente para o horizonte planejado. Nenhuma compra sugerida.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Kardex({ productId }: { productId: number }) {
  const [page, setPage] = useState(1)
  const { data, isLoading, error } = useQuery({
    queryKey: ["kardex", productId, page],
    queryFn: () =>
      unwrap(
        client.GET("/api/v1/products/{product_id}/movements", {
          params: { path: { product_id: productId }, query: { page, page_size: 15 } },
        }),
      ),
  })
  if (error) return <ErrorState error={error} />
  return (
    <Card className="gap-0 py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Data</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Depósito</TableHead>
            <TableHead className="text-right">Quantidade</TableHead>
            <TableHead className="text-right">Saldo no depósito</TableHead>
            <TableHead className="hidden text-right md:table-cell">Custo un.</TableHead>
            <TableHead className="hidden lg:table-cell">Referência</TableHead>
            <TableHead className="hidden lg:table-cell">Usuário</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <LoadingRows columns={8} />
          ) : (
            data?.items.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="pl-4 text-sm whitespace-nowrap">{formatDateTime(m.created_at)}</TableCell>
                <TableCell><MovementBadge type={m.type} /></TableCell>
                <TableCell>{m.warehouse.code}</TableCell>
                <TableCell className={cn("tabular text-right font-medium", m.quantity < 0 ? "text-destructive" : "text-success")}>
                  {m.quantity > 0 ? "+" : ""}
                  {formatQty(m.quantity)}
                </TableCell>
                <TableCell className="tabular text-right">{formatQty(m.balance_after)}</TableCell>
                <TableCell className="tabular hidden text-right md:table-cell">{formatCurrency(m.unit_cost)}</TableCell>
                <TableCell className="hidden max-w-40 truncate text-muted-foreground lg:table-cell">{m.reference ?? "—"}</TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">{m.user?.name ?? "—"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {data && data.total > 0 && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
    </Card>
  )
}

export default function ProductDetailPage() {
  const id = Number(useParams().id)
  const { can } = useAuth()
  const [editOpen, setEditOpen] = useState(false)
  const { data: product, isLoading, error, refetch } = useQuery({
    queryKey: keys.product(id),
    queryFn: () => unwrap(client.GET("/api/v1/products/{product_id}", { params: { path: { product_id: id } } })),
  })

  const printLabel = async () => {
    try {
      openBlob(await fetchFile("/api/v1/labels/pdf", { method: "POST", body: { product_ids: [id], copies: 3, layout: "a4-3x8" } }))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (isLoading) return <div className="flex justify-center py-20"><Spinner className="size-6" /></div>
  if (error || !product) return <ErrorState error={error} onRetry={refetch} />

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2 text-muted-foreground">
          <Link to="/produtos"><ArrowLeft /> Produtos</Link>
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
              {product.is_active ? <StockBadge stock={product.total_stock} min={product.min_stock} /> : <ActiveBadge active={false} />}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-mono">{product.sku}</span>
              {product.barcode && <> · EAN {product.barcode}</>}
              {product.category && <> · {product.category.name}</>}
              {product.supplier && <> · {product.supplier.name}</>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={printLabel}><Tag /> Etiquetas</Button>
            {can("manager") && <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil /> Editar</Button>}
            {can("operator") && (
              <Button asChild>
                <Link to={`/movimentacoes?nova=entry&produto=${product.id}`}><ArrowUpDown /> Movimentar</Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Estoque total" value={`${formatQty(product.total_stock)} ${product.unit}`} hint={`Mínimo ${formatQty(product.min_stock)}${product.max_stock != null ? ` · máximo ${formatQty(product.max_stock)}` : ""}`} />
        <StatCard label="Valor em estoque" value={formatCurrency(product.stock_value)} />
        <StatCard label="Custo médio" value={formatCurrency(product.cost_price)} hint="Média ponderada das entradas" />
        <StatCard label="Preço de venda" value={formatCurrency(product.sale_price)} hint={product.cost_price > 0 && product.sale_price > 0 ? `Margem ${Math.round(((product.sale_price - product.cost_price) / product.sale_price) * 100)}%` : undefined} />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Saldo por depósito</CardTitle>
          </CardHeader>
          <CardContent>
            {product.stock.filter((s) => s.quantity !== 0).length ? (
              <ul className="grid gap-3">
                {product.stock.filter((s) => s.quantity !== 0).map((s) => (
                  <li key={s.warehouse_id}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{s.warehouse_name} <span className="text-muted-foreground">({s.warehouse_code})</span></span>
                      <span className="tabular font-medium">{formatQty(s.quantity)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted">
                      <div className="h-1.5 rounded-full bg-primary" style={{ width: `${product.total_stock ? (s.quantity / product.total_stock) * 100 : 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sem saldo em nenhum depósito.</p>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Informações</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Unidade</dt><dd>{product.unit}</dd></div>
              <div><dt className="text-muted-foreground">Fornecedor</dt><dd>{product.supplier?.name ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Cadastrado em</dt><dd>{formatDateTime(product.created_at)}</dd></div>
              <div><dt className="text-muted-foreground">Atualizado em</dt><dd>{formatDateTime(product.updated_at)}</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted-foreground">Descrição</dt><dd className="whitespace-pre-line">{product.description || "—"}</dd></div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="forecast">
        <TabsList className="mb-4">
          <TabsTrigger value="forecast">Previsão de demanda</TabsTrigger>
          <TabsTrigger value="kardex">Ficha de estoque (kardex)</TabsTrigger>
        </TabsList>
        <TabsContent value="forecast"><ForecastPanel productId={product.id} unit={product.unit} /></TabsContent>
        <TabsContent value="kardex"><Kardex productId={product.id} /></TabsContent>
      </Tabs>

      <ProductFormDialog open={editOpen} onOpenChange={setEditOpen} product={product} onSaved={() => refetch()} />
    </>
  )
}
