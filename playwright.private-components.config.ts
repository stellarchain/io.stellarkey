import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// Playwright 1.62.1 locator failures can still include an ARIA snapshot.
// The base policy blocks usable wallets and reports only structural diagnostics.
// This runner is restricted to isolated, non-usable synthetic fixture data;
// normal output cleanup cannot protect against an uncatchable process kill.

export default defineConfig({
  ...base,
  metadata: { ...base.metadata, requiredSyntheticComponents: true },
  testMatch: ['private-components.spec.ts', 'private-direct.spec.ts', 'ux-primitives.spec.ts', 'qr-freshness.spec.ts', 'modal-ownership.spec.ts', 'merchant-feedback.spec.ts', 'private-recovery.spec.ts'],
  globalTeardown: './e2e/fixtures/private-components-teardown.mjs',
  use: { ...base.use, screenshot: 'off', trace: 'off', video: 'off' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 16'], serviceWorkers: 'block' } },
  ],
});
