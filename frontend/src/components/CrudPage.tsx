import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import { EmptyState, ErrorState, Field, LoadingRows, PageHeader, Spinner } from "@/components/common"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useAuth, type Role } from "@/lib/auth"
import { cn } from "@/lib/utils"

type FieldType = "text" | "email" | "number" | "textarea" | "switch"

export type CrudField = {
  name: string
  label: string
  type?: FieldType
  required?: boolean
  placeholder?: string
  hint?: string
  span?: 1 | 2
  defaultValue?: string | number | boolean
}

export type CrudColumn<T> = { header: string; cell: (row: T) => ReactNode; className?: string }

type FormState = Record<string, string | boolean>

/** Página de listagem + formulário em diálogo para cadastros simples. */
export function CrudPage<T extends { id: number }>({
  title,
  description,
  entityName,
  queryKey,
  list,
  columns,
  fields,
  create,
  update,
  remove,
  searchText,
  writeRole = "manager",
  deleteWarning,
}: {
  title: string
  description: string
  entityName: string
  queryKey: readonly unknown[]
  list: () => Promise<T[]>
  columns: CrudColumn<T>[]
  fields: CrudField[]
  create: (body: Record<string, unknown>) => Promise<unknown>
  update: (id: number, body: Record<string, unknown>) => Promise<unknown>
  remove?: (id: number) => Promise<unknown>
  searchText: (row: T) => string
  writeRole?: Role
  deleteWarning?: string
}) {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<T | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>({})
  const [deleting, setDeleting] = useState<T | null>(null)
  const query = useQuery({ queryKey, queryFn: list })
  const canWrite = can(writeRole)

  /** Abre o formulário já preenchido (o estado nasce no clique, não num efeito). */
  const openForm = (row: T | null) => {
    const initial: FormState = {}
    for (const field of fields) {
      const current = row ? (row as Record<string, unknown>)[field.name] : field.defaultValue
      initial[field.name] =
        field.type === "switch" ? Boolean(current ?? true) : current === null || current === undefined ? "" : String(current)
    }
    setEditing(row)
    setForm(initial)
    setOpen(true)
  }

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {}
      for (const field of fields) {
        const value = form[field.name]
        if (field.type === "switch") body[field.name] = Boolean(value)
        else if (field.type === "number") body[field.name] = value === "" ? null : Number(String(value).replace(",", "."))
        else body[field.name] = String(value ?? "").trim() || null
      }
      return editing ? update(editing.id, body) : create(body)
    },
    onSuccess: () => {
      toast.success(`${entityName} ${editing ? "atualizado(a)" : "cadastrado(a)"}.`)
      queryClient.invalidateQueries({ queryKey })
      setOpen(false)
    },
  })

  const destroy = useMutation({
    mutationFn: (id: number) => remove!(id),
    onSuccess: () => {
      toast.success(`${entityName} excluído(a).`)
      queryClient.invalidateQueries({ queryKey })
    },
  })

  const rows = (query.data ?? []).filter((row) => searchText(row).toLowerCase().includes(search.toLowerCase()))

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          canWrite && (
            <Button
              onClick={() => openForm(null)}
            >
              <Plus /> Novo
            </Button>
          )
        }
      />
      <Card className="gap-0 py-0">
        <div className="border-b p-4">
          <div className="relative max-w-sm">
            <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Filtrar" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {query.error ? (
          <ErrorState error={query.error} onRetry={query.refetch} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c, i) => (
                  <TableHead key={c.header} className={cn(i === 0 && "pl-4", c.className)}>{c.header}</TableHead>
                ))}
                {canWrite && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <LoadingRows columns={columns.length + 1} />
              ) : rows.length ? (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    {columns.map((c, i) => (
                      <TableCell key={c.header} className={cn(i === 0 && "pl-4", c.className)}>{c.cell(row)}</TableCell>
                    ))}
                    {canWrite && (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8" aria-label="Ações"><MoreHorizontal /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openForm(row)}>
                              <Pencil /> Editar
                            </DropdownMenuItem>
                            {remove && (
                              <DropdownMenuItem className="text-destructive" onSelect={() => setDeleting(row)}>
                                <Trash2 /> Excluir
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length + 1}><EmptyState title="Nenhum registro" /></TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar ${entityName.toLowerCase()}` : `Novo(a) ${entityName.toLowerCase()}`}</DialogTitle>
            <DialogDescription>Campos com * são obrigatórios.</DialogDescription>
          </DialogHeader>
          <form
            id="crud-form"
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate()
            }}
          >
            {fields.map((field) =>
              field.type === "switch" ? (
                <label key={field.name} className="flex items-center gap-3 text-sm sm:col-span-2">
                  <Switch checked={Boolean(form[field.name])} onCheckedChange={(v) => setForm({ ...form, [field.name]: v })} />
                  {field.label}
                </label>
              ) : (
                <Field
                  key={field.name}
                  label={`${field.label}${field.required ? " *" : ""}`}
                  htmlFor={field.name}
                  hint={field.hint}
                  className={field.span === 1 ? undefined : "sm:col-span-2"}
                >
                  {field.type === "textarea" ? (
                    <Textarea id={field.name} rows={3} value={String(form[field.name] ?? "")} onChange={(e) => setForm({ ...form, [field.name]: e.target.value })} />
                  ) : (
                    <Input
                      id={field.name}
                      type={field.type === "number" ? "text" : (field.type ?? "text")}
                      inputMode={field.type === "number" ? "decimal" : undefined}
                      required={field.required}
                      placeholder={field.placeholder}
                      value={String(form[field.name] ?? "")}
                      onChange={(e) => setForm({ ...form, [field.name]: e.target.value })}
                    />
                  )}
                </Field>
              ),
            )}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" form="crud-form" disabled={save.isPending}>{save.isPending && <Spinner />} Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {entityName.toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>{deleteWarning ?? "Esta ação não pode ser desfeita."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && destroy.mutate(deleting.id)}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
