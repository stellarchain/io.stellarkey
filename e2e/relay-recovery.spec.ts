import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.skip(!process.env.PRIVATE_COMPONENT_FIXTURE_SHA256, 'Use the isolated synthetic component runner.');

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === origin.replace(/^http/, 'ws')) socket.connectToServer();
    else socket.close();
  });
  await page.goto('/private-component-fixture');
  await page.getByRole('button', { name: 'Test relay recovery', exact: true }).click();
});

async function balances(page: Page, values: { bob: string; reserved: string; alice: string; charlie: string; pending: string }) {
  for (const [name, value] of Object.entries(values)) await expect(page.getByTestId(`relay-recovery-${name}`)).toHaveText(value);
}
const held = { bob: '0', reserved: '100', alice: '0', charlie: '0', pending: '1' };
const initial = { bob: '100', reserved: '0', alice: '0', charlie: '0', pending: '0' };
const paid = { bob: '87', reserved: '0', alice: '3', charlie: '10', pending: '0' };

async function start(page: Page, mode = 'approve') {
  await page.getByLabel('Synthetic preparation response').selectOption(mode);
  await page.getByRole('button', { name: 'Create synthetic deposits', exact: true }).click();
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('seeded');
  await page.getByRole('button', { name: 'Review Bob payment', exact: true }).click();
}
async function share(page: Page) {
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('consent');
  await page.getByRole('button', { name: 'Authorize Proof Sharing', exact: true }).click();
}
async function reloadAndInspect(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: 'Test relay recovery', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect persisted synthetic balances', exact: true }).click();
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('restored');
}

for (const [name, deposits, amount, change] of [
  ['with change', '100', '10', '87'], ['exact spend', '13', '10', '0'], ['two inputs', '20,20', '30', '7'],
  ['fractional change', '20.5', '10.125', '7.375'],
]) test(`three-wallet relay ${name}: canonical payment conserves value and survives reload`, async ({ page }) => {
  await page.getByLabel('Synthetic Bob deposits').fill(deposits);
  await page.getByLabel('Synthetic Charlie payment').fill(amount);
  await start(page);
  await share(page);
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('reviewed');
  await page.getByRole('button', { name: 'Submit through Alice', exact: true }).click();
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('broadcast');
  await expect(page.getByTestId('relay-recovery-pending')).toHaveText('1');
  await expect(page.getByTestId('relay-recovery-alice')).toHaveText('0');
  await expect(page.getByTestId('relay-recovery-charlie')).toHaveText('0');
  await page.getByRole('button', { name: 'Deliver canonical synthetic payment', exact: true }).click();
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('confirmed');
  const result = { ...paid, bob: change, charlie: amount };
  await balances(page, result);
  await page.getByRole('button', { name: 'Verify fresh three-wallet scan', exact: true }).click();
  await expect(page.getByTestId('relay-recovery-fresh')).toHaveText('verified');
  await reloadAndInspect(page);
  await balances(page, result);
});

for (const mode of ['helper-reject', 'helper-timeout']) test(`three-wallet relay ${mode}: reproduce whole-deposit reservation before submission`, async ({ page }) => {
  await start(page, mode);
  await share(page);
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('exposed');
  await balances(page, held);
  await expect(page.getByTestId('relay-recovery-submissions')).toHaveText('0');
  await page.getByRole('button', { name: 'Expire and reconcile synthetic payment', exact: true }).click();
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('reconciled');
  await expect(page.getByTestId('relay-recovery-sender-lookups')).toHaveText('0');
  await balances(page, held);
  await reloadAndInspect(page);
  await balances(page, held);
});

test('three-wallet relay: cancelling the real proof consent restores the original deposit', async ({ page }) => {
  await start(page);
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('consent');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('cancelled');
  await balances(page, initial);
  await expect(page.getByTestId('relay-recovery-shared')).toHaveText('0');
  await reloadAndInspect(page);
  await balances(page, initial);
});

for (const [mode, outcome] of [['proof-failure', 'failed'], ['quote-expired', 'failed']]) test(`three-wallet relay ${mode}: no proof leaves Bob`, async ({ page }) => {
  await start(page, mode);
  if (mode === 'quote-expired') await share(page);
  await expect(page.getByTestId('relay-recovery-status')).toHaveText(outcome);
  await balances(page, initial);
  await expect(page.getByTestId('relay-recovery-shared')).toHaveText('0');
});

test('three-wallet relay: insufficient funds for the 3 XLM fee leaves deposits untouched', async ({ page }) => {
  await page.getByLabel('Synthetic Bob deposits').fill('12');
  await start(page);
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('failed');
  await balances(page, { ...initial, bob: '12' });
  await expect(page.getByTestId('relay-recovery-shared')).toHaveText('0');
});

for (const [mode, outcome] of [['ERROR', 'ambiguous'], ['timeout', 'ambiguous'], ['signer-reject', 'failed']]) test(`three-wallet relay ${mode}: reservation persists until canonical recovery`, async ({ page }) => {
  await page.getByLabel('Synthetic submission response').selectOption(mode);
  await start(page);
  await share(page);
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('reviewed');
  await page.getByRole('button', { name: 'Submit through Alice', exact: true }).click();
  await expect(page.getByTestId('relay-recovery-status')).toHaveText(outcome);
  await balances(page, held);
  await page.getByRole('button', { name: 'Expire and reconcile synthetic payment', exact: true }).click();
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('reconciled');
  await expect(page.getByTestId('relay-recovery-sender-lookups')).toHaveText('0');
  await balances(page, held);
  await page.getByRole('button', { name: 'Deliver canonical synthetic payment', exact: true }).click();
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('confirmed');
  await balances(page, paid);
});

test('three-wallet relay: proof consent has labelled controls and keyboard cancellation', async ({ page }) => {
  await start(page);
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('consent');
  const audit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(audit.violations.map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length }))).toEqual([]);
  await page.getByRole('button', { name: 'Back', exact: true }).press('Enter');
  await expect(page.getByTestId('relay-recovery-status')).toHaveText('cancelled');
  await balances(page, initial);
});
