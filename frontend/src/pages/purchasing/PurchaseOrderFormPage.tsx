import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { toast } from "sonner"
import { ErrorState, Field, PageHeader, Spinner } from "@/components/common"
import { ProductPicker, type PickedProduct } from "@/components/ProductPicker"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { client, unwrap } from "@/lib/api"
import { useSuppliers, useWarehouses, type PurchaseOrderDetail } from "@/lib/queries"
import { formatCurrency } from "@/lib/utils"

type Line = { key: number; product: PickedProduct | null; quantity: string; unitCost: string }

let nextKey = 1
const emptyLine = (): Line => ({ key: nextKey++, product: null, quantity: "", unitCost: "" })
const toNumber = (value: string) => Number(value.replace(",", ".")) || 0

export default function PurchaseOrderFormPage() {
  const params = useParams()
  const editingId = params.id ? Number(params.id) : null
  const existing = useQuery({
    queryKey: ["purchase-order", editingId],
    queryFn: () =>
      unwrap(client.GET("/api/v1/purchase-orders/{order_id}", { params: { path: { order_id: editingId! } } })),
    enabled: editingId !== null,
  })
  if (editingId && !existing.data) {
    return existing.error ? <ErrorState error={existing.error} /> : <div className="flex justify-center py-20"><Spinner className="size-6" /></div>
  }
  return <OrderForm order={existing.data ?? null} />
}

function OrderForm({ order }: { order: PurchaseOrderDetail | null }) {
  const editingId = order?.id ?? null
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: suppliers } = useSuppliers()
  const { data: warehouses } = useWarehouses(true)
  const [supplierId, setSupplierId] = useState(order ? String(order.supplier.id) : "")
  const [chosenWarehouse, setWarehouseId] = useState(order ? String(order.warehouse.id) : "")
  const [expectedDate, setExpectedDate] = useState(order?.expected_date ?? "")
  const [notes, setNotes] = useState(order?.notes ?? "")
  const [lines, setLines] = useState<Line[]>(() =>
    order
      ? order.items.map((item) => ({
          key: nextKey++,
          product: { ...item.product, cost_price: item.unit_cost, total_stock: 0 },
          quantity: String(item.quantity_ordered),
          unitCost: String(item.unit_cost),
        }))
      : [emptyLine()],
  )
  const warehouseId = chosenWarehouse || (warehouses?.length ? String(warehouses[0].id) : "")

  const total = lines.reduce((sum, l) => sum + toNumber(l.quantity) * toNumber(l.unitCost), 0)
  const updateLine = (key: number, changes: Partial<Line>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...changes } : l)))

  const save = useMutation({
    mutationFn: async () => {
      const items = lines
        .filter((l) => l.product)
        .map((l) => ({ product_id: l.product!.id, quantity_ordered: toNumber(l.quantity), unit_cost: toNumber(l.unitCost) }))
      if (!supplierId) throw new Error("Selecione o fornecedor.")
      if (!items.length) throw new Error("Adicione pelo menos um item.")
      if (items.some((i) => i.quantity_ordered <= 0)) throw new Error("Todas as quantidades devem ser maiores que zero.")
      const body = {
        supplier_id: Number(supplierId),
        warehouse_id: Number(warehouseId),
        expected_date: expectedDate || null,
        notes: notes || null,
        items,
      }
      if (editingId) {
        return unwrap(client.PATCH("/api/v1/purchase-orders/{order_id}", { params: { path: { order_id: editingId } }, body }))
      }
      return unwrap(client.POST("/api/v1/purchase-orders", { body }))
    },
    onSuccess: (order) => {
      toast.success(editingId ? "Pedido atualizado." : `Pedido ${order.number} criado como rascunho.`)
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] })
      queryClient.invalidateQueries({ queryKey: ["purchase-order", order.id] })
      navigate(`/compras/${order.id}`)
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2 text-muted-foreground">
        <Link to={editingId ? `/compras/${editingId}` : "/compras"}><ArrowLeft /> Voltar</Link>
      </Button>
      <PageHeader
        title={order ? `Editar ${order.number}` : "Novo pedido de compra"}
        description="O pedido nasce como rascunho. Envie ao fornecedor quando estiver pronto."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Itens</CardTitle></CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Produto</TableHead>
                  <TableHead className="w-28 text-right">Qtd.</TableHead>
                  <TableHead className="w-32 text-right">Custo un.</TableHead>
                  <TableHead className="hidden w-32 text-right sm:table-cell">Subtotal</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.key}>
                    <TableCell className="pl-6">
                      <ProductPicker
                        value={line.product}
                        onChange={(product) =>
                          updateLine(line.key, {
                            product,
                            unitCost: line.unitCost || (product ? String(product.cost_price) : ""),
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input className="text-right" inputMode="decimal" value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input className="text-right" inputMode="decimal" value={line.unitCost} onChange={(e) => updateLine(line.key, { unitCost: e.target.value })} />
                    </TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">
                      {formatCurrency(toNumber(line.quantity) * toNumber(line.unitCost))}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label="Remover item"
                        disabled={lines.length === 1}
                        onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between px-6 pt-4">
              <Button variant="outline" size="sm" onClick={() => setLines((current) => [...current, emptyLine()])}>
                <Plus /> Adicionar item
              </Button>
              <p className="text-sm">
                Total <span className="tabular ml-2 text-lg font-semibold">{formatCurrency(total)}</span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader><CardTitle>Dados do pedido</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Fornecedor">
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {suppliers?.filter((s) => s.is_active).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Depósito de entrega">
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {warehouses?.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.code} — {w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Previsão de entrega" htmlFor="expected">
              <Input id="expected" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </Field>
            <Field label="Observações" htmlFor="notes">
              <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Spinner />} {editingId ? "Salvar alterações" : "Criar rascunho"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
