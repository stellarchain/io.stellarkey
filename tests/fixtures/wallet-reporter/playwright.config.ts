import { defineConfig } from '@playwright/test';
import base from '../../../playwright.config';

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'sentinel.spec.ts',
  globalSetup: '../../../scripts/testing/wallet-test-policy.mjs',
  reporter: [['../../../scripts/testing/safe-wallet-reporter.mjs']],
  webServer: undefined,
  retries: 0,
  timeout: 10_000,
  projects: [{ name: 'synthetic-safety-probe', use: { browserName: 'chromium' } }],
});
