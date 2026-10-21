import { expect, test } from "@playwright/test"
import { loginAs } from "./helpers"

test.describe.configure({ mode: "serial" })

test("dashboard mostra os indicadores do estoque", async ({ page }) => {
  await loginAs(page)
  await expect(page.getByText("Valor em estoque")).toBeVisible()
  await expect(page.getByText("Entradas x saídas")).toBeVisible()
  await expect(page.getByText("Itens críticos")).toBeVisible()
})

test("cadastra produto, dá entrada e acompanha o kardex", async ({ page }) => {
  await loginAs(page)
  await page.getByRole("link", { name: "Produtos" }).click()
  await page.getByRole("button", { name: "Novo produto" }).click()

  const form = page.getByRole("dialog")
  await form.getByLabel("SKU / código").fill("e2e-001")
  await form.getByLabel("Nome", { exact: true }).fill("Produto de teste E2E")
  await form.getByLabel("Estoque mínimo").fill("5")
  await form.getByRole("button", { name: "Salvar" }).click()

  await expect(page.getByRole("heading", { name: "Produto de teste E2E" })).toBeVisible()
  await expect(page.getByText("E2E-001", { exact: false }).first()).toBeVisible()

  // Entrada com custo: atualiza saldo e custo médio
  await page.getByRole("link", { name: "Movimentar" }).click()
  const movement = page.getByRole("dialog")
  await expect(movement.getByRole("combobox").first()).toContainText("E2E-001")
  await movement.getByLabel("Quantidade").fill("12")
  await movement.getByLabel("Custo unitário (R$)").fill("3,50")
  await movement.getByRole("button", { name: "Registrar entrada" }).click()
  await expect(page.getByText("Entrada registrada.")).toBeVisible()

  // Saída maior que o saldo é recusada com mensagem clara
  await page.getByRole("button", { name: "Nova movimentação" }).click()
  const exit = page.getByRole("dialog")
  await exit.getByRole("tab", { name: "Saída" }).click()
  await exit.getByRole("combobox").first().click()
  await page.getByPlaceholder("Buscar por nome, SKU ou código...").fill("E2E-001")
  await page.getByRole("option", { name: /Produto de teste E2E/ }).click()
  await exit.getByLabel("Quantidade").fill("50")
  await exit.getByRole("button", { name: "Registrar saída" }).click()
  await expect(exit.getByText(/Estoque insuficiente/)).toBeVisible()
  await exit.getByLabel("Quantidade").fill("4")
  await exit.getByRole("button", { name: "Registrar saída" }).click()
  await expect(page.getByText("Saída registrada.")).toBeVisible()

  await page.goto("/produtos?q=E2E-001")
  await page.getByRole("cell", { name: /Produto de teste E2E/ }).click()
  await expect(page.getByText("8 UN").first()).toBeVisible()
  await expect(page.getByText("R$ 3,50").first()).toBeVisible()
  await page.getByRole("tab", { name: "Ficha de estoque (kardex)" }).click()
  await expect(page.getByRole("cell", { name: "+12" })).toBeVisible()
  await expect(page.getByRole("cell", { name: "-4" })).toBeVisible()
})

test("ciclo de compra: sugestão → rascunho → envio → recebimento", async ({ page }) => {
  await loginAs(page)
  await page.getByRole("link", { name: "Reposição", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Reposição inteligente" })).toBeVisible()
  await page.getByRole("button", { name: "Gerar pedidos" }).click()
  await expect(page.getByText(/criados? como rascunho/)).toBeVisible()

  if (!/\/compras\/\d+$/.test(page.url())) {
    await page.getByRole("row").nth(1).click()
  }
  await expect(page.getByText("Rascunho").first()).toBeVisible()
  await page.getByRole("button", { name: "Enviar ao fornecedor" }).click()
  await expect(page.getByText("Pedido enviado ao fornecedor.")).toBeVisible()

  await page.getByRole("button", { name: "Receber" }).click()
  await page.getByRole("button", { name: "Confirmar recebimento" }).click()
  await expect(page.getByText("Pedido recebido por completo.")).toBeVisible()
  await expect(page.getByText("Recebido").first()).toBeVisible()
  await expect(page.getByText("100%")).toBeVisible()
})

test("exporta relatório em Excel", async ({ page }) => {
  await loginAs(page)
  await page.getByRole("link", { name: "Relatórios", exact: true }).click()
  await page.getByRole("tab", { name: "Exportações" }).click()
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Excel" }).first().click()
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/)
})
