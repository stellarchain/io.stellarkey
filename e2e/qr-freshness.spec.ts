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

test('stopped receive offers recovery instead of endless loading', async ({ page }) => {
  await page.getByRole('button', { name: 'Open QR freshness checks' }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await dialog.getByRole('button', { name: 'Stop synthetic receive runtime', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Try Again', exact: true })).toBeVisible();
  await expect(dialog.getByText('Your address is loading — one moment', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Try Again', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
});

for (const action of ['Revoke', 'Replace']) test(`receive ${action.toLowerCase()} session hides retained address before runtime updates`, async ({ page }) => {
  await page.getByRole('button', { name: 'Open QR freshness checks' }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: `${action} synthetic receive session`, exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Complete initial synthetic QRs', exact: true }).click();
  await expect(dialog.locator('img, a[download]')).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'Unlock to receive privately', exact: true })).toBeVisible();
});

test('receive follower takeover and reusable-only recovery are explicit', async ({ page }) => {
  await page.getByRole('button', { name: 'Open QR freshness checks' }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await dialog.getByRole('button', { name: 'Move synthetic receive to another tab', exact: true }).click();
  await dialog.getByRole('button', { name: 'Use in This Tab', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove synthetic reusable address', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  const type = dialog.getByRole('button', { name: 'Private receive address type', exact: true });
  await type.press('ArrowDown');
  await dialog.getByRole('option', { name: 'Shielded', exact: true }).press('End');
  await dialog.getByRole('option', { name: 'Reusable', exact: true }).press('Enter');
  await expect(type).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Try Again', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await expect(dialog.getByTestId('receive-retry-count')).toHaveText('1');
});

test('receive QR failure offers local retry and leaves the address usable', async ({ page }) => {
  await page.getByRole('button', { name: 'Open QR freshness checks' }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Fail pending synthetic QRs', exact: true }).click();
  await dialog.getByRole('button', { name: 'Retry QR', exact: true }).click();
  await dialog.getByRole('button', { name: 'Complete initial synthetic QRs', exact: true }).click();
  await expect(dialog.locator('img')).toHaveCount(1);
  await expect(dialog.locator('a[download]')).toHaveCount(1);
  await expect(dialog.getByTestId('receive-retry-count')).toHaveText('0');
});

test('receive delayed retry is dismissible and cannot publish into a reopened panel', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Open QR freshness checks' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delay synthetic receive retry', exact: true }).click();
  const retry = dialog.getByRole('button', { name: 'Try Again', exact: true });
  await retry.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect(dialog.getByTestId('receive-retry-count')).toHaveText('1');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
  await dialog.press('Escape');
  await expect(dialog).toBeHidden();
  await opener.click();
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await dialog.getByRole('button', { name: 'Fail old synthetic receive retry', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Try Again', exact: true })).toBeEnabled();
  await expect(dialog.getByText('Synthetic retired receive retry', { exact: true })).toHaveCount(0);
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
  await dialog.getByRole('button', { name: 'New address', exact: true }).click();
  await expect(dialog.getByTestId('qr-request-count')).toHaveText(String(initial + 1));
  await expect(dialog.locator('img')).toHaveCount(0);
  await expect(dialog.locator('a[download]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'New address', exact: true }).click();
  await expect(dialog.getByTestId('qr-request-count')).toHaveText(String(initial + 2));
  await dialog.getByRole('button', { name: 'Complete next synthetic QR' }).click();
  await expect(dialog.locator('img')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Complete next synthetic QR' }).click();
  await expect(dialog.locator('img')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Private receive address type', exact: true }).click();
  await dialog.getByRole('option', { name: 'Reusable', exact: true }).click();
  await expect(dialog.getByTestId('qr-request-count')).toHaveText(String(initial + 3));
  await expect(dialog.locator('img')).toHaveCount(0);
  await publicTab.click();
  await dialog.getByRole('button', { name: 'Complete next synthetic QR' }).click();
  await expect(dialog.locator('img, a[download]')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Private receive address type' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open QR freshness checks' })).toBeFocused();
});
