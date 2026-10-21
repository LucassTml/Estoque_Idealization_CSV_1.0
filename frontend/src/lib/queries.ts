import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { paths } from "@/api/schema"
import { client, unwrap, type Schemas } from "@/lib/api"

export type Product = Schemas["ProductOut"]
export type ProductDetail = Schemas["ProductDetail"]
export type Movement = Schemas["MovementOut"]
export type MovementType = Movement["type"]
export type PurchaseOrder = Schemas["PurchaseOrderOut"]
export type PurchaseOrderDetail = Schemas["PurchaseOrderDetail"]
export type PurchaseOrderStatus = PurchaseOrder["status"]
export type Warehouse = Schemas["WarehouseOut"]
export type Supplier = Schemas["SupplierOut"]
export type Category = Schemas["CategoryOut"]
export type Replenishment = Schemas["ReplenishmentItem"]

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  entry: "Entrada",
  exit: "Saída",
  transfer_out: "Transf. saída",
  transfer_in: "Transf. entrada",
  adjustment: "Ajuste",
  receipt: "Recebimento",
}

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Rascunho",
  ordered: "Enviado",
  partially_received: "Parcial",
  received: "Recebido",
  cancelled: "Cancelado",
}

export const FORECAST_METHOD_LABELS: Record<string, string> = {
  holt_amortecido: "Holt amortecido",
  croston_sba: "Croston (SBA)",
  media_simples: "Média simples",
  sem_demanda: "Sem consumo",
}

export const keys = {
  meta: ["meta"] as const,
  categories: ["categories"] as const,
  warehouses: ["warehouses"] as const,
  suppliers: ["suppliers"] as const,
  products: (params: object) => ["products", params] as const,
  product: (id: number) => ["product", id] as const,
  dashboard: (days: number) => ["dashboard", days] as const,
  alertsCount: ["alerts", "count"] as const,
  alerts: ["alerts", "list"] as const,
}

export function useMeta() {
  return useQuery({
    queryKey: keys.meta,
    queryFn: () => unwrap(client.GET("/api/v1/meta")),
    staleTime: 5 * 60_000,
  })
}

export function useCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: () => unwrap(client.GET("/api/v1/categories")),
    staleTime: 60_000,
  })
}

export function useWarehouses(activeOnly = false) {
  return useQuery({
    queryKey: keys.warehouses,
    queryFn: () => unwrap(client.GET("/api/v1/warehouses")),
    staleTime: 60_000,
    select: (data) => (activeOnly ? data.filter((w) => w.is_active) : data),
  })
}

export function useSuppliers() {
  return useQuery({
    queryKey: keys.suppliers,
    queryFn: () => unwrap(client.GET("/api/v1/suppliers")),
    staleTime: 60_000,
  })
}

export type ProductQuery = NonNullable<paths["/api/v1/products"]["get"]["parameters"]["query"]>

export function useProducts(params: ProductQuery) {
  return useQuery({
    queryKey: keys.products(params),
    queryFn: () =>
      unwrap(
        client.GET("/api/v1/products", {
          params: { query: params },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}

export function useAlertsCount() {
  return useQuery({
    queryKey: keys.alertsCount,
    queryFn: () => unwrap(client.GET("/api/v1/alerts/count")),
    refetchInterval: 60_000,
  })
}
