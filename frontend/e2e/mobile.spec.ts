import { expect, test } from "@playwright/test"
import { loginAs } from "./helpers"

test("no celular: menu lateral e scanner por digitação", async ({ page }) => {
  await loginAs(page, "Operador")
  await page.getByRole("button", { name: "Abrir menu" }).click()
  await page.getByRole("link", { name: "Scanner" }).click()
  await expect(page.getByRole("heading", { name: "Scanner" })).toBeVisible()

  const input = page.getByPlaceholder("Código de barras ou SKU")
  await input.fill("ESC-CAN-AZ")
  await input.press("Enter")
  await expect(page.getByText("Caneta esferográfica azul")).toBeVisible()
  await page.getByRole("button", { name: "Registrar saída" }).click()
  await expect(page.getByText(/Saída de 1 UN registrada/)).toBeVisible()

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(scrollWidth).toBeLessThanOrEqual(page.viewportSize()!.width)
})
