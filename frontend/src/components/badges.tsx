import { Badge } from "@/components/ui/badge"
import { ROLE_LABELS, type Role } from "@/lib/auth"
import {
  MOVEMENT_LABELS,
  PO_STATUS_LABELS,
  type MovementType,
  type PurchaseOrderStatus,
} from "@/lib/queries"
import { cn } from "@/lib/utils"

const tones = {
  green: "border-success/30 bg-success/10 text-success",
  red: "border-destructive/30 bg-destructive/10 text-destructive",
  amber: "border-warning/40 bg-warning/15 text-amber-700 dark:text-warning",
  blue: "border-primary/30 bg-primary/10 text-primary",
  violet: "border-chart-5/30 bg-chart-5/10 text-chart-5",
  gray: "border-border bg-muted text-muted-foreground",
}

type Tone = keyof typeof tones

function Pill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", tones[tone], className)}>
      {children}
    </Badge>
  )
}

const MOVEMENT_TONES: Record<MovementType, Tone> = {
  entry: "green",
  receipt: "green",
  exit: "red",
  transfer_out: "violet",
  transfer_in: "violet",
  adjustment: "amber",
}

export function MovementBadge({ type }: { type: MovementType }) {
  return <Pill tone={MOVEMENT_TONES[type]}>{MOVEMENT_LABELS[type]}</Pill>
}

const PO_TONES: Record<PurchaseOrderStatus, Tone> = {
  draft: "gray",
  ordered: "blue",
  partially_received: "amber",
  received: "green",
  cancelled: "red",
}

export function PoStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <Pill tone={PO_TONES[status]}>{PO_STATUS_LABELS[status]}</Pill>
}

export function StockBadge({ stock, min }: { stock: number; min: number }) {
  if (stock <= 0) return <Pill tone="red">Sem estoque</Pill>
  if (min > 0 && stock <= min) return <Pill tone="amber">Abaixo do mínimo</Pill>
  return <Pill tone="green">Normal</Pill>
}

export function RoleBadge({ role }: { role: Role }) {
  const tone: Tone = role === "admin" ? "violet" : role === "manager" ? "blue" : role === "operator" ? "green" : "gray"
  return <Pill tone={tone}>{ROLE_LABELS[role]}</Pill>
}

export function AbcBadge({ value }: { value: "A" | "B" | "C" }) {
  const tone: Tone = value === "A" ? "blue" : value === "B" ? "amber" : "gray"
  return <Pill tone={tone} className="w-7 justify-center">{value}</Pill>
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? <Pill tone="green">Ativo</Pill> : <Pill tone="gray">Inativo</Pill>
}
