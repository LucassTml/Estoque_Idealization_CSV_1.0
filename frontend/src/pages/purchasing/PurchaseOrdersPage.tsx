import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Plus, Search } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { PoStatusBadge } from "@/components/badges"
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDebounce } from "@/hooks/use-debounce"
import { client, unwrap } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { PurchaseOrderStatus } from "@/lib/queries"
import { formatCurrency, formatDate, todayISO } from "@/lib/utils"

const FILTERS: Record<string, PurchaseOrderStatus[] | undefined> = {
  open: ["ordered", "partially_received"],
  draft: ["draft"],
  received: ["received"],
  cancelled: ["cancelled"],
  all: undefined,
}

export default function PurchaseOrdersPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filter = params.get("filtro") && params.get("filtro")! in FILTERS ? params.get("filtro")! : "open"
  const setFilter = (value: string) => setParams(value === "open" ? {} : { filtro: value }, { replace: true })
  const [search, setSearch] = useState("")
  const q = useDebounce(search, 300)
  const filterKey = `${filter}|${q}`
  const [pageState, setPageState] = useState({ page: 1, key: filterKey })
  const page = pageState.key === filterKey ? pageState.page : 1
  const setPage = (next: number) => setPageState({ page: next, key: filterKey })

  const query = useQuery({
    queryKey: ["purchase-orders", { filter, q, page }],
    queryFn: () =>
      unwrap(
        client.GET("/api/v1/purchase-orders", {
          params: { query: { status: FILTERS[filter], q: q || undefined, page, page_size: 20 } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
  const today = todayISO()

  return (
    <>
      <PageHeader
        title="Pedidos de compra"
        description="Do rascunho ao recebimento, com entrada automática no estoque."
        actions={
          can("manager") && (
            <Button asChild>
              <Link to="/compras/novo"><Plus /> Novo pedido</Link>
            </Button>
          )
        }
      />
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList>
              <TabsTrigger value="open">Em aberto</TabsTrigger>
              <TabsTrigger value="draft">Rascunhos</TabsTrigger>
              <TabsTrigger value="received">Recebidos</TabsTrigger>
              <TabsTrigger value="cancelled">Cancelados</TabsTrigger>
              <TabsTrigger value="all">Todos</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative md:w-72">
            <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input placeholder="Número ou fornecedor" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {query.error ? (
          <ErrorState error={query.error} onRetry={query.refetch} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Número</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="hidden md:table-cell">Destino</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="hidden sm:table-cell">Previsão</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Itens</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <LoadingRows columns={7} />
              ) : query.data?.items.length ? (
                query.data.items.map((po) => {
                  const overdue =
                    po.expected_date && po.expected_date < today && ["ordered", "partially_received"].includes(po.status)
                  return (
                    <TableRow key={po.id} className="cursor-pointer" onClick={() => navigate(`/compras/${po.id}`)}>
                      <TableCell className="pl-4 font-mono text-sm">{po.number}</TableCell>
                      <TableCell className="max-w-56 truncate">{po.supplier.name}</TableCell>
                      <TableCell className="hidden md:table-cell">{po.warehouse.code}</TableCell>
                      <TableCell><PoStatusBadge status={po.status} /></TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <span className={overdue ? "font-medium text-destructive" : undefined}>
                          {formatDate(po.expected_date)}
                          {overdue && " · atrasado"}
                        </span>
                      </TableCell>
                      <TableCell className="tabular hidden text-right lg:table-cell">{po.item_count}</TableCell>
                      <TableCell className="tabular text-right font-medium">{formatCurrency(po.total)}</TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      title="Nenhum pedido"
                      description="Crie um pedido manualmente ou gere a partir das sugestões de reposição."
                      action={<Button variant="outline" asChild><Link to="/reposicao">Ver sugestões</Link></Button>}
                    />
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
    </>
  )
}
