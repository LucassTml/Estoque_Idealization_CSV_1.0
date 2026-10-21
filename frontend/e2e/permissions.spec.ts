import { expect, test } from "@playwright/test"
import { loginAs } from "./helpers"

test("perfil leitura só consulta", async ({ page }) => {
  await loginAs(page, "Leitura")
  await expect(page.getByRole("link", { name: "Usuários" })).toHaveCount(0)
  await page.getByRole("link", { name: "Produtos" }).click()
  await expect(page.getByRole("heading", { name: "Produtos" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Novo produto" })).toHaveCount(0)

  await page.goto("/usuarios")
  await expect(page).toHaveURL(/\/$/)
})

test("operador movimenta mas não cadastra produtos", async ({ page }) => {
  await loginAs(page, "Operador")
  await page.getByRole("link", { name: "Movimentações" }).click()
  await expect(page.getByRole("button", { name: "Nova movimentação" })).toBeVisible()
  await page.getByRole("link", { name: "Produtos" }).click()
  await expect(page.getByRole("button", { name: "Novo produto" })).toHaveCount(0)
})

test("sessão continua após recarregar a página (refresh token)", async ({ page }) => {
  await loginAs(page, "Gerente")
  await page.reload()
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Olá, Gustavo")
  await page.getByRole("button", { name: /Gustavo/ }).click()
  await page.getByRole("menuitem", { name: "Sair" }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto("/produtos")
  await expect(page).toHaveURL(/\/login$/)
})
