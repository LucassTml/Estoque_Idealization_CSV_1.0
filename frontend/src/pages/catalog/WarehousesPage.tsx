import { ActiveBadge } from "@/components/badges"
import { CrudPage } from "@/components/CrudPage"
import { client, unwrap } from "@/lib/api"
import { keys, type Warehouse } from "@/lib/queries"
import { formatCurrency } from "@/lib/utils"

export default function WarehousesPage() {
  return (
    <CrudPage<Warehouse>
      title="Depósitos"
      description="Locais de armazenagem: almoxarifados, setores, lojas, prateleiras."
      entityName="Depósito"
      queryKey={keys.warehouses}
      list={() => unwrap(client.GET("/api/v1/warehouses"))}
      searchText={(w) => `${w.code} ${w.name}`}
      fields={[
        { name: "code", label: "Código", required: true, placeholder: "ALM", span: 1 },
        { name: "name", label: "Nome", required: true, span: 1 },
        { name: "description", label: "Descrição", type: "textarea" },
        { name: "is_active", label: "Depósito ativo (aceita entradas)", type: "switch" },
      ]}
      create={(body) => unwrap(client.POST("/api/v1/warehouses", { body: body as { code: string; name: string; is_active: boolean } }))}
      update={(id, body) =>
        unwrap(client.PATCH("/api/v1/warehouses/{warehouse_id}", { params: { path: { warehouse_id: id } }, body }))
      }
      remove={(id) => unwrap(client.DELETE("/api/v1/warehouses/{warehouse_id}", { params: { path: { warehouse_id: id } } }))}
      deleteWarning="Depósitos com movimentações não podem ser excluídos — desative-os."
      columns={[
        { header: "Código", cell: (w) => <span className="font-mono">{w.code}</span> },
        { header: "Nome", cell: (w) => <span className="font-medium">{w.name}</span> },
        { header: "SKUs com saldo", className: "hidden text-right sm:table-cell", cell: (w) => <span className="tabular">{w.sku_count}</span> },
        { header: "Valor armazenado", className: "text-right", cell: (w) => <span className="tabular">{formatCurrency(w.stock_value)}</span> },
        { header: "Situação", cell: (w) => <ActiveBadge active={w.is_active} /> },
      ]}
    />
  )
}
