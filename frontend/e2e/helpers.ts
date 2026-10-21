import { expect, type Page } from "@playwright/test"

export type DemoRole = "Administrador" | "Gerente" | "Operador" | "Leitura"

/** Entra pelo atalho de contas de demonstração da tela de login. */
export async function loginAs(page: Page, role: DemoRole = "Administrador") {
  await page.goto("/login")
  await page.getByRole("button", { name: role, exact: true }).click()
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Olá")
}
