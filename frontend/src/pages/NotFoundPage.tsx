import { Link } from "react-router"
import { EmptyState } from "@/components/common"
import { Button } from "@/components/ui/button"

export default function NotFoundPage() {
  return (
    <EmptyState
      title="Página não encontrada"
      description="O endereço acessado não existe ou foi movido."
      action={
        <Button asChild>
          <Link to="/">Voltar ao dashboard</Link>
        </Button>
      }
    />
  )
}
