import { useQueryClient } from "@tanstack/react-query"
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  client,
  refreshSession,
  setAccessToken,
  setSessionExpiredHandler,
  unwrap,
  type Schemas,
  type Session,
} from "@/lib/api"

export type User = Schemas["UserOut"]
export type Role = User["role"]

const ROLE_LEVEL: Record<Role, number> = { viewer: 0, operator: 1, manager: 2, admin: 3 }

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  manager: "Gerente",
  operator: "Operador",
  viewer: "Leitura",
}

type AuthState = {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  setup: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  can: (minimum: Role) => boolean
  updateUser: (user: User) => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const queryClient = useQueryClient()

  const applySession = useCallback((session: Session | null) => {
    setAccessToken(session?.access_token ?? null)
    setUser(session?.user ?? null)
  }, [])

  useEffect(() => {
    // Ao abrir o app, tenta recuperar a sessão pelo refresh token (cookie httpOnly).
    refreshSession()
      .then(applySession)
      .finally(() => setLoading(false))
    setSessionExpiredHandler(() => {
      applySession(null)
      queryClient.clear()
    })
  }, [applySession, queryClient])

  // Renova o token de acesso antes de expirar (expira em 15 min por padrão).
  useEffect(() => {
    if (!user) return
    const timer = setInterval(() => {
      refreshSession().then((session) => session && applySession(session))
    }, 12 * 60_000)
    return () => clearInterval(timer)
  }, [user, applySession])

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await unwrap(client.POST("/api/v1/auth/login", { body: { email, password } }))
      applySession(session)
    },
    [applySession],
  )

  const setup = useCallback(
    async (name: string, email: string, password: string) => {
      const session = await unwrap(
        client.POST("/api/v1/auth/setup", { body: { name, email, password } }),
      )
      applySession(session)
    },
    [applySession],
  )

  const logout = useCallback(async () => {
    await client.POST("/api/v1/auth/logout").catch(() => undefined)
    applySession(null)
    queryClient.clear()
  }, [applySession, queryClient])

  const can = useCallback(
    (minimum: Role) => (user ? ROLE_LEVEL[user.role] >= ROLE_LEVEL[minimum] : false),
    [user],
  )

  const value = useMemo(
    () => ({ user, loading, login, setup, logout, can, updateUser: setUser }),
    [user, loading, login, setup, logout, can],
  )
  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth() {
  const context = use(AuthContext)
  if (!context) throw new Error("useAuth precisa estar dentro de <AuthProvider>")
  return context
}
