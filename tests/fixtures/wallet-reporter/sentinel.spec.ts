import { expect, test } from '@playwright/test';
import { importLiveWallet } from '../../../e2e/private-balance/helpers';

// Deliberately not a key, address, payment or usable wallet fixture.
const sentinel = 'NON_USABLE_WALLET_CAPTURE_SENTINEL';

test('synthetic live import refuses before navigation', async ({ page }) => {
  await expect(importLiveWallet(page, sentinel)).rejects.toThrow(/Live wallet.*failure snapshots/i);
  expect(page.url()).toBe('about:blank');
});

test('synthetic missing locator failure', async ({ page }) => {
  await page.setContent(`<main>${sentinel}</main>`);
  await expect(page.getByRole('button', { name: 'Missing fixed action' })).toBeVisible({ timeout: 100 });
});

test('synthetic action failure', async ({ page }) => {
  await page.setContent(`<button hidden>${sentinel}</button>`);
  await page.getByRole('button', { includeHidden: true }).click({ timeout: 100 });
});

test('synthetic output and attachment failure', async ({ page }, testInfo) => {
  await page.setContent(`<main>${sentinel}</main>`);
  console.log(sentinel);
  console.error(sentinel);
  await testInfo.attach('synthetic-payload', { body: sentinel, contentType: 'text/plain' });
  throw new Error(sentinel);
});
