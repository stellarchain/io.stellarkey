import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3187);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "iphone-webkit",
      testMatch: /(?:accessibility|merchant-webkit|public-release)\.spec\.ts/,
      use: { ...devices["iPhone 16"], serviceWorkers: "block" },
    },
    {
      name: "ipad-webkit",
      testMatch: /(?:accessibility|public-release)\.spec\.ts/,
      use: { ...devices["iPad (gen 11)"] },
    },
  ],
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
