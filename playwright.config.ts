import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3187);
const baseURL = `http://127.0.0.1:${port}`;
const useDevelopmentServer = process.env.E2E_NEXT_DEV === "1";

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
      name: "desktop-firefox-private",
      testMatch: /private-balance\/browser-smoke\.spec\.ts/,
      use: { ...devices["Desktop Firefox"], serviceWorkers: "block" },
    },
    {
      name: "desktop-webkit-private",
      testMatch: /private-balance\/browser-smoke\.spec\.ts/,
      use: { ...devices["Desktop Safari"], serviceWorkers: "block" },
    },
    {
      name: "iphone-webkit",
      testMatch: /(?:accessibility|merchant-webkit|public-release|browser-smoke|public-private-continuity|overlay-contract)\.spec\.ts/,
      use: { ...devices["iPhone 16"], serviceWorkers: "block" },
    },
    {
      name: "ipad-webkit",
      testMatch: /(?:accessibility|public-release|browser-smoke)\.spec\.ts/,
      use: { ...devices["iPad (gen 11)"] },
    },
  ],
  webServer: {
    command: useDevelopmentServer
      ? `npm run dev -- --hostname 127.0.0.1 --port ${port}`
      : `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    // A reused process may belong to another worktree and silently test an
    // older static export. Every run must own and stop the release it checks.
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
