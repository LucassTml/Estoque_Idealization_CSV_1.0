import createClient, { type Middleware } from "openapi-fetch"
import type { components, paths } from "@/api/schema"

export type Schemas = components["schemas"]

/** Erro da API com a mensagem já em português, pronta para exibir ao usuário. */
export class ApiError extends Error {
  status: number
  code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

type ErrorBody = { detail?: unknown; code?: string }

function messageFrom(body: ErrorBody | undefined, status: number): string {
  const detail = body?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail) && detail.length > 0) {
    // Erros de validação do FastAPI: [{loc: [...], msg: "..."}]
    const first = detail[0] as { loc?: (string | number)[]; msg?: string }
    const field = first.loc?.filter((p) => p !== "body").join(".")
    return field ? `${field}: ${first.msg}` : (first.msg ?? "Dados inválidos.")
  }
  if (status === 0) return "Sem conexão com o servidor."
  if (status >= 500) return "Erro interno do servidor. Tente novamente."
  return "Não foi possível concluir a operação."
}

// ----- Token de acesso em memória + renovação automática pelo cookie httpOnly ---------------------

let accessToken: string | null = null
let refreshing: Promise<boolean> | null = null
let onSessionExpired: (() => void) | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler
}

export type Session = Schemas["SessionResponse"]

export async function refreshSession(): Promise<Session | null> {
  const response = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" })
  if (!response.ok) return null
  const session = (await response.json()) as Session
  accessToken = session.access_token
  return session
}

async function tryRefresh(): Promise<boolean> {
  refreshing ??= refreshSession()
    .then((session) => session !== null)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

const authMiddleware: Middleware = {
  onRequest({ request }) {
    if (accessToken) request.headers.set("Authorization", `Bearer ${accessToken}`)
    return request
  },
}

/** fetch com token e uma nova tentativa após renovar a sessão em caso de 401. */
async function authFetch(input: Request): Promise<Response> {
  const retry = input.clone()
  let response = await fetch(input)
  const isAuthRoute = new URL(input.url).pathname.startsWith("/api/v1/auth/")
  if (response.status === 401 && !isAuthRoute) {
    if (await tryRefresh()) {
      retry.headers.set("Authorization", `Bearer ${accessToken}`)
      response = await fetch(retry)
    } else {
      onSessionExpired?.()
    }
  }
  return response
}

export const client = createClient<paths>({
  baseUrl: window.location.origin,
  credentials: "include",
  fetch: authFetch,
})
client.use(authMiddleware)

/** Desembrulha o resultado do openapi-fetch: retorna `data` ou lança ApiError. */
export async function unwrap<T>(
  promise: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response }
  try {
    result = await promise
  } catch {
    throw new ApiError(0, "Sem conexão com o servidor.")
  }
  if (result.error !== undefined || !result.response.ok) {
    const body = result.error as ErrorBody | undefined
    throw new ApiError(result.response.status, messageFrom(body, result.response.status), body?.code)
  }
  return result.data as T
}

/** Download de arquivos binários (PDF, XLSX, CSV) autenticado. */
export async function fetchFile(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {},
): Promise<Blob> {
  const url = new URL(path, window.location.origin)
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value))
  }
  const request = new Request(url, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const response = await authFetch(request)
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ErrorBody | undefined
    throw new ApiError(response.status, messageFrom(body, response.status), body?.code)
  }
  return response.blob()
}

/** Upload multipart autenticado (importações). */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData()
  form.append("file", file)
  const request = new Request(new URL(path, window.location.origin), {
    method: "POST",
    credentials: "include",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    body: form,
  })
  const response = await authFetch(request)
  const body = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new ApiError(response.status, messageFrom(body, response.status), body?.code)
  }
  return body as T
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "Erro inesperado."
}
