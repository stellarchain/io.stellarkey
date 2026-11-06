import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

const webServer = base.webServer;
if (!webServer || Array.isArray(webServer)) throw new Error('Synthetic components require one owned server.');

// Playwright 1.65.0 locator failures can still include an ARIA snapshot.
// The base policy blocks usable wallets and reports only structural diagnostics.
// This runner is restricted to isolated, non-usable synthetic fixture data;
// normal output cleanup cannot protect against an uncatchable process kill.

export default defineConfig({
  ...base,
  // Independent files/contexts share one runner-owned server and fixture.
  // Preserve per-file ordering; never launch concurrent fixture owners here.
  workers: 2,
  metadata: { ...base.metadata, requiredSyntheticComponents: true },
  testMatch: ['wallet-erasure.spec.ts', 'private-components.spec.ts', 'private-direct.spec.ts', 'ux-primitives.spec.ts', 'qr-freshness.spec.ts', 'modal-ownership.spec.ts', 'merchant-feedback.spec.ts', 'private-recovery.spec.ts', 'swap-trustline.spec.ts', 'private-privacy-hygiene.spec.ts'],
  globalTeardown: './e2e/fixtures/private-components-teardown.mjs',
  // Readiness includes compiling the exclusively created synthetic route.
  // A ready public homepage does not establish that this fixture is ready.
  webServer: { ...webServer, url: new URL('/private-component-fixture', webServer.url).href, timeout: 120_000 },
  use: { ...base.use, screenshot: 'off', trace: 'off', video: 'off' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 16'], serviceWorkers: 'block' } },
  ],
});
