import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery } from "@tanstack/react-query"
import { BarChart3, Boxes, ScanBarcode, Sparkles } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { Navigate, useLocation, useNavigate } from "react-router"
import { z } from "zod"
import { Field, Spinner } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { client, errorMessage, unwrap } from "@/lib/api"
import { useAuth } from "@/lib/auth"

const loginSchema = z.object({
  email: z.email("Informe um e-mail válido"),
  password: z.string().min(1, "Informe a senha"),
})

const setupSchema = z
  .object({
    name: z.string().min(2, "Informe seu nome"),
    email: z.email("Informe um e-mail válido"),
    password: z.string().min(8, "Mínimo de 8 caracteres"),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, { message: "As senhas não conferem", path: ["confirm"] })

const DEMO_ACCOUNTS = [
  { label: "Administrador", email: "admin@demo.com" },
  { label: "Gerente", email: "gerente@demo.com" },
  { label: "Operador", email: "operador@demo.com" },
  { label: "Leitura", email: "leitura@demo.com" },
]

function LoginForm({ demo }: { demo: boolean }) {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  })

  const submit = form.handleSubmit(async (values) => {
    setError(null)
    try {
      await login(values.email, values.password)
      navigate((location.state as { from?: string } | null)?.from ?? "/", { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    }
  })

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <Field label="E-mail" htmlFor="email" error={form.formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="username" autoFocus {...form.register("email")} />
      </Field>
      <Field label="Senha" htmlFor="password" error={form.formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} />
      </Field>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Spinner />} Entrar
      </Button>
      {demo && (
        <div className="rounded-lg border border-dashed p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Demonstração — clique para entrar como (senha <code className="font-mono">demo1234</code>):
          </p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((account) => (
              <Button
                key={account.email}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  form.setValue("email", account.email)
                  form.setValue("password", "demo1234")
                  void submit()
                }}
              >
                {account.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </form>
  )
}

function SetupForm() {
  const { setup } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const form = useForm<z.infer<typeof setupSchema>>({
    resolver: zodResolver(setupSchema),
    defaultValues: { name: "", email: "", password: "", confirm: "" },
  })
  const { errors, isSubmitting } = form.formState

  const submit = form.handleSubmit(async (values) => {
    setError(null)
    try {
      await setup(values.name, values.email, values.password)
      navigate("/", { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    }
  })

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <Field label="Seu nome" htmlFor="name" error={errors.name?.message}>
        <Input id="name" autoFocus {...form.register("name")} />
      </Field>
      <Field label="E-mail" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="username" {...form.register("email")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Senha" htmlFor="password" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
        </Field>
        <Field label="Confirmar senha" htmlFor="confirm" error={errors.confirm?.message}>
          <Input id="confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
        </Field>
      </div>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting && <Spinner />} Criar administrador e entrar
      </Button>
    </form>
  )
}

const HIGHLIGHTS = [
  { icon: BarChart3, text: "Dashboard, curva ABC e previsão de demanda" },
  { icon: ScanBarcode, text: "Código de barras e QR Code pela câmera do celular" },
  { icon: Sparkles, text: "Assistente com IA que responde sobre seu estoque" },
]

export default function LoginPage() {
  const { user, loading } = useAuth()
  const { data: status, isLoading } = useQuery({
    queryKey: ["setup-status"],
    queryFn: () => unwrap(client.GET("/api/v1/auth/setup-status")),
  })

  if (!loading && user) return <Navigate to="/" replace />
  const needsSetup = status?.needs_setup ?? false

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-lg bg-white/15">
            <Boxes className="size-6" />
          </div>
          <span className="text-lg font-semibold">Estoque Idealization</span>
        </div>
        <div>
          <h2 className="max-w-md text-3xl leading-tight font-semibold">
            Controle de estoque completo, do almoxarifado ao pedido de compra.
          </h2>
          <ul className="mt-8 grid gap-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-primary-foreground/90">
                <Icon className="size-5 shrink-0" /> {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-primary-foreground/70">Versão 2.0 · FastAPI + React</p>
        <div className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full bg-white/10" />
      </div>

      <div className="flex items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">{needsSetup ? "Bem-vindo! Vamos começar" : "Entrar"}</CardTitle>
            <CardDescription>
              {needsSetup
                ? "Crie a conta de administrador. Depois você cadastra os demais usuários."
                : "Acesse com seu e-mail e senha."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Spinner className="size-6" />
              </div>
            ) : needsSetup ? (
              <SetupForm />
            ) : (
              <LoginForm demo={status?.demo_mode ?? false} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
