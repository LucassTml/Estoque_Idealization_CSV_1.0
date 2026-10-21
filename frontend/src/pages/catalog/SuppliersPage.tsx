import { ActiveBadge } from "@/components/badges"
import { CrudPage, type CrudField } from "@/components/CrudPage"
import { client, unwrap } from "@/lib/api"
import { keys, type Supplier } from "@/lib/queries"

const FIELDS: CrudField[] = [
  { name: "name", label: "Razão social / nome", required: true },
  { name: "document", label: "CNPJ / CPF", span: 1 },
  { name: "contact_name", label: "Contato", span: 1 },
  { name: "email", label: "E-mail", type: "email", span: 1 },
  { name: "phone", label: "Telefone", span: 1 },
  { name: "lead_time_days", label: "Prazo de entrega (dias)", type: "number", defaultValue: 7, hint: "Usado na previsão de reposição", span: 1 },
  { name: "address", label: "Endereço" },
  { name: "notes", label: "Observações", type: "textarea" },
  { name: "is_active", label: "Fornecedor ativo", type: "switch" },
]

export default function SuppliersPage() {
  return (
    <CrudPage<Supplier>
      title="Fornecedores"
      description="Quem fornece cada produto e em quanto tempo entrega."
      entityName="Fornecedor"
      queryKey={keys.suppliers}
      list={() => unwrap(client.GET("/api/v1/suppliers"))}
      searchText={(s) => `${s.name} ${s.document ?? ""} ${s.contact_name ?? ""}`}
      fields={FIELDS}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create={(body) => unwrap(client.POST("/api/v1/suppliers", { body: body as any }))}
      update={(id, body) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        unwrap(client.PATCH("/api/v1/suppliers/{supplier_id}", { params: { path: { supplier_id: id } }, body: body as any }))
      }
      remove={(id) => unwrap(client.DELETE("/api/v1/suppliers/{supplier_id}", { params: { path: { supplier_id: id } } }))}
      deleteWarning="Fornecedores com pedidos de compra não podem ser excluídos — desative-os."
      columns={[
        {
          header: "Fornecedor",
          cell: (s) => (
            <div className="min-w-0">
              <p className="truncate font-medium">{s.name}</p>
              <p className="text-xs text-muted-foreground">{s.document ?? "—"}</p>
            </div>
          ),
        },
        {
          header: "Contato",
          className: "hidden md:table-cell",
          cell: (s) => (
            <div className="text-sm">
              <p>{s.contact_name ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{[s.email, s.phone].filter(Boolean).join(" · ")}</p>
            </div>
          ),
        },
        { header: "Prazo", className: "text-right", cell: (s) => <span className="tabular">{s.lead_time_days} dias</span> },
        { header: "Produtos", className: "hidden text-right sm:table-cell", cell: (s) => <span className="tabular">{s.product_count}</span> },
        { header: "Situação", cell: (s) => <ActiveBadge active={s.is_active} /> },
      ]}
    />
  )
}
