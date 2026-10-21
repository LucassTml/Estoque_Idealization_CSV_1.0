import { describe, expect, it } from "vitest"
import { formatCurrency, formatDate, formatPercent, formatQty } from "./utils"

// O Intl usa espaço não separável depois do "R$"
const normalize = (value: string) => value.replace(/\s/g, " ")

describe("formatadores pt-BR", () => {
  it("formata moeda em reais", () => {
    expect(normalize(formatCurrency(1234.5))).toBe("R$ 1.234,50")
    expect(normalize(formatCurrency(null))).toBe("R$ 0,00")
  })

  it("formata quantidades com até 3 casas ou o limite pedido", () => {
    expect(formatQty(1234.5678)).toBe("1.234,568")
    expect(formatQty(10)).toBe("10")
    expect(formatQty(2.6789, 1)).toBe("2,7")
  })

  it("formata percentuais", () => {
    expect(normalize(formatPercent(0.1234))).toBe("12,3%")
  })

  it("trata datas sem horário como datas locais (sem voltar um dia)", () => {
    expect(formatDate("2026-10-21")).toBe("21/10/2026")
    expect(formatDate(null)).toBe("—")
  })
})
