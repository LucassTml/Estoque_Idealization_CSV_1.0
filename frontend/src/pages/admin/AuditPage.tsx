import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Fragment, useState } from "react"
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { client, unwrap } from "@/lib/api"
import { formatDateTime } from "@/lib/utils"

const ENTITIES: Record<string, string> = {
  product: "Produto",
  purchase_order: "Pedido de compra",
  user: "Usuário",
  supplier: "Fornecedor",
  warehouse: "Depósito",
  category: "Categoria",
  settings: "Configuração",
}

export default function AuditPage() {
  const [page, setPage] = useState(1)
  const [entity, setEntity] = useState("all")
  const [expanded, setExpanded] = useState<number | null>(null)
  const query = useQuery({
    queryKey: ["audit", page, entity],
    queryFn: () =>
      unwrap(
        client.GET("/api/v1/audit", {
          params: { query: { page, page_size: 30, entity_type: entity === "all" ? undefined : entity } },
        }),
      ),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader title="Auditoria" description="Registro de quem fez o quê, quando e de onde." />
      <Card className="gap-0 py-0">
        <div className="border-b p-4">
          <Select value={entity} onValueChange={(v) => { setEntity(v); setPage(1) }}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as entidades</SelectItem>
              {Object.entries(ENTITIES).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {query.error ? <ErrorState error={query.error} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 pl-4" />
                <TableHead>Quando</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="hidden lg:table-cell">IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? <LoadingRows columns={6} /> : query.data?.items.length ? query.data.items.map((log) => (
                <Fragment key={log.id}>
                  <TableRow className={log.changes ? "cursor-pointer" : undefined} onClick={() => log.changes && setExpanded(expanded === log.id ? null : log.id)}>
                    <TableCell className="pl-4 text-muted-foreground">
                      {log.changes && (expanded === log.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />)}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{formatDateTime(log.created_at)}</TableCell>
                    <TableCell className="text-sm">{log.user?.name ?? "Sistema"}</TableCell>
                    <TableCell><Badge variant="secondary" className="font-mono text-[11px]">{log.action}</Badge></TableCell>
                    <TableCell className="max-w-md truncate text-sm">{log.summary}</TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">{log.ip_address ?? "—"}</TableCell>
                  </TableRow>
                  {expanded === log.id && log.changes && (
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell />
                      <TableCell colSpan={5}>
                        <ul className="grid gap-1 text-xs">
                          {Object.entries(log.changes).map(([field, change]) => {
                            const c = change as { from?: unknown; to?: unknown } | string
                            return (
                              <li key={field} className="font-mono">
                                <span className="text-muted-foreground">{field}:</span>{" "}
                                {typeof c === "object" && c !== null && "from" in c ? (
                                  <><span className="text-destructive line-through">{String(c.from ?? "∅")}</span> → <span className="text-success">{String(c.to ?? "∅")}</span></>
                                ) : String(c)}
                              </li>
                            )
                          })}
                        </ul>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )) : (
                <TableRow><TableCell colSpan={6}><EmptyState title="Nenhum registro" /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
        {query.data && query.data.total > 0 && <Pagination page={query.data.page} pages={query.data.pages} total={query.data.total} onPage={setPage} />}
      </Card>
    </>
  )
}
