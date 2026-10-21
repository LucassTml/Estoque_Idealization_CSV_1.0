import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const compactCurrency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
})
const quantity = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 })
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 })
const dateFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" })
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" })

export const formatCurrency = (value: number | null | undefined) => currency.format(value ?? 0)
export const formatCompactCurrency = (value: number | null | undefined) =>
  compactCurrency.format(value ?? 0)
export const formatQty = (value: number | null | undefined, maxDigits = 3) =>
  maxDigits === 3
    ? quantity.format(value ?? 0)
    : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: maxDigits }).format(value ?? 0)
export const formatPercent = (value: number | null | undefined) => percent.format(value ?? 0)

/** Datas "YYYY-MM-DD" são locais; datetimes ISO com fuso são convertidos pelo navegador. */
export function formatDate(value: string | null | undefined) {
  if (!value) return "—"
  const date = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value)
  return dateFmt.format(date)
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—"
  return dateTimeFmt.format(new Date(value))
}

export function relativeTime(value: string) {
  const diff = (Date.now() - new Date(value).getTime()) / 1000
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" })
  if (diff < 60) return "agora"
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), "minute")
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour")
  return rtf.format(-Math.round(diff / 86400), "day")
}

export function todayISO(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function openBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  window.open(url, "_blank", "noopener")
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
