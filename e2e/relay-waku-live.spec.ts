import { expect, test } from '@playwright/test';

test.skip(!process.env.PRIVATE_COMPONENT_FIXTURE_SHA256, 'Use the isolated synthetic component runner.');
test.skip(process.env.E2E_WAKU_LOCAL_NODES !== '1', 'Explicitly opt in to the local-node connection check.');

// Explicit local-node integration run, separate from required synthetic CI.
// Uses no wallet; the fixture forbids publication and uses a fresh unused topic.
const peers = [
  '/ip4/127.0.0.1/tcp/8010/ws/p2p/16Uiu2HAmHzBkRq62mG95vsjKMuYQBezZCtjPXYWUoyVxMxi71aB3',
  '/ip4/127.0.0.1/tcp/8011/ws/p2p/16Uiu2HAmStT1UsdSCZUU8iQ7NpL3TKDAFp4eo7cYPUkSG1YL7zF9',
];

test('real local SDK rejects cluster 1, recovers with 3 and sustains Filter and Store through keepalive', async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  expect(process.env.E2E_WAKU_LOCAL_NODES).toBe('1');
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (url.origin === origin.replace(/^http/, 'ws') || (url.hostname === '127.0.0.1' && ['8010', '8011'].includes(url.port))) socket.connectToServer();
    else socket.close();
  });
  await page.goto('/private-component-fixture');
  await page.getByRole('button', { name: 'Test Waku connection', exact: true }).click();
  await expect(page.getByTestId('waku-fixture-ready')).toHaveText('true');
  await page.getByRole('button', { name: 'Use real local Waku nodes', exact: true }).click();
  await page.getByRole('button', { name: /Earn by Relaying/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Earn by Relaying', exact: true });
  await dialog.getByText('Relay connections', { exact: true }).click();
  await dialog.getByLabel('Waku service node', { exact: true }).fill(peers[0]);
  await dialog.getByLabel('Waku service node 2 (optional)', { exact: true }).fill(peers[1]);
  await dialog.getByLabel('Waku cluster', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Start Relaying', exact: true }).click();
  await expect(dialog.getByText('Check connections', { exact: true })).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('waku-connected-paints')).toHaveText('0');
  await expect(page.getByTestId('waku-subscriptions')).toHaveText('0');
  await expect(page.getByTestId('waku-store-queries')).toHaveText('0');
  await dialog.getByLabel('Waku cluster', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'Save connections', exact: true }).click();
  await expect(page.getByTestId('waku-sdk-cluster')).toHaveText('3');
  await expect(dialog.getByText('Connected to 2 of 2 Waku services', { exact: true })).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('waku-subscriptions')).toHaveText('1', { timeout: 30_000 });
  const until = Date.now() + 70_000;
  while (Date.now() < until) {
    await expect(dialog.getByText('Connected', { exact: true })).toBeVisible();
    await page.waitForTimeout(2_000);
  }
  await expect.poll(async () => Number(await page.getByTestId('waku-store-queries').textContent())).toBeGreaterThan(5);
  await expect(page.getByTestId('waku-creates')).toHaveText('2');
  await dialog.getByRole('button', { name: 'Stop Relaying', exact: true }).click();
  await expect(page.getByTestId('waku-stops')).toHaveText('2', { timeout: 30_000 });
  await expect(dialog.getByText('Not relaying', { exact: true })).toBeVisible();
});
