import { Link } from "react-router"
import { CrudPage } from "@/components/CrudPage"
import { client, unwrap } from "@/lib/api"
import { keys, type Category } from "@/lib/queries"

export default function CategoriesPage() {
  return (
    <CrudPage<Category>
      title="Categorias"
      description="Agrupe os produtos para filtrar e analisar o estoque."
      entityName="Categoria"
      queryKey={keys.categories}
      list={() => unwrap(client.GET("/api/v1/categories"))}
      searchText={(c) => c.name}
      fields={[
        { name: "name", label: "Nome", required: true },
        { name: "description", label: "Descrição", type: "textarea" },
      ]}
      create={(body) => unwrap(client.POST("/api/v1/categories", { body: body as { name: string } }))}
      update={(id, body) =>
        unwrap(client.PATCH("/api/v1/categories/{category_id}", { params: { path: { category_id: id } }, body }))
      }
      remove={(id) => unwrap(client.DELETE("/api/v1/categories/{category_id}", { params: { path: { category_id: id } } }))}
      deleteWarning="Os produtos desta categoria ficarão sem categoria."
      columns={[
        { header: "Categoria", cell: (c) => <span className="font-medium">{c.name}</span> },
        { header: "Descrição", className: "hidden md:table-cell text-muted-foreground", cell: (c) => c.description ?? "—" },
        {
          header: "Produtos",
          className: "text-right",
          cell: (c) => (
            <Link to={`/produtos?categoria=${c.id}`} className="tabular hover:underline">{c.product_count}</Link>
          ),
        },
      ]}
    />
  )
}
