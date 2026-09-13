import { defineConfig } from '@playwright/test';
import base from './playwright.config';

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

// This suppresses teardown ARIA capture, not locator-matcher failure snapshots
// in Playwright 1.62.1. Use only isolated synthetic wallets (see docs/testing.md).

// Wallet values must never enter screenshots, recordings or failure traces.
// Retain the existing production browser matrix and runner ownership.
export default defineConfig({
  ...base,
  use: { ...base.use, screenshot: 'off', trace: 'off', video: 'off' },
  projects: base.projects?.map(project => project.name === 'iphone-webkit'
    ? { ...project, testMatch: /(?:accessibility|merchant-webkit|public-release|browser-smoke|public-private-continuity|overlay-contract|restore-feedback|activity-pagination)\.spec\.ts/ }
    : project),
});
