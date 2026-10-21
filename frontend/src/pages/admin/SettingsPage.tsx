import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Download, FileUp, Mail, MessageCircle, Send, Upload, XCircle } from "lucide-react"
import { useRef, useState } from "react"
import { useSearchParams } from "react-router"
import { toast } from "sonner"
import { Field, PageHeader, Spinner } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { client, errorMessage, fetchFile, unwrap, uploadFile, type Schemas } from "@/lib/api"
import { ROLE_LABELS, useAuth } from "@/lib/auth"
import { keys } from "@/lib/queries"
import { downloadBlob } from "@/lib/utils"

type ImportResult = Schemas["ImportResultOut"]

function ProfileTab() {
  const { user, updateUser } = useAuth()
  const [name, setName] = useState(user?.name ?? "")
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PATCH("/api/v1/auth/me", {
          body: { name, current_password: current || null, new_password: next || null },
        }),
      ),
    onSuccess: (updated) => {
      updateUser(updated)
      setCurrent("")
      setNext("")
      toast.success("Perfil atualizado.")
    },
  })
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Meu perfil</CardTitle>
        <CardDescription>{user?.email} · {user && ROLE_LABELS[user.role]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <Field label="Nome" htmlFor="p-name"><Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Senha atual" htmlFor="p-cur"><Input id="p-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
            <Field label="Nova senha" htmlFor="p-new" hint="Mínimo 8 caracteres"><Input id="p-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          </div>
          <Button type="submit" className="w-fit" disabled={save.isPending}>{save.isPending && <Spinner />} Salvar</Button>
        </form>
      </CardContent>
    </Card>
  )
}

function GeneralTab() {
  const { data } = useQuery({ queryKey: ["settings", "general"], queryFn: () => unwrap(client.GET("/api/v1/settings/general")) })
  return data ? <GeneralForm initial={data} /> : <Spinner />
}

function GeneralForm({ initial }: { initial: Schemas["GeneralSettings"] }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(initial)
  const save = useMutation({
    mutationFn: () => unwrap(client.PUT("/api/v1/settings/general", { body: form })),
    onSuccess: () => {
      toast.success("Configurações salvas.")
      queryClient.invalidateQueries({ queryKey: ["settings"] })
      queryClient.invalidateQueries({ queryKey: keys.meta })
      queryClient.invalidateQueries({ queryKey: ["replenishment"] })
    },
  })
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Geral</CardTitle>
        <CardDescription>Dados da empresa e parâmetros da previsão de demanda.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Nome da empresa" htmlFor="g-company" hint="Aparece nos PDFs e alertas">
          <Input id="g-company" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Horizonte de planejamento" hint="Dias de consumo cobertos por cada compra">
            <Select value={String(form.forecast_horizon_days)} onValueChange={(v) => setForm({ ...form, forecast_horizon_days: Number(v) })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{[7, 15, 30, 45, 60, 90].map((d) => <SelectItem key={d} value={String(d)}>{d} dias</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Nível de serviço" hint="Chance de não faltar durante a entrega">
            <Select value={String(form.service_level)} onValueChange={(v) => setForm({ ...form, service_level: Number(v) })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{[0.8, 0.9, 0.95, 0.98, 0.99].map((s) => <SelectItem key={s} value={String(s)}>{Math.round(s * 100)}%</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        <Button className="w-fit" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Spinner />} Salvar</Button>
      </CardContent>
    </Card>
  )
}

const list = (value: string) =>
  value
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean)

function ChannelStatus({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${ok ? "text-success" : "text-muted-foreground"}`}>
      {ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />} {label}
    </span>
  )
}

function AlertsTab() {
  const { data } = useQuery({ queryKey: ["settings", "alerts"], queryFn: () => unwrap(client.GET("/api/v1/settings/alerts")) })
  return data ? <AlertsForm initial={data} /> : <Spinner />
}

function AlertsForm({ initial }: { initial: Schemas["AlertSettingsOut"] }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(initial)
  const [preview, setPreview] = useState<string | null>(null)
  // Listas editadas como texto livre e convertidas só ao salvar (senão a vírgula some ao digitar).
  const [emails, setEmails] = useState(initial.email_recipients.join(", "))
  const [chats, setChats] = useState(initial.telegram_chat_ids.join(", "))

  const save = useMutation({
    mutationFn: () => {
      const { channels: _channels, ...rest } = form
      const body = { ...rest, email_recipients: list(emails), telegram_chat_ids: list(chats) }
      return unwrap(client.PUT("/api/v1/settings/alerts", { body }))
    },
    onSuccess: () => {
      toast.success("Alertas configurados.")
      queryClient.invalidateQueries({ queryKey: ["settings", "alerts"] })
    },
  })
  const test = useMutation({
    mutationFn: () => unwrap(client.POST("/api/v1/settings/alerts/test")),
    onSuccess: (result) =>
      result.delivered.length
        ? toast.success(`Mensagem de teste enviada por: ${result.delivered.join(", ")}.`)
        : toast.error("Nenhum canal entregou a mensagem. Verifique as credenciais no servidor."),
  })
  const loadPreview = useMutation({
    mutationFn: () => unwrap(client.POST("/api/v1/settings/alerts/summary-preview")),
    onSuccess: (result) => setPreview(`${result.subject}\n\n${result.text}`),
  })

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Canais</CardTitle>
          <CardDescription className="flex flex-wrap gap-4">
            <ChannelStatus ok={form.channels.email_configured} label="SMTP configurado no servidor" />
            <ChannelStatus ok={form.channels.telegram_configured} label="Bot do Telegram configurado" />
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={form.low_stock_enabled} onCheckedChange={(v) => setForm({ ...form, low_stock_enabled: v })} />
            Avisar quando um produto ficar abaixo do mínimo ou zerar
          </label>
          <div className="grid gap-3 rounded-lg border p-4">
            <label className="flex items-center gap-3 text-sm font-medium">
              <Switch checked={form.email_enabled} onCheckedChange={(v) => setForm({ ...form, email_enabled: v })} disabled={!form.channels.email_configured} />
              <Mail className="size-4" /> E-mail
            </label>
            <Field label="Destinatários" hint="Separe por vírgula">
              <Input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="compras@empresa.com, gerente@empresa.com" />
            </Field>
          </div>
          <div className="grid gap-3 rounded-lg border p-4">
            <label className="flex items-center gap-3 text-sm font-medium">
              <Switch checked={form.telegram_enabled} onCheckedChange={(v) => setForm({ ...form, telegram_enabled: v })} disabled={!form.channels.telegram_configured} />
              <MessageCircle className="size-4" /> Telegram
            </label>
            <Field label="Chat IDs" hint="Converse com o bot e use @userinfobot para descobrir seu chat id">
              <Input value={chats} onChange={(e) => setChats(e.target.value)} placeholder="123456789" />
            </Field>
          </div>
          <div className="grid gap-3 rounded-lg border p-4">
            <label className="flex items-center gap-3 text-sm font-medium">
              <Switch checked={form.daily_summary_enabled} onCheckedChange={(v) => setForm({ ...form, daily_summary_enabled: v })} />
              Resumo diário
            </label>
            <Field label="Horário de envio">
              <Select value={String(form.daily_summary_hour)} onValueChange={(v) => setForm({ ...form, daily_summary_hour: Number(v) })}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{Array.from({ length: 24 }, (_, h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Spinner />} Salvar</Button>
            <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}><Send /> Enviar teste</Button>
            <Button variant="ghost" onClick={() => loadPreview.mutate()}>Pré-visualizar resumo</Button>
          </div>
        </CardContent>
      </Card>
      {preview && (
        <Card>
          <CardHeader><CardTitle>Prévia do resumo diário</CardTitle></CardHeader>
          <CardContent><Textarea readOnly value={preview} rows={14} className="font-mono text-xs" /></CardContent>
        </Card>
      )}
    </div>
  )
}

function ImportCard({ title, description, endpoint, accept }: { title: string; description: string; endpoint: string; accept: string }) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const upload = useMutation({
    mutationFn: (file: File) => uploadFile<ImportResult>(endpoint, file),
    onSuccess: (res) => {
      setResult(res)
      toast.success(`Importação concluída: ${res.created} criados, ${res.updated} atualizados.`)
      for (const key of ["products", "warehouses", "categories", "suppliers", "dashboard"]) queryClient.invalidateQueries({ queryKey: [key] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) upload.mutate(file)
            e.target.value = ""
          }}
        />
        <Button variant="outline" className="w-fit" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? <Spinner /> : <Upload />} Escolher arquivo
        </Button>
        {result && (
          <div className="rounded-md bg-muted p-3 text-sm">
            <p>
              <strong>{result.created}</strong> criados · <strong>{result.updated}</strong> atualizados ·{" "}
              <strong>{result.skipped}</strong> ignorados · <strong>{result.warehouses_created}</strong> depósitos novos ·{" "}
              <strong>{result.stock_entries}</strong> entradas de estoque
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-2 max-h-40 overflow-y-auto text-xs text-destructive">
                {result.errors.map((e, i) => <li key={i}>Linha {String(e.line)}: {String(e.message)}</li>)}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ImportTab() {
  const template = async (format: "xlsx" | "csv") => {
    try {
      downloadBlob(await fetchFile("/api/v1/import/template", { query: { format } }), `modelo-produtos.${format}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  return (
    <div className="grid max-w-3xl gap-6">
      <ImportCard
        title="Planilha de produtos (CSV ou Excel)"
        description="Cria ou atualiza produtos pelo SKU. Categorias, fornecedores e depósitos inexistentes são criados. Quantidade + depósito geram a entrada inicial."
        endpoint="/api/v1/import/products"
        accept=".csv,.xlsx"
      />
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <FileUp className="size-4 text-muted-foreground" /> Baixe o modelo com as colunas aceitas:
          <Button variant="outline" size="sm" onClick={() => template("xlsx")}><Download /> Excel</Button>
          <Button variant="outline" size="sm" onClick={() => template("csv")}><Download /> CSV</Button>
        </CardContent>
      </Card>
      <ImportCard
        title="Migrar da versão 1.0 (C/GTK)"
        description="Envie o estoque.csv antigo (formato nome;serial;setor). Cada setor vira um depósito e cada linha, um produto com quantidade 1."
        endpoint="/api/v1/import/legacy-csv"
        accept=".csv,.txt"
      />
    </div>
  )
}

export default function SettingsPage() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = params.get("aba") ?? (can("admin") ? "geral" : "perfil")
  return (
    <>
      <PageHeader title="Configurações" description="Preferências do sistema, alertas, importação de dados e perfil." />
      <Tabs value={tab} onValueChange={(v) => setParams({ aba: v }, { replace: true })}>
        <TabsList className="mb-6">
          {can("admin") && <TabsTrigger value="geral">Geral</TabsTrigger>}
          {can("admin") && <TabsTrigger value="alertas">Alertas</TabsTrigger>}
          {can("manager") && <TabsTrigger value="importacao">Importação</TabsTrigger>}
          <TabsTrigger value="perfil">Perfil</TabsTrigger>
        </TabsList>
        {can("admin") && <TabsContent value="geral"><GeneralTab /></TabsContent>}
        {can("admin") && <TabsContent value="alertas"><AlertsTab /></TabsContent>}
        {can("manager") && <TabsContent value="importacao"><ImportTab /></TabsContent>}
        <TabsContent value="perfil"><ProfileTab /></TabsContent>
      </Tabs>
    </>
  )
}
