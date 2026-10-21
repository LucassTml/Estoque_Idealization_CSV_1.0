import { useQuery } from "@tanstack/react-query"
import { Check, ChevronsUpDown } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useDebounce } from "@/hooks/use-debounce"
import { client, unwrap } from "@/lib/api"
import type { Product } from "@/lib/queries"
import { cn, formatQty } from "@/lib/utils"

export type PickedProduct = Pick<Product, "id" | "sku" | "name" | "unit" | "cost_price" | "total_stock">

/** Combobox com busca no servidor (nome, SKU ou código de barras). */
export function ProductPicker({
  value,
  onChange,
  placeholder = "Selecione um produto",
  className,
  id,
}: {
  value: PickedProduct | null
  onChange: (product: PickedProduct | null) => void
  placeholder?: string
  className?: string
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const debounced = useDebounce(search, 250)
  const { data, isFetching } = useQuery({
    queryKey: ["product-picker", debounced],
    queryFn: () =>
      unwrap(client.GET("/api/v1/products", { params: { query: { q: debounced || undefined, page_size: 20 } } })),
    enabled: open,
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground", className)}
        >
          <span className="truncate">{value ? `${value.sku} — ${value.name}` : placeholder}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar por nome, SKU ou código..." value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{isFetching ? "Buscando..." : "Nenhum produto encontrado."}</CommandEmpty>
            <CommandGroup>
              {data?.items.map((product) => (
                <CommandItem
                  key={product.id}
                  value={String(product.id)}
                  onSelect={() => {
                    onChange(product)
                    setOpen(false)
                  }}
                >
                  <Check className={cn("size-4", value?.id === product.id ? "opacity-100" : "opacity-0")} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {product.sku} · saldo {formatQty(product.total_stock)} {product.unit}
                    </p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
