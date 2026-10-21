import type { ReactNode } from "react"

export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted-foreground)",
]

type TooltipEntry = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number }

/** Tooltip do Recharts com o visual do restante da interface. */
export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string | number
  formatter?: (value: number, name: string) => ReactNode
  labelFormatter?: (label: string) => ReactNode
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {label !== undefined && (
        <p className="mb-1 font-medium">{labelFormatter ? labelFormatter(String(label)) : label}</p>
      )}
      <div className="grid gap-1">
        {payload.map((entry) => (
          <div key={String(entry.dataKey ?? entry.name)} className="flex items-center gap-2">
            <span className="size-2.5 rounded-sm" style={{ background: entry.color }} />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="tabular ml-auto pl-3 font-medium">
              {formatter ? formatter(Number(entry.value), String(entry.name)) : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export const axisProps = {
  stroke: "var(--muted-foreground)",
  fontSize: 12,
  tickLine: false,
  axisLine: false,
} as const
