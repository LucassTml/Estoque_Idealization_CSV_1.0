import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftRight,
  Bell,
  Boxes,
  ClipboardList,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Package,
  ScanBarcode,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Sun,
  Tags,
  TrendingUp,
  Truck,
  UserCog,
  Warehouse,
} from "lucide-react"
import { useState, type ComponentType } from "react"
import { Link, NavLink, Outlet, useNavigate } from "react-router"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { client, unwrap } from "@/lib/api"
import { ROLE_LABELS, useAuth, type Role } from "@/lib/auth"
import { keys, useAlertsCount, useMeta } from "@/lib/queries"
import { useTheme, type Theme } from "@/lib/theme"
import { cn, relativeTime } from "@/lib/utils"

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }>; role?: Role }
type NavGroup = { title: string; items: NavItem[] }

const NAV: NavGroup[] = [
  {
    title: "Visão geral",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard },
      { to: "/assistente", label: "Assistente IA", icon: Sparkles },
    ],
  },
  {
    title: "Estoque",
    items: [
      { to: "/produtos", label: "Produtos", icon: Package },
      { to: "/movimentacoes", label: "Movimentações", icon: ArrowLeftRight },
      { to: "/scanner", label: "Scanner", icon: ScanBarcode },
      { to: "/etiquetas", label: "Etiquetas", icon: Tags },
    ],
  },
  {
    title: "Compras",
    items: [
      { to: "/compras", label: "Pedidos de compra", icon: ShoppingCart },
      { to: "/reposicao", label: "Reposição", icon: TrendingUp },
      { to: "/fornecedores", label: "Fornecedores", icon: Truck },
    ],
  },
  {
    title: "Análises",
    items: [{ to: "/relatorios", label: "Relatórios", icon: FileBarChart }],
  },
  {
    title: "Cadastros",
    items: [
      { to: "/categorias", label: "Categorias", icon: ClipboardList },
      { to: "/depositos", label: "Depósitos", icon: Warehouse },
    ],
  },
  {
    title: "Administração",
    items: [
      { to: "/usuarios", label: "Usuários", icon: UserCog, role: "admin" },
      { to: "/auditoria", label: "Auditoria", icon: ShieldCheck, role: "admin" },
      { to: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
]

function Brand({ company }: { company?: string }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Boxes className="size-5" />
      </div>
      <div className="min-w-0 leading-tight">
        <p className="truncate font-semibold">Estoque Idealization</p>
        <p className="truncate text-xs text-muted-foreground">{company ?? "Gestão de estoque"}</p>
      </div>
    </Link>
  )
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth()
  return (
    <nav className="flex flex-col gap-5 px-3 py-4">
      {NAV.map((group) => {
        const items = group.items.filter((item) => !item.role || can(item.role))
        if (!items.length) return null
        return (
          <div key={group.title}>
            <p className="mb-1.5 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {group.title}
            </p>
            <div className="flex flex-col gap-0.5">
              {items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-sidebar-accent font-medium text-primary"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                    )
                  }
                >
                  <Icon className="size-4 shrink-0" />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        )
      })}
    </nav>
  )
}

function AlertsBell() {
  const { data: count } = useAlertsCount()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { data: alerts } = useQuery({
    queryKey: keys.alerts,
    queryFn: () => unwrap(client.GET("/api/v1/alerts", { params: { query: { limit: 20 } } })),
    enabled: open,
  })
  const acknowledge = useMutation({
    mutationFn: () => unwrap(client.POST("/api/v1/alerts/acknowledge")),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  })
  const unread = count?.unread ?? 0

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next && unread > 0) acknowledge.mutate()
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Alertas de estoque">
          <Bell />
          {unread > 0 && (
            <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="font-medium">Alertas de estoque</p>
          <span className="text-xs text-muted-foreground">{count?.open ?? 0} em aberto</span>
        </div>
        <ScrollArea className="max-h-80">
          {alerts?.length ? (
            <ul className="divide-y">
              {alerts.map((alert) => (
                <li key={alert.id}>
                  <button
                    type="button"
                    className="w-full px-4 py-3 text-left hover:bg-accent/50"
                    onClick={() => {
                      setOpen(false)
                      navigate(`/produtos/${alert.product.id}`)
                    }}
                  >
                    <p className="text-sm">{alert.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {alert.kind === "out_of_stock" ? "Sem estoque" : "Estoque baixo"} ·{" "}
                      {relativeTime(alert.created_at)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum alerta em aberto.</p>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

function ThemeMenu() {
  const { theme, setTheme, resolved } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Tema">
          {resolved === "dark" ? <Moon /> : <Sun />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          <DropdownMenuRadioItem value="light">
            <Sun /> Claro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Escuro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> Sistema
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  if (!user) return null
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {initials}
          </span>
          <span className="hidden max-w-32 truncate text-sm md:inline">{user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="truncate">{user.name}</p>
          <p className="truncate text-xs font-normal text-muted-foreground">
            {user.email} · {ROLE_LABELS[user.role]}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/configuracoes?aba=perfil")}>
          <UserCog /> Meu perfil
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            await logout()
            navigate("/login")
          }}
        >
          <LogOut /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { data: meta } = useMeta()

  return (
    <div className="flex min-h-dvh">
      <aside className="no-print sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-16 items-center border-b px-3">
          <Brand company={meta?.company_name} />
        </div>
        <ScrollArea className="flex-1">
          <Navigation />
        </ScrollArea>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">v{meta?.version ?? "2.0"}</p>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="flex h-16 items-center border-b px-3">
            <Brand company={meta?.company_name} />
          </div>
          <ScrollArea className="h-[calc(100dvh-4rem)]">
            <Navigation onNavigate={() => setMobileOpen(false)} />
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu />
          </Button>
          {meta?.demo_mode && (
            <span
              className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
              title="Os dados são fictícios e podem ser reiniciados."
            >
              Demonstração
            </span>
          )}
          <div className="flex-1" />
          <AlertsBell />
          <ThemeMenu />
          <UserMenu />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
