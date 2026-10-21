import { lazy, Suspense, type ReactNode } from "react"
import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router"
import { Spinner } from "@/components/common"
import { AppLayout } from "@/components/layout/AppLayout"
import { useAuth, type Role } from "@/lib/auth"
import LoginPage from "@/pages/LoginPage"

// Cada tela vira um chunk separado: o carregamento inicial fica leve.
const DashboardPage = lazy(() => import("@/pages/DashboardPage"))
const ProductsPage = lazy(() => import("@/pages/products/ProductsPage"))
const ProductDetailPage = lazy(() => import("@/pages/products/ProductDetailPage"))
const MovementsPage = lazy(() => import("@/pages/MovementsPage"))
const PurchaseOrdersPage = lazy(() => import("@/pages/purchasing/PurchaseOrdersPage"))
const PurchaseOrderFormPage = lazy(() => import("@/pages/purchasing/PurchaseOrderFormPage"))
const PurchaseOrderDetailPage = lazy(() => import("@/pages/purchasing/PurchaseOrderDetailPage"))
const ReplenishmentPage = lazy(() => import("@/pages/ReplenishmentPage"))
const ReportsPage = lazy(() => import("@/pages/ReportsPage"))
const LabelsPage = lazy(() => import("@/pages/LabelsPage"))
const ScannerPage = lazy(() => import("@/pages/ScannerPage"))
const AssistantPage = lazy(() => import("@/pages/AssistantPage"))
const SuppliersPage = lazy(() => import("@/pages/catalog/SuppliersPage"))
const CategoriesPage = lazy(() => import("@/pages/catalog/CategoriesPage"))
const WarehousesPage = lazy(() => import("@/pages/catalog/WarehousesPage"))
const UsersPage = lazy(() => import("@/pages/admin/UsersPage"))
const AuditPage = lazy(() => import("@/pages/admin/AuditPage"))
const SettingsPage = lazy(() => import("@/pages/admin/SettingsPage"))
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"))

function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
      <Spinner className="size-6" />
    </div>
  )
}

function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { can } = useAuth()
  return can(role) ? children : <Navigate to="/" replace />
}

const page = (element: ReactNode) => (
  <Suspense
    fallback={
      <div className="flex justify-center py-20 text-muted-foreground">
        <Spinner className="size-6" />
      </div>
    }
  >
    {element}
  </Suspense>
)

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: page(<DashboardPage />) },
          { path: "produtos", element: page(<ProductsPage />) },
          { path: "produtos/:id", element: page(<ProductDetailPage />) },
          { path: "movimentacoes", element: page(<MovementsPage />) },
          { path: "scanner", element: page(<ScannerPage />) },
          { path: "etiquetas", element: page(<LabelsPage />) },
          { path: "compras", element: page(<PurchaseOrdersPage />) },
          {
            path: "compras/novo",
            element: page(
              <RequireRole role="manager">
                <PurchaseOrderFormPage />
              </RequireRole>,
            ),
          },
          {
            path: "compras/:id/editar",
            element: page(
              <RequireRole role="manager">
                <PurchaseOrderFormPage />
              </RequireRole>,
            ),
          },
          { path: "compras/:id", element: page(<PurchaseOrderDetailPage />) },
          { path: "reposicao", element: page(<ReplenishmentPage />) },
          { path: "fornecedores", element: page(<SuppliersPage />) },
          { path: "relatorios", element: page(<ReportsPage />) },
          { path: "categorias", element: page(<CategoriesPage />) },
          { path: "depositos", element: page(<WarehousesPage />) },
          { path: "assistente", element: page(<AssistantPage />) },
          {
            path: "usuarios",
            element: page(
              <RequireRole role="admin">
                <UsersPage />
              </RequireRole>,
            ),
          },
          {
            path: "auditoria",
            element: page(
              <RequireRole role="admin">
                <AuditPage />
              </RequireRole>,
            ),
          },
          { path: "configuracoes", element: page(<SettingsPage />) },
          { path: "*", element: page(<NotFoundPage />) },
        ],
      },
    ],
  },
])
