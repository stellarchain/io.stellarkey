import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
// Playwright 1.62.1 locator failures can still include an ARIA snapshot.
// This runner is restricted to isolated, non-usable synthetic fixture data.

export default defineConfig({
  ...base,
  testMatch: ['private-components.spec.ts', 'ux-primitives.spec.ts', 'qr-freshness.spec.ts', 'relay-earn.spec.ts', 'relay-startup.spec.ts'],
  globalTeardown: './e2e/fixtures/private-components-teardown.mjs',
  use: { ...base.use, screenshot: 'off', trace: 'off', video: 'off' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 16'], serviceWorkers: 'block' } },
  ],
});
