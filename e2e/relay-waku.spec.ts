import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.skip(!process.env.PRIVATE_COMPONENT_FIXTURE_SHA256, 'Use the isolated synthetic component runner.');

const PEER = '/dns4/node.example/tcp/8000/wss/p2p/16Uiu2HAkykgaECHswi3YKJ5dMLbq2kPVCo89fcyTd38UcQD6ej5W';
const dialogFor = (page: Page) => page.getByRole('dialog', { name: 'Earn by Relaying', exact: true });
const fixtureAction = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
  .evaluate(node => (node as HTMLButtonElement).click());

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === origin.replace(/^http/, 'ws')) socket.connectToServer();
    else socket.close();
  });
  await page.goto('/private-component-fixture');
  await page.getByRole('button', { name: 'Test Waku connection', exact: true }).click();
  await expect(page.getByTestId('waku-fixture-ready')).toHaveText('true');
});

async function openEarn(page: Page) {
  await page.getByRole('button', { name: /Earn by Relaying/ }).click();
  const dialog = dialogFor(page);
  await dialog.getByText('Relay connections', { exact: true }).click();
  return dialog;
}

async function configure(page: Page, cluster: string) {
  const dialog = await openEarn(page);
  await dialog.getByLabel('Waku service node', { exact: true }).fill(PEER);
  await dialog.getByLabel('Waku cluster', { exact: true }).fill(cluster);
  await dialog.getByRole('button', { name: 'Save connections', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Changes saved' })).toBeVisible();
  await expect(page.getByTestId('waku-creates')).toHaveText('0');
  return dialog;
}

test('cluster mismatch never paints Connected and saving cluster 3 repairs the actual helper in place', async ({ page }) => {
  const dialog = await configure(page, '1');
  await dialog.evaluate(node => node.setAttribute('data-waku-shell', 'same-opening'));
  await dialog.getByRole('button', { name: 'Start Relaying', exact: true }).click();
  await expect(page.getByTestId('waku-sdk-cluster')).toHaveText('1');
  await expect(dialog.getByText('Check connections', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/This relay session uses Waku cluster 1, but your configured service nodes report cluster 3/)).toBeVisible();
  await expect(page.getByTestId('waku-connected-paints')).toHaveText('0');
  await expect(page.getByTestId('waku-subscriptions')).toHaveText('0');
  await dialog.getByLabel('Waku cluster', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'Save connections', exact: true }).click();
  await expect(page.getByTestId('waku-sdk-cluster')).toHaveText('3');
  await expect(page.getByTestId('waku-creates')).toHaveText('2');
  await expect(page.getByTestId('waku-stops')).toHaveText('1');
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Connected to 2 of 2 Waku services', { exact: true })).toBeVisible();
  await expect(dialog).toHaveAttribute('data-waku-shell', 'same-opening');
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name: 'Stop Relaying', exact: true }).click();
  await expect(page.getByTestId('waku-stops')).toHaveText('2');
  await expect(dialog.getByText('Not relaying', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Earn by Relaying/ })).toBeFocused();
});

test('saved cluster survives closing, reopening and a fresh unlock without implicit startup', async ({ page }) => {
  const dialog = await configure(page, '3');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await openEarn(page);
  await expect(dialog.getByLabel('Waku cluster', { exact: true })).toHaveValue('3');
  await dialog.getByRole('button', { name: 'Start Relaying', exact: true }).press('Enter');
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible();
  await expect(page.getByTestId('waku-sdk-cluster')).toHaveText('3');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await fixtureAction(page, 'Fresh Waku unlock');
  await expect(page.getByTestId('waku-requested')).toHaveText('false');
  const reopened = await openEarn(page);
  await expect(reopened.getByText('Paused', { exact: true })).toBeVisible();
  await reopened.getByRole('button', { name: 'Save connections', exact: true }).click();
  await expect(page.getByTestId('waku-creates')).toHaveText('0');
  await reopened.getByRole('button', { name: 'Resume Relaying', exact: true }).click();
  await expect(page.getByTestId('waku-sdk-cluster')).toHaveText('3');
  await expect(reopened.getByText('Connected', { exact: true })).toBeVisible();
});

test('temporary disconnects recover without a new helper and sender-only saves keep its identity', async ({ page }) => {
  const dialog = await configure(page, '3');
  await dialog.getByRole('button', { name: 'Start Relaying', exact: true }).click();
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible();
  await fixtureAction(page, 'Drop synthetic Waku connections');
  await expect(dialog.getByText('Reconnecting', { exact: true })).toBeVisible();
  await fixtureAction(page, 'Recover synthetic Waku connections');
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible();
  await fixtureAction(page, 'Change Waku sender preference only');
  await expect(page.getByTestId('waku-creates')).toHaveText('1');
  await expect(page.getByTestId('waku-stops')).toHaveText('0');
});

test('late results from a replaced wrong-cluster session cannot overwrite the corrected opening', async ({ page }) => {
  const dialog = await configure(page, '1');
  await fixtureAction(page, 'Delay next Waku handshake');
  await dialog.getByRole('button', { name: 'Start Relaying', exact: true }).click();
  await expect(page.getByTestId('waku-sdk-cluster')).toHaveText('1');
  await dialog.getByLabel('Waku cluster', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'Save connections', exact: true }).click();
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible();
  await fixtureAction(page, 'Release old Waku handshakes');
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Check connections', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('waku-sdk-cluster')).toHaveText('3');
  await expect(page.getByTestId('waku-stops')).toHaveText('1');
});

test('another tab rebases the saved cluster without overwriting the open fee draft or starting its runtime', async ({ page, context, baseURL }) => {
  const dialog = await configure(page, '1');
  await dialog.getByRole('button', { name: 'Start Relaying', exact: true }).click();
  await expect(dialog.getByText('Check connections', { exact: true })).toBeVisible();
  await dialog.getByLabel('Your fee per payment', { exact: true }).fill('0.007');
  const other = await context.newPage();
  const origin = new URL(baseURL!).origin;
  await other.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await other.goto('/private-component-fixture');
  await other.getByRole('button', { name: 'Test Waku connection', exact: true }).click();
  await expect(other.getByTestId('waku-fixture-ready')).toHaveText('true');
  const otherDialog = await openEarn(other);
  await otherDialog.getByLabel('Waku cluster', { exact: true }).fill('3');
  await otherDialog.getByRole('button', { name: 'Save connections', exact: true }).click();
  await expect(other.getByTestId('waku-requested')).toHaveText('false');
  await expect(other.getByTestId('waku-creates')).toHaveText('0');
  await expect(dialog.getByLabel('Waku cluster', { exact: true })).toHaveValue('3');
  await expect(dialog.getByLabel('Your fee per payment', { exact: true })).toHaveValue('0.007');
  await expect(page.getByTestId('waku-sdk-cluster')).toHaveText('3');
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible();
  await other.close();
  await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(dialog.getByLabel('Waku cluster', { exact: true })).toHaveValue('3');
  await expect(dialog.getByLabel('Your fee per payment', { exact: true })).toHaveValue('0.007');
});

test('a mismatch discovered by the live status poll stays actionable until the settings change', async ({ page }) => {
  const dialog = await configure(page, '3');
  await dialog.getByRole('button', { name: 'Start Relaying', exact: true }).click();
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible();
  await fixtureAction(page, 'Change synthetic node cluster');
  await expect(dialog.getByText('Check connections', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/This relay session uses Waku cluster 3, but your configured service nodes report cluster 1/)).toBeVisible();
  await fixtureAction(page, 'Recover synthetic Waku connections');
  await expect(dialog.getByText('Check connections', { exact: true })).toBeVisible();
  await dialog.getByLabel('Waku cluster', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Save connections', exact: true }).click();
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible();
});

test('cluster-error controls remain accessible with narrow reflow and ordinary motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 320, height: 740 });
  const dialog = await configure(page, '1');
  await dialog.getByRole('button', { name: 'Start Relaying', exact: true }).click();
  await expect(dialog.getByText('Check connections', { exact: true })).toBeVisible();
  const scan = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(scan.violations.map(({ id, impact }) => ({ id, impact }))).toEqual([]);
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});
