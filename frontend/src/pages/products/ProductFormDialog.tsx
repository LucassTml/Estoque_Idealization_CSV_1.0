import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { Field, Spinner } from "@/components/common"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { client, unwrap } from "@/lib/api"
import { useCategories, useSuppliers, type ProductDetail } from "@/lib/queries"

const UNITS = ["UN", "PC", "CX", "PCT", "KG", "G", "L", "ML", "M", "M2", "PAR", "FD", "KIT", "RL"]
const NONE = "none"

const num = (message = "Número inválido") =>
  z
    .union([z.string(), z.number()])
    .transform((value) => (typeof value === "string" ? value.replace(",", ".").trim() : String(value)))
    .refine((value) => value === "" || (!Number.isNaN(Number(value)) && Number(value) >= 0), message)

const schema = z.object({
  sku: z.string().trim().min(1, "Obrigatório").max(40),
  name: z.string().trim().min(1, "Obrigatório").max(160),
  barcode: z.string().trim().max(64).optional(),
  unit: z.string().min(1),
  category_id: z.string(),
  supplier_id: z.string(),
  cost_price: num(),
  sale_price: num(),
  min_stock: num(),
  max_stock: num(),
  description: z.string().optional(),
  is_active: z.boolean(),
})

type FormValues = z.input<typeof schema>

function toNumber(value: string) {
  return value === "" ? 0 : Number(value)
}

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product?: ProductDetail | null
  onSaved?: (product: ProductDetail) => void
}) {
  const queryClient = useQueryClient()
  const { data: categories } = useCategories()
  const { data: suppliers } = useSuppliers()
  const editing = Boolean(product)

  const form = useForm<FormValues>({ resolver: zodResolver(schema) })
  const { errors } = form.formState

  useEffect(() => {
    if (!open) return
    form.reset({
      sku: product?.sku ?? "",
      name: product?.name ?? "",
      barcode: product?.barcode ?? "",
      unit: product?.unit ?? "UN",
      category_id: product?.category ? String(product.category.id) : NONE,
      supplier_id: product?.supplier ? String(product.supplier.id) : NONE,
      cost_price: String(product?.cost_price ?? ""),
      sale_price: String(product?.sale_price ?? ""),
      min_stock: String(product?.min_stock ?? ""),
      max_stock: product?.max_stock != null ? String(product.max_stock) : "",
      description: product?.description ?? "",
      is_active: product?.is_active ?? true,
    })
  }, [open, product, form])

  const save = useMutation({
    mutationFn: async (values: z.output<typeof schema>) => {
      const body = {
        sku: values.sku,
        name: values.name,
        barcode: values.barcode || null,
        unit: values.unit,
        category_id: values.category_id === NONE ? null : Number(values.category_id),
        supplier_id: values.supplier_id === NONE ? null : Number(values.supplier_id),
        cost_price: toNumber(values.cost_price),
        sale_price: toNumber(values.sale_price),
        min_stock: toNumber(values.min_stock),
        max_stock: values.max_stock === "" ? null : Number(values.max_stock),
        description: values.description || null,
        is_active: values.is_active,
      }
      if (product) {
        return unwrap(
          client.PATCH("/api/v1/products/{product_id}", { params: { path: { product_id: product.id } }, body }),
        )
      }
      return unwrap(client.POST("/api/v1/products", { body }))
    },
    onSuccess: (saved) => {
      toast.success(editing ? "Produto atualizado." : "Produto cadastrado.")
      queryClient.invalidateQueries({ queryKey: ["products"] })
      queryClient.invalidateQueries({ queryKey: ["product", saved.id] })
      onOpenChange(false)
      onSaved?.(saved)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Editar ${product?.sku}` : "Novo produto"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "O custo médio é recalculado automaticamente a cada entrada com custo."
              : "O estoque inicial é lançado depois, em Movimentações → Entrada."}
          </DialogDescription>
        </DialogHeader>
        <form
          id="product-form"
          className="grid gap-4 sm:grid-cols-6"
          onSubmit={form.handleSubmit((values) => save.mutate(values as z.output<typeof schema>))}
          noValidate
        >
          <Field label="SKU / código" htmlFor="sku" error={errors.sku?.message} className="sm:col-span-2">
            <Input id="sku" className="uppercase" {...form.register("sku")} />
          </Field>
          <Field label="Nome" htmlFor="name" error={errors.name?.message} className="sm:col-span-4">
            <Input id="name" {...form.register("name")} />
          </Field>
          <Field label="Código de barras (EAN)" htmlFor="barcode" className="sm:col-span-3">
            <Input id="barcode" inputMode="numeric" {...form.register("barcode")} />
          </Field>
          <Field label="Unidade" className="sm:col-span-3">
            <Controller
              control={form.control}
              name="unit"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...new Set([...UNITS, field.value])].filter(Boolean).map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Categoria" className="sm:col-span-3">
            <Controller
              control={form.control}
              name="category_id"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem categoria</SelectItem>
                    {categories?.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Fornecedor preferencial" className="sm:col-span-3">
            <Controller
              control={form.control}
              name="supplier_id"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nenhum</SelectItem>
                    {suppliers?.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Custo médio (R$)" htmlFor="cost" error={errors.cost_price?.message} className="sm:col-span-3">
            <Input id="cost" inputMode="decimal" {...form.register("cost_price")} />
          </Field>
          <Field label="Preço de venda (R$)" htmlFor="price" error={errors.sale_price?.message} className="sm:col-span-3">
            <Input id="price" inputMode="decimal" {...form.register("sale_price")} />
          </Field>
          <Field
            label="Estoque mínimo"
            htmlFor="min"
            error={errors.min_stock?.message}
            hint="Abaixo disso gera alerta"
            className="sm:col-span-3"
          >
            <Input id="min" inputMode="decimal" {...form.register("min_stock")} />
          </Field>
          <Field
            label="Estoque máximo"
            htmlFor="max"
            error={errors.max_stock?.message}
            hint="Limita a sugestão de compra"
            className="sm:col-span-3"
          >
            <Input id="max" inputMode="decimal" {...form.register("max_stock")} />
          </Field>
          <Field label="Descrição" htmlFor="description" className="sm:col-span-6">
            <Textarea id="description" rows={2} {...form.register("description")} />
          </Field>
          <div className="flex items-center gap-3 sm:col-span-6">
            <Controller
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <Switch id="active" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
            <label htmlFor="active" className="text-sm">
              Produto ativo
            </label>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="product-form" disabled={save.isPending}>
            {save.isPending && <Spinner />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
