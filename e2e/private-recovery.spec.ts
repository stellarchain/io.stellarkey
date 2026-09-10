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
  await page.getByRole('button', { name: 'Test private recovery', exact: true }).click();
});

async function balances(page: Page, values: { bob: string; reserved: string; alice: string; charlie: string; pending: string }) {
  for (const [name, value] of Object.entries(values)) await expect(page.getByTestId(`private-recovery-${name}`)).toHaveText(value);
}
const held = { bob: '0', reserved: '100', alice: '0', charlie: '0', pending: '1' };
const initial = { bob: '100', reserved: '0', alice: '0', charlie: '0', pending: '0' };
const paid = { bob: '90', reserved: '0', alice: '0', charlie: '10', pending: '0' };

async function realProvider(page: Page) {
  await page.getByRole('button', { name: 'Test real recovery provider', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare real recovery provider', exact: true }).click();
  await expect(page.getByTestId('recovery-provider-setup')).toHaveText('ready', { timeout: 30_000 });
  await expect(page.getByTestId('recovery-provider-phase')).toHaveText('current');
  await expect(page.getByTestId('recovery-provider-balance')).toHaveText('0');
  await page.getByRole('button', { name: 'Recover held balance', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Prepare Balance Recovery', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Authorize Proof Sharing', exact: true })).toBeVisible();
  return dialog;
}

for (const winner of ['recovery', 'original'] as const) test(`held balance recovery: actual wallet provider confirms ${winner} winner`, async ({ page }) => {
  const dialog = await realProvider(page);
  await dialog.getByRole('button', { name: 'Authorize Proof Sharing', exact: true }).click();
  await dialog.getByRole('button', { name: 'Sign Recovery', exact: true }).click();
  const password = page.getByRole('dialog', { name: 'Confirm transaction', exact: true });
  await password.getByLabel('Wallet Password', { exact: true }).fill('synthetic recovery correct horse battery staple');
  await password.getByRole('button', { name: 'Authorize', exact: true }).click();
  await expect(password).toHaveCount(0);
  await expect(dialog.getByText('Recovery submitted; waiting for ledger confirmation.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: `Deliver real provider ${winner} record`, exact: true }).click();
  await expect(page.getByTestId('recovery-provider-outcome')).toHaveText(winner === 'recovery' ? 'recovered' : 'original-confirmed');
  await expect(page.getByTestId('recovery-provider-balance')).toHaveText(winner === 'recovery' ? '1000000000' : '900000000');
  await expect(page.getByTestId('recovery-provider-pending')).toHaveText('0');
});

test('held balance recovery: actual provider session replacement cancels proof consent', async ({ page }) => {
  const dialog = await realProvider(page);
  await page.getByRole('button', { name: 'Replace synthetic recovery session', includeHidden: true, exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  await expect(page.getByTestId('recovery-provider-authority')).toHaveText('session-replaced');
  await expect(dialog.getByRole('button', { name: 'Authorize Proof Sharing', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Sign Recovery', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('recovery-provider-shared')).toHaveText('1');
  await expect(page.getByTestId('recovery-provider-signs')).toHaveText('0');
  await expect(page.getByTestId('recovery-provider-submissions')).toHaveText('0');
  await expect(page.getByTestId('recovery-provider-balance')).toHaveText('0');
});

test('held balance recovery: actual provider rejects network roundtrip during password approval', async ({ page }) => {
  const dialog = await realProvider(page);
  await dialog.getByRole('button', { name: 'Authorize Proof Sharing', exact: true }).click();
  await dialog.getByRole('button', { name: 'Sign Recovery', exact: true }).click();
  const password = page.getByRole('dialog', { name: 'Confirm transaction', exact: true });
  await expect(password).toBeVisible();
  await page.getByRole('button', { name: 'Replace synthetic recovery network', includeHidden: true, exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  await expect(page.getByTestId('recovery-provider-authority')).toHaveText('network-replaced');
  await password.getByLabel('Wallet Password', { exact: true }).fill('synthetic recovery correct horse battery staple');
  await password.getByRole('button', { name: 'Authorize', exact: true }).click();
  await expect(password).toHaveCount(0);
  await expect(page.getByTestId('recovery-provider-signs')).toHaveText('0');
  await expect(page.getByTestId('recovery-provider-submissions')).toHaveText('0');
  await expect(page.getByTestId('recovery-provider-pending')).toHaveText('1');
});

test('held balance recovery: retired provider cannot sign after password approval', async ({ page }) => {
  const dialog = await realProvider(page);
  await dialog.getByRole('button', { name: 'Authorize Proof Sharing', exact: true }).click();
  await dialog.getByRole('button', { name: 'Sign Recovery', exact: true }).click();
  const password = page.getByRole('dialog', { name: 'Confirm transaction', exact: true });
  await expect(password).toBeVisible();
  await page.getByRole('button', { name: 'Retire synthetic recovery provider', includeHidden: true, exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  await expect(page.getByTestId('recovery-provider-authority')).toHaveText('provider-retired');
  await password.getByLabel('Wallet Password', { exact: true }).fill('synthetic recovery correct horse battery staple');
  await password.getByRole('button', { name: 'Authorize', exact: true }).click();
  await expect(password).toHaveCount(0);
  await expect(page.getByTestId('recovery-provider-signs')).toHaveText('0');
});

for (const reducedMotion of ['reduce', 'no-preference'] as const) test(`held balance recovery: ${reducedMotion} shell survives repeated cancel, review and close`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion });
  await start(page, 'rpc-reject'); await share(page);
  await expect(page.getByTestId('private-recovery-status')).toHaveText('exposed');
  const opener = page.getByRole('button', { name: 'Open held balance recovery', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Recovery', exact: true });
  const shell = await page.locator('[data-modal-shell]').elementHandle();
  const backdrop = await page.locator('[data-modal-backdrop]').elementHandle();
  for (let attempt = 0; attempt < 3; attempt++) {
    await dialog.getByRole('button', { name: 'Prepare Balance Recovery', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Authorize Proof Sharing', exact: true })).toBeVisible();
    await expect.poll(() => shell!.evaluate(node => node === document.querySelector('[data-modal-shell]'))).toBe(true);
    await expect.poll(() => backdrop!.evaluate(node => node === document.querySelector('[data-modal-backdrop]'))).toBe(true);
    await expect.poll(() => page.locator('[data-app-surface]').evaluate(node => (node as HTMLElement).inert)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    const back = dialog.getByRole('region', { name: 'Recover held balance', exact: true }).getByRole('button', { name: 'Back', exact: true });
    if (attempt % 2) await back.click(); else await back.press('Enter');
    await expect(dialog.getByRole('button', { name: 'Prepare Balance Recovery', exact: true })).toBeEnabled();
    await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  await dialog.getByRole('button', { name: 'Prepare Balance Recovery', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Authorize Proof Sharing', exact: true })).toBeVisible();
  const audit = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(audit.violations.map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length }))).toEqual([]);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.locator('[data-app-surface]').evaluate(node => (node as HTMLElement).inert)).toBe(false);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(dialog.getByRole('button', { name: 'Prepare Balance Recovery', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Authorize Proof Sharing', exact: true })).toHaveCount(0);
});

test('held balance recovery: settings navigation retains the shell and clears unshared consent', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await start(page, 'rpc-reject'); await share(page);
  await expect(page.getByTestId('private-recovery-status')).toHaveText('exposed');
  await page.getByRole('button', { name: 'Open held balance recovery', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const shell = await dialog.locator('[data-modal-shell]').elementHandle();
  const backdrop = await dialog.elementHandle();
  await dialog.getByRole('button', { name: 'Prepare Balance Recovery', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Authorize Proof Sharing', exact: true })).toBeVisible();
  // The shell's Back returns to settings; the section's Back cancels its review.
  await dialog.getByRole('heading', { name: 'Recovery', exact: true }).locator('../..')
    .getByRole('button', { name: 'Back', exact: true }).press('Enter');
  await expect(dialog.getByRole('heading', { name: 'Private Payments details', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Recovery Restore or rescan safely', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Recovery', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Authorize Proof Sharing', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Prepare Balance Recovery', exact: true })).toBeEnabled();
  expect(await shell!.evaluate(node => node === document.querySelector('[data-modal-shell]'))).toBe(true);
  expect(await backdrop!.evaluate(node => node === document.querySelector('[data-modal-backdrop]'))).toBe(true);
  expect(await page.locator('[data-app-surface]').evaluate(node => (node as HTMLElement).inert)).toBe(true);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
});

for (const winner of ['recovery', 'original'] as const) test(`held balance recovery: ${winner} outcome survives IndexedDB reload`, async ({ page }) => {
  await start(page, 'rpc-reject'); await share(page);
  await expect(page.getByTestId('private-recovery-status')).toHaveText('exposed');
  await page.getByRole('button', { name: 'Open held balance recovery', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Recovery', exact: true });
  await dialog.getByRole('button', { name: 'Prepare Balance Recovery', exact: true }).click();
  await dialog.getByRole('button', { name: 'Authorize Proof Sharing', exact: true }).click();
  await dialog.getByRole('button', { name: 'Sign Recovery', exact: true }).click();
  await expect(dialog.getByText('Recovery submitted; waiting for ledger confirmation.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: winner === 'recovery' ? 'Deliver canonical synthetic recovery' : 'Deliver canonical synthetic payment', exact: true }).click();
  await expect(page.getByTestId('private-recovery-status')).toHaveText('confirmed');
  await reloadAndInspect(page);
  await balances(page, winner === 'recovery' ? initial : paid);
  await page.getByRole('button', { name: 'Open held balance recovery', exact: true }).click();
  await expect(dialog.getByText(winner === 'recovery' ? 'Recovery confirmed. The held value is back in your private balance.'
    : 'The original payment confirmed first. Check private activity for the payment and any change.', { exact: true })).toBeVisible();
});

test('held balance recovery: real modal requires explicit proof consent and ledger confirmation', async ({ page }) => {
  await start(page, 'rpc-reject');
  await share(page);
  await expect(page.getByTestId('private-recovery-status')).toHaveText('exposed');
  await page.getByRole('button', { name: 'Open held balance recovery', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Recovery', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Prepare Balance Recovery', exact: true }).click();
  await expect(dialog.getByText('The original payment can still confirm first.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Authorize Proof Sharing', exact: true }).click();
  await dialog.getByRole('button', { name: 'Sign Recovery', exact: true }).click();
  await expect(dialog.getByText('Recovery submitted; waiting for ledger confirmation.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Recovery confirmed. The held value is back in your private balance.', { exact: true })).toHaveCount(0);
});

test('held balance recovery: a past recovery cannot label a new held payment recovered', async ({ page }) => {
  await start(page, 'rpc-reject'); await share(page);
  await expect(page.getByTestId('private-recovery-status')).toHaveText('exposed');
  await page.getByRole('button', { name: 'Seed unrelated prior recovery', exact: true }).click();
  await expect(page.getByTestId('private-recovery-status')).toHaveText('prior-recovery-seeded');
  await page.getByRole('button', { name: 'Open held balance recovery', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Recovery confirmed. The held value is back in your private balance.', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Prepare Balance Recovery', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Authorize Proof Sharing', exact: true })).toBeVisible();
});

test('held balance recovery: keyboard approval retains focus inside the original shell', async ({ page }) => {
  await start(page, 'rpc-reject'); await share(page);
  await expect(page.getByTestId('private-recovery-status')).toHaveText('exposed');
  await page.getByRole('button', { name: 'Open held balance recovery', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Prepare Balance Recovery', exact: true }).click();
  const approve = dialog.getByRole('button', { name: 'Authorize Proof Sharing', exact: true });
  await approve.focus(); await approve.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Sign Recovery', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => !!document.querySelector('[data-modal-shell]')?.contains(document.activeElement))).toBe(true);
});

async function start(page: Page, mode = 'approve') {
  await page.getByLabel('Synthetic preparation response').selectOption(mode);
  await page.getByRole('button', { name: 'Create synthetic deposits', exact: true }).click();
  await expect(page.getByTestId('private-recovery-status')).toHaveText('seeded');
  await page.getByRole('button', { name: 'Review Bob payment', exact: true }).click();
}
async function share(page: Page) {
  await expect(page.getByTestId('private-recovery-status')).toHaveText('consent');
  await page.getByRole('button', { name: 'Authorize Proof Sharing', exact: true }).click();
}
async function reloadAndInspect(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: 'Test private recovery', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect persisted synthetic balances', exact: true }).click();
  await expect(page.getByTestId('private-recovery-status')).toHaveText('restored');
}

for (const [name, deposits, amount, change] of [
  ['with change', '100', '10', '90'], ['exact spend', '10', '10', '0'], ['two inputs', '20,20', '30', '10'],
  ['fractional change', '20.5', '10.125', '10.375'],
]) test(`three-wallet direct payment ${name}: canonical payment conserves value and survives reload`, async ({ page }) => {
  await page.getByLabel('Synthetic Bob deposits').fill(deposits);
  await page.getByLabel('Synthetic Charlie payment').fill(amount);
  await start(page);
  await share(page);
  await expect(page.getByTestId('private-recovery-status')).toHaveText('reviewed');
  await page.getByRole('button', { name: 'Submit directly', exact: true }).click();
  await expect(page.getByTestId('private-recovery-status')).toHaveText('broadcast');
  await expect(page.getByTestId('private-recovery-pending')).toHaveText('1');
  await expect(page.getByTestId('private-recovery-alice')).toHaveText('0');
  await expect(page.getByTestId('private-recovery-charlie')).toHaveText('0');
  await page.getByRole('button', { name: 'Deliver canonical synthetic payment', exact: true }).click();
  await expect(page.getByTestId('private-recovery-status')).toHaveText('confirmed');
  const result = { ...paid, bob: change, charlie: amount };
  await balances(page, result);
  await page.getByRole('button', { name: 'Verify fresh three-wallet scan', exact: true }).click();
  await expect(page.getByTestId('private-recovery-fresh')).toHaveText('verified');
  await reloadAndInspect(page);
  await balances(page, result);
});

for (const mode of ['rpc-reject', 'rpc-timeout']) test(`three-wallet direct payment ${mode}: reproduce whole-deposit reservation before submission`, async ({ page }) => {
  await start(page, mode);
  await share(page);
  await expect(page.getByTestId('private-recovery-status')).toHaveText('exposed');
  await balances(page, held);
  await expect(page.getByTestId('private-recovery-submissions')).toHaveText('0');
  await page.getByRole('button', { name: 'Expire and reconcile synthetic payment', exact: true }).click();
  await expect(page.getByTestId('private-recovery-status')).toHaveText('reconciled');
  await expect(page.getByTestId('private-recovery-sender-lookups')).toHaveText('0');
  await balances(page, held);
  await reloadAndInspect(page);
  await balances(page, held);
});

test('three-wallet direct payment: cancelling the real proof consent restores the original deposit', async ({ page }) => {
  await start(page);
  await expect(page.getByTestId('private-recovery-status')).toHaveText('consent');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('private-recovery-status')).toHaveText('cancelled');
  await balances(page, initial);
  await expect(page.getByTestId('private-recovery-shared')).toHaveText('0');
  await reloadAndInspect(page);
  await balances(page, initial);
});

for (const [mode, outcome] of [['proof-failure', 'failed'], ['consent-expired', 'failed']]) test(`three-wallet direct payment ${mode}: no proof leaves Bob`, async ({ page }) => {
  await start(page, mode);
  if (mode === 'consent-expired') await share(page);
  await expect(page.getByTestId('private-recovery-status')).toHaveText(outcome);
  await balances(page, initial);
  await expect(page.getByTestId('private-recovery-shared')).toHaveText('0');
});

test('three-wallet direct payment: insufficient private funds leaves deposits untouched', async ({ page }) => {
  await page.getByLabel('Synthetic Bob deposits').fill('9');
  await start(page);
  await expect(page.getByTestId('private-recovery-status')).toHaveText('failed');
  await balances(page, { ...initial, bob: '9' });
  await expect(page.getByTestId('private-recovery-shared')).toHaveText('0');
});

for (const [mode, outcome] of [['ERROR', 'ambiguous'], ['timeout', 'ambiguous'], ['signer-reject', 'failed']]) test(`three-wallet direct payment ${mode}: reservation persists until canonical recovery`, async ({ page }) => {
  await page.getByLabel('Synthetic submission response').selectOption(mode);
  await start(page);
  await share(page);
  await expect(page.getByTestId('private-recovery-status')).toHaveText('reviewed');
  await page.getByRole('button', { name: 'Submit directly', exact: true }).click();
  await expect(page.getByTestId('private-recovery-status')).toHaveText(outcome);
  await balances(page, held);
  await page.getByRole('button', { name: 'Expire and reconcile synthetic payment', exact: true }).click();
  await expect(page.getByTestId('private-recovery-status')).toHaveText('reconciled');
  await expect(page.getByTestId('private-recovery-sender-lookups')).toHaveText('0');
  await balances(page, held);
  await page.getByRole('button', { name: 'Deliver canonical synthetic payment', exact: true }).click();
  await expect(page.getByTestId('private-recovery-status')).toHaveText('confirmed');
  await balances(page, paid);
});

test('three-wallet direct payment: proof consent has labelled controls and keyboard cancellation', async ({ page }) => {
  await start(page);
  await expect(page.getByTestId('private-recovery-status')).toHaveText('consent');
  const audit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(audit.violations.map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length }))).toEqual([]);
  await page.getByRole('button', { name: 'Back', exact: true }).press('Enter');
  await expect(page.getByTestId('private-recovery-status')).toHaveText('cancelled');
  await balances(page, initial);
});
