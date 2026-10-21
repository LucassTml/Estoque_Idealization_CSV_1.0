import { useQuery } from "@tanstack/react-query"
import { FileSpreadsheet, FileText, Sheet } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { toast } from "sonner"
import { AbcBadge } from "@/components/badges"
import { axisProps, ChartTooltip } from "@/components/charts"
import { ErrorState, LoadingRows, PageHeader, StatCard } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { client, errorMessage, fetchFile, unwrap } from "@/lib/api"
import { downloadBlob, formatCompactCurrency, formatCurrency, formatPercent, formatQty } from "@/lib/utils"

type ReportName = "stock-position" | "movements" | "abc" | "turnover" | "replenishment" | "low-stock"

async function exportReport(name: ReportName, format: "xlsx" | "csv" | "pdf", days?: number) {
  try {
    const blob = await fetchFile(`/api/v1/reports/export/${name}`, { query: { format, days } })
    downloadBlob(blob, `${name}.${format}`)
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

function ExportButtons({ name, days }: { name: ReportName; days?: number }) {
  return (
    <div className="flex gap-1.5">
      <Button variant="outline" size="sm" onClick={() => exportReport(name, "xlsx", days)}><FileSpreadsheet /> Excel</Button>
      <Button variant="outline" size="sm" onClick={() => exportReport(name, "pdf", days)}><FileText /> PDF</Button>
      <Button variant="ghost" size="sm" onClick={() => exportReport(name, "csv", days)}><Sheet /> CSV</Button>
    </div>
  )
}

function PeriodSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
      <SelectContent>
        {[30, 60, 90, 180, 365].map((d) => <SelectItem key={d} value={String(d)}>Últimos {d} dias</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function AbcTab() {
  const [days, setDays] = useState(90)
  const { data, isLoading, error } = useQuery({
    queryKey: ["abc", days],
    queryFn: () => unwrap(client.GET("/api/v1/reports/abc", { params: { query: { days } } })),
  })
  if (error) return <ErrorState error={error} />
  const chart = data?.items.filter((i) => i.value > 0).map((i) => ({ sku: i.sku, value: i.value, cumulative: i.cumulative_share * 100 })) ?? []

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSelect value={days} onChange={setDays} />
        <ExportButtons name="abc" days={days} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {(["A", "B", "C"] as const).map((k) => (
          <StatCard
            key={k}
            label={`Classe ${k}`}
            value={`${data?.summary[k]?.count ?? 0} itens`}
            hint={data ? `${formatPercent(data.total_value ? (data.summary[k]?.value ?? 0) / data.total_value : 0)} do valor consumido` : undefined}
            icon={<span className="text-sm font-bold">{k}</span>}
            tone={k === "A" ? "default" : k === "B" ? "warning" : "success"}
          />
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Curva de Pareto</CardTitle>
          <CardDescription>Valor consumido por produto (barras) e participação acumulada (linha).</CardDescription>
        </CardHeader>
        <CardContent className="h-72 pl-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="sku" {...axisProps} interval={0} angle={-45} textAnchor="end" height={70} fontSize={10} />
              <YAxis yAxisId="v" {...axisProps} width={64} tickFormatter={(v: number) => formatCompactCurrency(v)} />
              <YAxis yAxisId="p" orientation="right" {...axisProps} width={40} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<ChartTooltip formatter={(v, name) => (name === "Acumulado" ? `${v.toFixed(1)}%` : formatCurrency(v))} />} />
              <Bar yAxisId="v" dataKey="value" name="Consumo" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
              <Line yAxisId="p" dataKey="cumulative" name="Acumulado" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Classe</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead className="hidden md:table-cell">Categoria</TableHead>
              <TableHead className="text-right">Qtd. consumida</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Part.</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Acumulado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <LoadingRows columns={7} /> : data?.items.map((i) => (
              <TableRow key={i.product_id}>
                <TableCell className="pl-4"><AbcBadge value={i.abc_class} /></TableCell>
                <TableCell className="max-w-64">
                  <Link to={`/produtos/${i.product_id}`} className="block truncate hover:underline">{i.name}</Link>
                  <span className="font-mono text-xs text-muted-foreground">{i.sku}</span>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{i.category ?? "—"}</TableCell>
                <TableCell className="tabular text-right">{formatQty(i.quantity)}</TableCell>
                <TableCell className="tabular text-right">{formatCurrency(i.value)}</TableCell>
                <TableCell className="tabular hidden text-right sm:table-cell">{formatPercent(i.share)}</TableCell>
                <TableCell className="tabular hidden text-right sm:table-cell">{formatPercent(i.cumulative_share)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

function TurnoverTab() {
  const [days, setDays] = useState(90)
  const { data, isLoading, error } = useQuery({
    queryKey: ["turnover", days],
    queryFn: () => unwrap(client.GET("/api/v1/reports/turnover", { params: { query: { days } } })),
  })
  if (error) return <ErrorState error={error} />
  const stale = data?.filter((i) => i.consumed === 0 && i.current_stock > 0) ?? []
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSelect value={days} onChange={setDays} />
        <ExportButtons name="turnover" days={days} />
      </div>
      {stale.length > 0 && (
        <Card className="border-warning/40 bg-warning/10">
          <CardContent className="text-sm">
            <strong>{stale.length} produtos parados</strong> (sem saídas no período) somam{" "}
            <strong>{formatCurrency(stale.reduce((s, i) => s + i.stock_value, 0))}</strong> em estoque.
          </CardContent>
        </Card>
      )}
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Produto</TableHead>
              <TableHead className="text-right">Consumo</TableHead>
              <TableHead className="hidden text-right md:table-cell">Estoque médio</TableHead>
              <TableHead className="text-right">Giro</TableHead>
              <TableHead className="text-right">Cobertura</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Valor parado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <LoadingRows columns={6} /> : data?.map((i) => (
              <TableRow key={i.product_id}>
                <TableCell className="max-w-64 pl-4">
                  <Link to={`/produtos/${i.product_id}`} className="block truncate hover:underline">{i.name}</Link>
                  <span className="font-mono text-xs text-muted-foreground">{i.sku}</span>
                </TableCell>
                <TableCell className="tabular text-right">{formatQty(i.consumed)} {i.unit}</TableCell>
                <TableCell className="tabular hidden text-right md:table-cell">{formatQty(i.average_stock)}</TableCell>
                <TableCell className="tabular text-right font-medium">{i.turnover !== null ? `${i.turnover.toFixed(1)}×` : "—"}</TableCell>
                <TableCell className="tabular text-right">{i.coverage_days !== null ? `${Math.round(i.coverage_days)} dias` : "—"}</TableCell>
                <TableCell className="tabular hidden text-right sm:table-cell">{formatCurrency(i.stock_value)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

const EXPORTS: { name: ReportName; title: string; description: string }[] = [
  { name: "stock-position", title: "Posição de estoque", description: "Saldo e valor de cada produto em cada depósito." },
  { name: "movements", title: "Movimentações", description: "Todas as entradas, saídas e ajustes dos últimos 30 dias." },
  { name: "low-stock", title: "Abaixo do mínimo", description: "Itens que precisam de atenção, com quanto falta." },
  { name: "replenishment", title: "Sugestão de compras", description: "Lista de reposição com custos estimados." },
  { name: "abc", title: "Curva ABC", description: "Classificação pelo valor consumido (90 dias)." },
  { name: "turnover", title: "Giro de estoque", description: "Giro e cobertura em dias por produto." },
]

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Relatórios" description="Análises do estoque e exportação para Excel, PDF e CSV." />
      <Tabs defaultValue="abc">
        <TabsList className="mb-6">
          <TabsTrigger value="abc">Curva ABC</TabsTrigger>
          <TabsTrigger value="turnover">Giro de estoque</TabsTrigger>
          <TabsTrigger value="exports">Exportações</TabsTrigger>
        </TabsList>
        <TabsContent value="abc"><AbcTab /></TabsContent>
        <TabsContent value="turnover"><TurnoverTab /></TabsContent>
        <TabsContent value="exports">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {EXPORTS.map((r) => (
              <Card key={r.name}>
                <CardHeader>
                  <CardTitle>{r.title}</CardTitle>
                  <CardDescription>{r.description}</CardDescription>
                </CardHeader>
                <CardContent><ExportButtons name={r.name} days={r.name === "abc" || r.name === "turnover" ? 90 : 30} /></CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </>
  )
}
