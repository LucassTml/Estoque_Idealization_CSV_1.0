import { defineConfig, devices } from "@playwright/test"

const PORT = 8001
const baseURL = `http://127.0.0.1:${PORT}`

/**
 * Testes de ponta a ponta contra a aplicação real (FastAPI servindo o build do React)
 * com um banco de demonstração recriado a cada execução.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  use: {
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /(screenshots|mobile).spec/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec/ },
    { name: "screenshots", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testMatch: /screenshots\.spec/ },
  ],
  webServer: {
    command: "uv run --directory ../backend python -m scripts.e2e_server 8001",
    url: `${baseURL}/api/v1/health`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
  },
})
