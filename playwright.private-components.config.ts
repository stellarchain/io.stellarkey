import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: 'private-components.spec.ts',
  globalTeardown: './e2e/fixtures/private-components-teardown.mjs',
  use: { ...base.use, screenshot: 'off', trace: 'off', video: 'off' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 16'], serviceWorkers: 'block' } },
  ],
});
