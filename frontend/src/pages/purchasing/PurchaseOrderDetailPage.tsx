import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Ban, FileText, PackageCheck, Pencil, Send } from "lucide-react"
import { useState } from "react"
import { Link, useParams } from "react-router"
import { toast } from "sonner"
import { PoStatusBadge } from "@/components/badges"
import { ErrorState, Spinner } from "@/components/common"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { client, errorMessage, fetchFile, unwrap } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { PurchaseOrderDetail } from "@/lib/queries"
import { formatCurrency, formatDate, formatDateTime, formatQty, openBlob } from "@/lib/utils"

function ReceiveDialog({ order, open, onOpenChange }: { order: PurchaseOrderDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient()
  const pending = order.items.filter((i) => i.quantity_pending > 0)
  const [values, setValues] = useState<Record<number, { qty: string; cost: string }>>({})
  const [notes, setNotes] = useState("")

  const get = (id: number, pendingQty: number, cost: number) =>
    values[id] ?? { qty: String(pendingQty), cost: String(cost) }

  const receive = useMutation({
    mutationFn: () => {
      const items = pending
        .map((item) => {
          const v = get(item.id, item.quantity_pending, item.unit_cost)
          return {
            item_id: item.id,
            quantity: Number(v.qty.replace(",", ".")) || 0,
            unit_cost: v.cost.trim() ? Number(v.cost.replace(",", ".")) : null,
          }
        })
        .filter((i) => i.quantity > 0)
      if (!items.length) throw new Error("Informe ao menos uma quantidade recebida.")
      return unwrap(
        client.POST("/api/v1/purchase-orders/{order_id}/receive", {
          params: { path: { order_id: order.id } },
          body: { items, notes: notes || null },
        }),
      )
    },
    onSuccess: (updated) => {
      toast.success(updated.status === "received" ? "Pedido recebido por completo." : "Recebimento parcial registrado.")
      queryClient.setQueryData(["purchase-order", order.id], updated)
      for (const key of ["purchase-orders", "products", "movements", "dashboard", "alerts", "replenishment"]) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
      onOpenChange(false)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Receber mercadorias</DialogTitle>
          <DialogDescription>
            Confira com a nota fiscal. Ajuste a quantidade para recebimento parcial e o custo se mudou — o custo médio
            dos produtos será recalculado.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50dvh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Pendente</TableHead>
                <TableHead className="w-28 text-right">Recebido</TableHead>
                <TableHead className="w-28 text-right">Custo un.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((item) => {
                const v = get(item.id, item.quantity_pending, item.unit_cost)
                return (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-56">
                      <p className="truncate">{item.product.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{item.product.sku}</p>
                    </TableCell>
                    <TableCell className="tabular text-right">{formatQty(item.quantity_pending)} {item.product.unit}</TableCell>
                    <TableCell>
                      <Input className="text-right" inputMode="decimal" value={v.qty} onChange={(e) => setValues({ ...values, [item.id]: { ...v, qty: e.target.value } })} />
                    </TableCell>
                    <TableCell>
                      <Input className="text-right" inputMode="decimal" value={v.cost} onChange={(e) => setValues({ ...values, [item.id]: { ...v, cost: e.target.value } })} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <Textarea placeholder="Observações (ex.: número da NF)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => receive.mutate()} disabled={receive.isPending}>
            {receive.isPending && <Spinner />} Confirmar recebimento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function PurchaseOrderDetailPage() {
  const id = Number(useParams().id)
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [receiveOpen, setReceiveOpen] = useState(false)
  const { data: order, isLoading, error, refetch } = useQuery({
    queryKey: ["purchase-order", id],
    queryFn: () => unwrap(client.GET("/api/v1/purchase-orders/{order_id}", { params: { path: { order_id: id } } })),
  })

  const action = useMutation({
    mutationFn: (kind: "submit" | "cancel") =>
      kind === "submit"
        ? unwrap(client.POST("/api/v1/purchase-orders/{order_id}/submit", { params: { path: { order_id: id } } }))
        : unwrap(client.POST("/api/v1/purchase-orders/{order_id}/cancel", { params: { path: { order_id: id } } })),
    onSuccess: (updated, kind) => {
      toast.success(kind === "submit" ? "Pedido enviado ao fornecedor." : "Pedido cancelado.")
      queryClient.setQueryData(["purchase-order", id], updated)
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] })
      queryClient.invalidateQueries({ queryKey: ["replenishment"] })
    },
  })

  const openPdf = async () => {
    try {
      openBlob(await fetchFile(`/api/v1/purchase-orders/${id}/pdf`))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (isLoading) return <div className="flex justify-center py-20"><Spinner className="size-6" /></div>
  if (error || !order) return <ErrorState error={error} onRetry={refetch} />

  const received = order.items.reduce((s, i) => s + i.quantity_received, 0)
  const ordered = order.items.reduce((s, i) => s + i.quantity_ordered, 0)
  const progress = ordered ? (received / ordered) * 100 : 0

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2 text-muted-foreground">
        <Link to="/compras"><ArrowLeft /> Pedidos de compra</Link>
      </Button>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{order.number}</h1>
            <PoStatusBadge status={order.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.supplier.name} · entrega em {order.warehouse.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={openPdf}><FileText /> PDF</Button>
          {can("manager") && order.status === "draft" && (
            <>
              <Button variant="outline" asChild><Link to={`/compras/${id}/editar`}><Pencil /> Editar</Link></Button>
              <Button onClick={() => action.mutate("submit")} disabled={action.isPending}><Send /> Enviar ao fornecedor</Button>
            </>
          )}
          {can("operator") && ["ordered", "partially_received"].includes(order.status) && (
            <Button onClick={() => setReceiveOpen(true)}><PackageCheck /> Receber</Button>
          )}
          {can("manager") && ["draft", "ordered"].includes(order.status) && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive"><Ban /> Cancelar</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancelar {order.number}?</AlertDialogTitle>
                  <AlertDialogDescription>O pedido deixa de contar como "em pedido" na previsão de reposição.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Voltar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => action.mutate("cancel")}>Cancelar pedido</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit gap-0 py-0 lg:col-span-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Produto</TableHead>
                <TableHead className="text-right">Pedido</TableHead>
                <TableHead className="text-right">Recebido</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Custo un.</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-64 pl-4">
                    <Link to={`/produtos/${item.product.id}`} className="block truncate font-medium hover:underline">{item.product.name}</Link>
                    <span className="font-mono text-xs text-muted-foreground">{item.product.sku}</span>
                  </TableCell>
                  <TableCell className="tabular text-right">{formatQty(item.quantity_ordered)} {item.product.unit}</TableCell>
                  <TableCell className="tabular text-right">
                    <span className={item.quantity_pending === 0 ? "text-success" : undefined}>{formatQty(item.quantity_received)}</span>
                  </TableCell>
                  <TableCell className="tabular hidden text-right sm:table-cell">{formatCurrency(item.unit_cost)}</TableCell>
                  <TableCell className="tabular text-right">{formatCurrency(item.quantity_ordered * item.unit_cost)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="pl-4 text-right font-medium">Total</TableCell>
                <TableCell className="tabular text-right text-base font-semibold">{formatCurrency(order.total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>

        <Card className="h-fit">
          <CardHeader><CardTitle>Resumo</CardTitle></CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <div>
              <div className="mb-1.5 flex justify-between">
                <span className="text-muted-foreground">Recebimento</span>
                <span className="tabular">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} />
            </div>
            <dl className="grid gap-2">
              <div className="flex justify-between"><dt className="text-muted-foreground">Criado</dt><dd>{formatDateTime(order.created_at)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Por</dt><dd>{order.created_by?.name ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Enviado</dt><dd>{formatDateTime(order.ordered_at)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Previsão</dt><dd>{formatDate(order.expected_date)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Recebido</dt><dd>{formatDateTime(order.received_at)}</dd></div>
            </dl>
            {order.notes && (
              <div className="rounded-md bg-muted p-3">
                <p className="mb-1 text-xs text-muted-foreground">Observações</p>
                <p className="whitespace-pre-line">{order.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {receiveOpen && <ReceiveDialog order={order} open={receiveOpen} onOpenChange={setReceiveOpen} />}
    </>
  )
}
