import { useMutation, useQuery } from "@tanstack/react-query"
import { Bot, Eraser, KeyRound, Send, Sparkles, User, Wrench } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { PageHeader, Spinner } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { client, errorMessage, unwrap, type Schemas } from "@/lib/api"
import { cn } from "@/lib/utils"

type ChatMessage = { role: "user" | "assistant"; content: string; tools?: Schemas["ToolTrace"][]; error?: boolean }

const TOOL_LABELS: Record<string, string> = {
  search_products: "buscou produtos",
  get_product: "detalhou produto",
  low_stock: "listou estoque baixo",
  dashboard: "leu indicadores",
  replenishment: "calculou reposição",
  movements_summary: "analisou movimentações",
  abc_curve: "gerou curva ABC",
  purchase_orders: "consultou pedidos",
  warehouses: "consultou depósitos",
}

const SUGGESTIONS = [
  "Quais itens vão acabar nos próximos 15 dias?",
  "Quanto preciso gastar para repor o estoque?",
  "Quais foram os 5 produtos mais consumidos no último mês?",
  "Tem algum pedido de compra atrasado?",
  "Monte um resumo do estoque para enviar ao meu gestor.",
  "Quais produtos estão parados e ocupando capital?",
]

const STORAGE_KEY = "assistant-history"

function loadHistory(): ChatMessage[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]") as ChatMessage[]
  } catch {
    return []
  }
}

export default function AssistantPage() {
  const status = useQuery({ queryKey: ["assistant-status"], queryFn: () => unwrap(client.GET("/api/v1/assistant/status")) })
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory)
  const [input, setInput] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)))
    } catch {
      /* armazenamento indisponível */
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const chat = useMutation({
    mutationFn: (history: ChatMessage[]) =>
      unwrap(
        client.POST("/api/v1/assistant/chat", {
          body: {
            messages: history.filter((m) => !m.error).slice(-20).map(({ role, content }) => ({ role, content })),
          },
        }),
      ),
    onSuccess: (response) =>
      setMessages((current) => [...current, { role: "assistant", content: response.reply, tools: response.tools_used }]),
    onError: (error) =>
      setMessages((current) => [...current, { role: "assistant", content: errorMessage(error), error: true }]),
  })

  const send = (text: string) => {
    const content = text.trim()
    if (!content || chat.isPending) return
    const next: ChatMessage[] = [...messages, { role: "user", content }]
    setMessages(next)
    setInput("")
    chat.mutate(next)
  }

  const enabled = status.data?.enabled ?? false

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col lg:h-[calc(100dvh-9rem)]">
      <PageHeader
        title={<span className="flex items-center gap-2"><Sparkles className="size-6 text-primary" /> Assistente de estoque</span>}
        description="Pergunte em português. A IA consulta os dados reais do sistema (somente leitura) antes de responder."
        actions={
          messages.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setMessages([])}>
              <Eraser /> Nova conversa
            </Button>
          )
        }
      />

      {!status.isLoading && !enabled && (
        <Card className="mb-4 border-warning/40 bg-warning/10">
          <CardContent className="flex gap-3 text-sm">
            <KeyRound className="mt-0.5 size-4 shrink-0" />
            <p>
              O assistente está desativado. Defina a variável de ambiente <code className="font-mono">ANTHROPIC_API_KEY</code>{" "}
              no servidor (ou no arquivo <code className="font-mono">.env</code> do executável) e reinicie o sistema.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {messages.length === 0 ? (
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-6 text-center">
              <div className="rounded-2xl bg-primary/10 p-4 text-primary"><Bot className="size-8" /></div>
              <div>
                <CardTitle className="text-lg">Como posso ajudar?</CardTitle>
                <CardDescription className="mt-1">
                  Experimente uma das perguntas abaixo{status.data?.model ? ` · modelo ${status.data.model}` : ""}.
                </CardDescription>
              </div>
              <div className="grid w-full gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!enabled}
                    onClick={() => send(s)}
                    className="rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent/50 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto grid max-w-3xl gap-6">
              {messages.map((m, i) => (
                <div key={i} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full",
                      m.role === "user" ? "bg-secondary" : "bg-primary text-primary-foreground",
                    )}
                  >
                    {m.role === "user" ? <User className="size-4" /> : <Bot className="size-4" />}
                  </div>
                  <div className={cn("min-w-0 max-w-[85%]", m.role === "user" && "text-right")}>
                    {m.tools && m.tools.length > 0 && (
                      <div className="mb-1.5 flex flex-wrap gap-1">
                        {m.tools.map((t, j) => (
                          <Badge key={j} variant="outline" className="gap-1 text-[11px] font-normal text-muted-foreground">
                            <Wrench className="size-3" /> {TOOL_LABELS[t.name] ?? t.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div
                      className={cn(
                        "inline-block rounded-2xl px-4 py-2.5 text-left text-sm",
                        m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                        m.error && "bg-destructive/10 text-destructive",
                      )}
                    >
                      {m.role === "assistant" && !m.error ? (
                        <div className="prose-chat">
                          <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {chat.isPending && (
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground"><Bot className="size-4" /></div>
                  <Spinner /> Consultando o estoque...
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
        <CardHeader className="border-t p-3 sm:p-4">
          <form
            className="mx-auto flex w-full max-w-3xl items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              send(input)
            }}
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  send(input)
                }
              }}
              rows={1}
              placeholder={enabled ? "Pergunte sobre o estoque... (Enter envia, Shift+Enter quebra linha)" : "Assistente desativado"}
              disabled={!enabled}
              className="max-h-40 min-h-10 resize-none"
            />
            <Button type="submit" size="icon" disabled={!enabled || !input.trim() || chat.isPending} aria-label="Enviar">
              <Send />
            </Button>
          </form>
        </CardHeader>
      </Card>
    </div>
  )
}
