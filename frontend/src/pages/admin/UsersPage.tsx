import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ActiveBadge, RoleBadge } from "@/components/badges"
import { ErrorState, Field, LoadingRows, PageHeader, Spinner } from "@/components/common"
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
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { client, unwrap } from "@/lib/api"
import { ROLE_LABELS, useAuth, type Role, type User } from "@/lib/auth"
import { formatDateTime } from "@/lib/utils"

const ROLE_HELP: Record<Role, string> = {
  admin: "Tudo, incluindo usuários, configurações e auditoria.",
  manager: "Cadastros, compras, ajustes de inventário e relatórios.",
  operator: "Entradas, saídas, transferências e recebimento de pedidos.",
  viewer: "Apenas consulta.",
}

function UserDialog({ user, open, onOpenChange }: { user: User | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient()
  // O componente é remontado (key) a cada abertura, então o estado nasce dos props.
  const [name, setName] = useState(user?.name ?? "")
  const [email, setEmail] = useState(user?.email ?? "")
  const [role, setRole] = useState<Role>(user?.role ?? "operator")
  const [password, setPassword] = useState("")
  const [active, setActive] = useState(user?.is_active ?? true)

  const save = useMutation({
    mutationFn: () =>
      user
        ? unwrap(
            client.PATCH("/api/v1/users/{user_id}", {
              params: { path: { user_id: user.id } },
              body: { name, role, is_active: active, password: password || null },
            }),
          )
        : unwrap(client.POST("/api/v1/users", { body: { name, email, role, password } })),
    onSuccess: () => {
      toast.success(user ? "Usuário atualizado." : "Usuário criado.")
      queryClient.invalidateQueries({ queryKey: ["users"] })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user ? "Editar usuário" : "Novo usuário"}</DialogTitle>
          <DialogDescription>{ROLE_HELP[role]}</DialogDescription>
        </DialogHeader>
        <form id="user-form" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <Field label="Nome" htmlFor="u-name"><Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></Field>
          <Field label="E-mail" htmlFor="u-email">
            <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={Boolean(user)} />
          </Field>
          <Field label="Perfil">
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={user ? "Nova senha (opcional)" : "Senha"} htmlFor="u-pass" hint="Mínimo de 8 caracteres">
            <Input id="u-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required={!user} minLength={8} />
          </Field>
          {user && (
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={active} onCheckedChange={setActive} /> Acesso ativo
            </label>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="user-form" disabled={save.isPending}>{save.isPending && <Spinner />} Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function UsersPage() {
  const { user: me } = useAuth()
  const [editing, setEditing] = useState<User | null>(null)
  const [open, setOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const openForm = (user: User | null) => {
    setEditing(user)
    setFormKey((k) => k + 1)
    setOpen(true)
  }
  const query = useQuery({ queryKey: ["users"], queryFn: () => unwrap(client.GET("/api/v1/users")) })

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Controle de acesso por perfil (RBAC)."
        actions={<Button onClick={() => openForm(null)}><Plus /> Novo usuário</Button>}
      />
      <Card className="gap-0 py-0">
        {query.error ? <ErrorState error={query.error} onRetry={query.refetch} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Usuário</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead className="hidden md:table-cell">Último acesso</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? <LoadingRows columns={5} /> : query.data?.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="pl-4">
                    <p className="font-medium">{u.name} {u.id === me?.id && <span className="text-xs text-muted-foreground">(você)</span>}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </TableCell>
                  <TableCell><RoleBadge role={u.role} /></TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{formatDateTime(u.last_login_at)}</TableCell>
                  <TableCell><ActiveBadge active={u.is_active} /></TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="size-8" aria-label="Editar" onClick={() => openForm(u)} disabled={u.is_demo}>
                      <Pencil />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <UserDialog key={formKey} user={editing} open={open} onOpenChange={setOpen} />
    </>
  )
}
