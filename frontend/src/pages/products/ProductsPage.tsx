import { ArrowDown, ArrowUp, ArrowUpDown, Download, Eye, MoreHorizontal, Pencil, Plus, Search } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"
import { ActiveBadge, StockBadge } from "@/components/badges"
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useDebounce } from "@/hooks/use-debounce"
import { errorMessage, fetchFile } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useCategories, useProducts, type ProductDetail, type ProductQuery } from "@/lib/queries"
import { cn, downloadBlob, formatCurrency, formatQty } from "@/lib/utils"
import { ProductFormDialog } from "./ProductFormDialog"

type Sort = NonNullable<ProductQuery["sort"]>
type Status = NonNullable<ProductQuery["stock_status"]>

function SortHeader({
  label,
  field,
  sort,
  onSort,
  className,
}: {
  label: string
  field: string
  sort: Sort
  onSort: (sort: Sort) => void
  className?: string
}) {
  const active = sort.replace("-", "") === field
  const desc = sort.startsWith("-")
  const Icon = active ? (desc ? ArrowDown : ArrowUp) : ArrowUpDown
  return (
    <TableHead className={className}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => onSort((active && !desc ? `-${field}` : field) as Sort)}
      >
        {label}
        <Icon className="size-3.5 opacity-60" />
      </button>
    </TableHead>
  )
}

export default function ProductsPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get("q") ?? "")
  const debouncedSearch = useDebounce(search, 300)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ProductDetail | null>(null)
  const { data: categories } = useCategories()

  const page = Number(params.get("page") ?? 1)
  const status = (params.get("status") ?? "all") as Status
  const category = params.get("categoria") ?? "all"
  const sort = (params.get("sort") ?? "name") as Sort
  const showInactive = params.get("inativos") === "1"

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "" || value === "all") next.delete(key)
      else next.set(key, value)
    }
    if (!("page" in changes)) next.delete("page")
    setParams(next, { replace: true })
  }

  useEffect(() => {
    if (debouncedSearch !== (params.get("q") ?? "")) update({ q: debouncedSearch })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  const query = useProducts({
    page,
    page_size: 20,
    q: params.get("q") || undefined,
    stock_status: status,
    category_id: category === "all" ? undefined : Number(category),
    active: showInactive ? undefined : true,
    sort,
  })

  const exportFile = async (format: "xlsx" | "csv") => {
    try {
      const blob = await fetchFile("/api/v1/export/products", { query: { format } })
      downloadBlob(blob, `produtos.${format}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Catálogo com saldo consolidado de todos os depósitos."
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Download /> Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => exportFile("xlsx")}>Excel (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportFile("csv")}>CSV (;)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {can("manager") && (
              <Button
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
              >
                <Plus /> Novo produto
              </Button>
            )}
          </>
        }
      />

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, SKU ou código de barras"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={category} onValueChange={(v) => update({ categoria: v })}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as categorias</SelectItem>
              {categories?.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => update({ status: v })}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Qualquer situação</SelectItem>
              <SelectItem value="low">Abaixo do mínimo</SelectItem>
              <SelectItem value="out">Sem estoque</SelectItem>
              <SelectItem value="ok">Normal</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm whitespace-nowrap text-muted-foreground">
            <input
              type="checkbox"
              className="accent-primary"
              checked={showInactive}
              onChange={(e) => update({ inativos: e.target.checked ? "1" : null })}
            />
            Incluir inativos
          </label>
        </div>

        {query.error ? (
          <ErrorState error={query.error} onRetry={query.refetch} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader label="SKU" field="sku" sort={sort} onSort={(s) => update({ sort: s })} className="hidden pl-4 sm:table-cell" />
                <SortHeader label="Produto" field="name" sort={sort} onSort={(s) => update({ sort: s })} className="pl-4 sm:pl-2" />
                <SortHeader
                  label="Estoque"
                  field="stock"
                  sort={sort}
                  onSort={(s) => update({ sort: s })}
                  className="text-right"
                />
                <TableHead className="hidden text-right md:table-cell">Mínimo</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Custo médio</TableHead>
                <SortHeader
                  label="Valor"
                  field="value"
                  sort={sort}
                  onSort={(s) => update({ sort: s })}
                  className="hidden text-right sm:table-cell"
                />
                <TableHead className="hidden sm:table-cell">Situação</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <LoadingRows columns={8} />
              ) : query.data?.items.length ? (
                query.data.items.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/produtos/${p.id}`)}>
                    <TableCell className="hidden pl-4 font-mono text-xs sm:table-cell">{p.sku}</TableCell>
                    <TableCell className="max-w-72 pl-4 sm:pl-2">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-mono sm:hidden">{p.sku} · </span>
                        {p.category?.name ?? "Sem categoria"}
                        {!p.is_active && " · inativo"}
                      </p>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular text-right",
                        p.total_stock <= 0 ? "text-destructive" : p.min_stock > 0 && p.total_stock <= p.min_stock && "text-amber-600 sm:text-inherit",
                        p.total_stock <= 0 && "sm:text-inherit",
                      )}
                    >
                      {formatQty(p.total_stock)} <span className="text-xs text-muted-foreground">{p.unit}</span>
                    </TableCell>
                    <TableCell className="tabular hidden text-right text-muted-foreground md:table-cell">
                      {formatQty(p.min_stock)}
                    </TableCell>
                    <TableCell className="tabular hidden text-right lg:table-cell">
                      {formatCurrency(p.cost_price)}
                    </TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">
                      {formatCurrency(p.stock_value)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {p.is_active ? <StockBadge stock={p.total_stock} min={p.min_stock} /> : <ActiveBadge active={false} />}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label="Ações">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to={`/produtos/${p.id}`}>
                              <Eye /> Detalhes
                            </Link>
                          </DropdownMenuItem>
                          {can("manager") && (
                            <DropdownMenuItem
                              onSelect={() => {
                                setEditing({ ...p, stock: [] })
                                setFormOpen(true)
                              }}
                            >
                              <Pencil /> Editar
                            </DropdownMenuItem>
                          )}
                          {can("operator") && (
                            <DropdownMenuItem asChild>
                              <Link to={`/movimentacoes?nova=entry&produto=${p.id}`}>
                                <ArrowUpDown /> Movimentar
                              </Link>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8}>
                    <EmptyState
                      title="Nenhum produto encontrado"
                      description="Ajuste os filtros ou cadastre um novo produto."
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
        {query.data && query.data.total > 0 && (
          <Pagination
            page={query.data.page}
            pages={query.data.pages}
            total={query.data.total}
            onPage={(p) => update({ page: String(p) })}
          />
        )}
      </Card>

      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        product={editing}
        onSaved={(saved) => !editing && navigate(`/produtos/${saved.id}`)}
      />
    </>
  )
}
