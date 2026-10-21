import { test } from "@playwright/test"
import { loginAs } from "./helpers"

/** Gera as imagens do README: npm run screenshots */
const OUT = "../docs/screenshots"

const PAGES: [string, string][] = [
  ["dashboard", "/"],
  ["produtos", "/produtos"],
  ["produto-previsao", "/produtos/1"],
  ["movimentacoes", "/movimentacoes"],
  ["reposicao", "/reposicao"],
  ["compras", "/compras"],
  ["relatorios-abc", "/relatorios"],
  ["scanner", "/scanner"],
  ["assistente", "/assistente"],
]

test("capturas de tela para a documentação", async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto("/login")
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/login.png` })
  await loginAs(page)

  for (const [name, url] of PAGES) {
    await page.goto(url)
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1800) // animações dos gráficos
    if (name === "produto-previsao") await page.mouse.wheel(0, 420)
    if (name === "scanner") {
      await page.getByPlaceholder("Código de barras ou SKU").fill("INF-MOU-USB")
      await page.keyboard.press("Enter")
      await page.waitForTimeout(800)
    }
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/${name}.png` })
  }

  await page.evaluate(() => localStorage.setItem("estoque-theme", "dark"))
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `${OUT}/dashboard-escuro.png` })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => localStorage.setItem("estoque-theme", "light"))
  await page.goto("/produtos/1")
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/mobile.png` })
})
