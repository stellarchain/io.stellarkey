import { test, expect } from '@playwright/test';

test.skip(!process.env.PRIVATE_COMPONENT_FIXTURE_SHA256, 'Use the isolated synthetic component runner.');

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === origin.replace('http', 'ws')) socket.connectToServer();
    else socket.close();
  });
  await page.goto('/private-component-fixture');
});

test('receive QR and download never describe a stale payload; leaving clears rendered private state', async ({ page }) => {
  await page.getByRole('button', { name: 'Open QR freshness checks' }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  const privateTab = dialog.getByRole('tab', { name: 'Private', exact: true });
  const publicTab = dialog.getByRole('tab', { name: 'Public', exact: true });
  await expect(dialog.getByTestId('qr-request-count')).toHaveText('0');
  await privateTab.click();
  await expect.poll(async () => Number(await dialog.getByTestId('qr-request-count').textContent())).toBeGreaterThan(0);
  const initial = Number(await dialog.getByTestId('qr-request-count').textContent());
  await dialog.getByRole('button', { name: 'Complete initial synthetic QRs' }).click();
  await expect(dialog.locator('img')).toHaveCount(1);
  await expect(dialog.locator('a[download]')).toHaveCount(1);
  await dialog.getByRole('button', { name: /New Address|Fresh Address|Rotate/i }).click();
  await expect(dialog.getByTestId('qr-request-count')).toHaveText(String(initial + 1));
  await expect(dialog.locator('img')).toHaveCount(0);
  await expect(dialog.locator('a[download]')).toHaveCount(0);
  await dialog.getByRole('button', { name: /New Address|Fresh Address|Rotate/i }).click();
  await expect(dialog.getByTestId('qr-request-count')).toHaveText(String(initial + 2));
  await dialog.getByRole('button', { name: 'Complete next synthetic QR' }).click();
  await expect(dialog.locator('img')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Complete next synthetic QR' }).click();
  await expect(dialog.locator('img')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Reusable', exact: true }).click();
  await expect(dialog.getByTestId('qr-request-count')).toHaveText(String(initial + 3));
  await expect(dialog.locator('img')).toHaveCount(0);
  await publicTab.click();
  await dialog.getByRole('button', { name: 'Complete next synthetic QR' }).click();
  await expect(dialog.locator('img, a[download]')).toHaveCount(0);
  await expect(dialog.getByRole('group', { name: 'Private receive address type' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open QR freshness checks' })).toBeFocused();
});
