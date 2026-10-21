import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, ArrowRight, DollarSign, Package, PackageX, Plus, ShoppingCart } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate } from "react-router"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { StockBadge } from "@/components/badges"
import { axisProps, CHART_COLORS, ChartTooltip } from "@/components/charts"
import { ErrorState, PageHeader, StatCard } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { client, unwrap } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { keys, useProducts } from "@/lib/queries"
import { formatCompactCurrency, formatCurrency, formatDate, formatQty } from "@/lib/utils"

export default function DashboardPage() {
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const [days, setDays] = useState(30)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: keys.dashboard(days),
    queryFn: () => unwrap(client.GET("/api/v1/dashboard", { params: { query: { days } } })),
  })
  const critical = useProducts({ stock_status: "low", page_size: 6, sort: "stock" })
  const replenishment = useQuery({
    queryKey: ["replenishment"],
    queryFn: () => unwrap(client.GET("/api/v1/reports/replenishment")),
  })

  const firstName = user?.name.split(" ")[0]
  const categoryTotal = data?.value_by_category.reduce((sum, c) => sum + c.value, 0) ?? 0

  return (
    <>
      <PageHeader
        title={`Olá, ${firstName}`}
        description="Visão geral do estoque e da movimentação recente."
        actions={
          <>
            <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <TabsList>
                <TabsTrigger value="7">7 dias</TabsTrigger>
                <TabsTrigger value="30">30 dias</TabsTrigger>
                <TabsTrigger value="90">90 dias</TabsTrigger>
              </TabsList>
            </Tabs>
            {can("operator") && (
              <Button asChild>
                <Link to="/movimentacoes?nova=entry">
                  <Plus /> Movimentar
                </Link>
              </Button>
            )}
          </>
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <div className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {isLoading || !data ? (
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[106px] rounded-xl" />)
            ) : (
              <>
                <StatCard
                  label="Valor em estoque"
                  value={formatCurrency(data.stock_value)}
                  hint={`${data.active_products} produtos ativos`}
                  icon={<DollarSign />}
                />
                <StatCard
                  label="Abaixo do mínimo"
                  value={data.below_min_count}
                  hint="Clique para ver os itens"
                  icon={<AlertTriangle />}
                  tone={data.below_min_count ? "warning" : "success"}
                  onClick={() => navigate("/produtos?status=low")}
                />
                <StatCard
                  label="Sem estoque"
                  value={data.out_of_stock_count}
                  hint="Produtos ativos zerados"
                  icon={<PackageX />}
                  tone={data.out_of_stock_count ? "danger" : "success"}
                  onClick={() => navigate("/produtos?status=out")}
                />
                <StatCard
                  label="Compras em aberto"
                  value={data.open_purchase_orders}
                  hint={`${formatCurrency(data.open_purchase_value)} a receber`}
                  icon={<ShoppingCart />}
                  onClick={() => navigate("/compras")}
                />
              </>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Entradas x saídas</CardTitle>
                <CardDescription>
                  Valor movimentado por dia (custo) · {data?.movements_period ?? 0} movimentações no período
                </CardDescription>
              </CardHeader>
              <CardContent className="h-72 pl-0">
                {data && (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.series} margin={{ left: 8, right: 8 }}>
                      <defs>
                        <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis
                        dataKey="date"
                        {...axisProps}
                        tickFormatter={(d: string) => formatDate(d).slice(0, 5)}
                        minTickGap={24}
                      />
                      <YAxis {...axisProps} width={64} tickFormatter={(v: number) => formatCompactCurrency(v)} />
                      <Tooltip
                        content={<ChartTooltip formatter={(v) => formatCurrency(v)} labelFormatter={formatDate} />}
                      />
                      <Area
                        type="monotone"
                        dataKey="in_value"
                        name="Entradas"
                        stroke="var(--chart-2)"
                        fill="url(#gIn)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="out_value"
                        name="Saídas"
                        stroke="var(--chart-1)"
                        fill="url(#gOut)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Valor por categoria</CardTitle>
                <CardDescription>Distribuição do capital em estoque</CardDescription>
              </CardHeader>
              <CardContent>
                {data && (
                  <>
                    <div className="h-44">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={data.value_by_category}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={50}
                            outerRadius={80}
                            paddingAngle={2}
                            stroke="var(--card)"
                          >
                            {data.value_by_category.map((entry, i) => (
                              <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTooltip formatter={(v) => formatCurrency(v)} />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="mt-3 grid gap-1.5 text-sm">
                      {data.value_by_category.slice(0, 6).map((entry, i) => (
                        <li key={entry.name} className="flex items-center gap-2">
                          <span
                            className="size-2.5 rounded-sm"
                            style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                          />
                          <span className="truncate">{entry.name}</span>
                          <span className="tabular ml-auto text-muted-foreground">
                            {categoryTotal ? Math.round((entry.value / categoryTotal) * 100) : 0}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Itens críticos</CardTitle>
                <CardDescription>No mínimo ou abaixo dele</CardDescription>
                <CardAction>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/produtos?status=low">
                      Ver todos <ArrowRight />
                    </Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                {critical.data?.items.length ? (
                  <ul className="divide-y">
                    {critical.data.items.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <Link to={`/produtos/${p.id}`} className="block truncate text-sm font-medium hover:underline">
                            {p.name}
                          </Link>
                          <p className="tabular text-xs text-muted-foreground">
                            {formatQty(p.total_stock)} / mín. {formatQty(p.min_stock)} {p.unit}
                          </p>
                        </div>
                        <StockBadge stock={p.total_stock} min={p.min_stock} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">Nenhum item crítico. 🎉</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Mais consumidos</CardTitle>
                <CardDescription>Saídas nos últimos {days} dias</CardDescription>
              </CardHeader>
              <CardContent>
                {data?.top_exits.length ? (
                  <ul className="grid gap-3">
                    {data.top_exits.map((item) => {
                      const max = data.top_exits[0].quantity || 1
                      return (
                        <li key={item.product_id}>
                          <div className="mb-1 flex justify-between gap-2 text-sm">
                            <Link to={`/produtos/${item.product_id}`} className="truncate hover:underline">
                              {item.name}
                            </Link>
                            <span className="tabular text-muted-foreground">{formatQty(item.quantity)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted">
                            <div
                              className="h-2 rounded-full bg-primary"
                              style={{ width: `${(item.quantity / max) * 100}%` }}
                            />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">Sem saídas no período.</p>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 xl:col-span-1">
              <CardHeader>
                <CardTitle>Reposição sugerida</CardTitle>
                <CardDescription>Calculada pela previsão de demanda</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="flex items-baseline gap-2">
                  <span className="tabular text-3xl font-semibold">{replenishment.data?.length ?? "—"}</span>
                  <span className="text-sm text-muted-foreground">produtos para comprar</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Custo estimado:{" "}
                  <span className="font-medium text-foreground">
                    {formatCurrency(replenishment.data?.reduce((s, r) => s + r.estimated_cost, 0))}
                  </span>
                </p>
                <ul className="grid gap-2 text-sm">
                  {replenishment.data?.slice(0, 3).map((r) => (
                    <li key={r.product_id} className="flex justify-between gap-2">
                      <span className="truncate">{r.name}</span>
                      <span className="tabular shrink-0 text-muted-foreground">
                        {r.days_until_stockout !== null ? `~${Math.round(r.days_until_stockout)} dias` : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="grid gap-2 border-t pt-4">
                  <p className="text-xs text-muted-foreground">Valor por depósito</p>
                  {data?.value_by_warehouse.map((w) => (
                    <div key={w.code} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Package className="size-3.5 text-muted-foreground" /> {w.name}
                      </span>
                      <span className="tabular">{formatCurrency(w.value)}</span>
                    </div>
                  ))}
                </div>
                <Button variant="outline" asChild>
                  <Link to="/reposicao">
                    Abrir reposição <ArrowRight />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
