import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === origin.replace('http', 'ws')) socket.connectToServer();
    else socket.close();
  });
  await page.addInitScript(() => {
    const queue: Array<{ resolve: (text: string) => void; reject: () => void }> = [];
    const state = { reads: 0, complete: (ok: boolean) => {
      const next = queue.shift();
      if (ok) next?.resolve(JSON.stringify({ kind: 'stellar-wallet-backup', version: 2, crypto: { salt: 'synthetic', iv: 'synthetic', ciphertext: 'synthetic-not-encrypted' } }));
      else next?.reject();
    } };
    (window as typeof window & { __restoreCheck: typeof state }).__restoreCheck = state;
    File.prototype.text = function () {
      state.reads += 1;
      return new Promise<string>((resolve, reject) => queue.push({ resolve, reject: () => reject(new Error('Synthetic file read rejected')) }));
    };
  });
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Import Existing Wallet' })).toBeVisible();
});

async function finish(page: import('@playwright/test').Page, ok: boolean) {
  await page.evaluate(value => (window as typeof window & { __restoreCheck: { complete: (ok: boolean) => void } }).__restoreCheck.complete(value), ok);
}

test('backup restore is keyboard operable, acknowledges reads, and supports retry after safe inline failure', async ({ page }) => {
  const restore = page.getByRole('button', { name: /Restore From Backup/ });
  await restore.focus();
  const chooser = page.waitForEvent('filechooser');
  await restore.press('Enter');
  await (await chooser).setFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(restore).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('status', { name: 'Reading encrypted backup' })).toBeVisible();
  await finish(page, false);
  await expect(page.getByText('Could not read this backup file. Choose the file again and retry.', { exact: true })).toBeVisible();
  await expect(restore).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(restore).toHaveAttribute('aria-busy', 'true');
  await finish(page, true);
  await expect(page.getByRole('heading', { name: 'Unlock your backup', exact: true })).toBeVisible();
  await expect(page.getByText('Could not read this backup file. Choose the file again and retry.', { exact: true })).toHaveCount(0);
});

test('an abandoned file read cannot redirect a newer import workflow', async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __restoreCheck: { reads: number } }).__restoreCheck.reads)).toBe(1);
  await page.getByRole('button', { name: 'Import Existing Wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Import your wallet', exact: true })).toBeVisible();
  await finish(page, true);
  await expect(page.getByRole('heading', { name: 'Import your wallet', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unlock your backup', exact: true })).toHaveCount(0);
});

test('oversized backup reports a bounded local error without reading contents', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(File.prototype, 'size', { configurable: true, get: () => 64 * 1024 * 1024 + 1 }));
  await page.locator('input[type="file"]').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.getByText('This backup file exceeds the 64 MiB limit. Choose a smaller encrypted backup.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { __restoreCheck: { reads: number } }).__restoreCheck.reads)).toBe(0);
});

test('an obsolete read error cannot clear a newer read or publish its failure', async ({ page }) => {
  const file = page.locator('input[type="file"]');
  const restore = page.getByRole('button', { name: /Restore From Backup/ });
  await file.setInputFiles({ name: 'first-synthetic.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await file.setInputFiles({ name: 'second-synthetic.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __restoreCheck: { reads: number } }).__restoreCheck.reads)).toBe(2);
  await finish(page, false);
  await expect(restore).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByText('Could not read this backup file. Choose the file again and retry.', { exact: true })).toHaveCount(0);
  await finish(page, true);
  await expect(page.getByRole('heading', { name: 'Unlock your backup', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: /Restore From Backup/ })).toBeEnabled();
});
