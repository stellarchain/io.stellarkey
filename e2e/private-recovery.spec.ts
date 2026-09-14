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

async function feeProvider(page: Page, mode: 'deposit' | 'recovery') {
  await page.getByRole('button', { name: 'Test real recovery provider', exact: true }).click();
  await page.getByLabel('Synthetic provider scenario', { exact: true }).selectOption(`fee-payer-${mode}`);
  await page.getByRole('button', { name: 'Prepare real recovery provider', exact: true }).click();
  await expect(page.getByTestId('recovery-provider-setup')).toHaveText('ready', { timeout: 30_000 });
  await expect(page.getByTestId('recovery-provider-phase')).toHaveText('current');
  await expect(page.getByTestId('recovery-provider-owner-retained')).toHaveText('true');
  await page.getByRole('button', { name: mode === 'deposit' ? 'Add · private balance' : 'Recover held balance', exact: true }).click();
  return page.getByRole('dialog');
}

async function chooseTreasury(page: Page) {
  const select = page.getByRole('button', { name: 'Network fee account', exact: true });
  await expect(select).toHaveText('Synthetic Owner');
  await expect(page.getByTestId('recovery-provider-account-count')).toHaveText('5');
  await select.scrollIntoViewIfNeeded();
  await select.press('ArrowDown');
  await expect(select).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('listbox')).toHaveCount(1);
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(5);
  await expect(page.getByRole('option', { name: /^Synthetic Watch/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('option', { name: /^Synthetic Hardware/ })).toHaveAttribute('aria-disabled', 'true');
  await expect.poll(() => page.getByRole('listbox').evaluate(node => !!node.closest('[data-modal-backdrop][role="dialog"]'))).toBe(true);
  await page.getByRole('option', { name: /^Synthetic Owner/ }).press('ArrowDown');
  await expect(page.getByRole('option', { name: /^Synthetic Treasury/ })).toBeFocused();
  await expect(select).toHaveText('Synthetic Owner');
  await page.getByRole('option', { name: /^Synthetic Treasury/ }).press('Enter');
  await expect(select).toHaveText('Synthetic Treasury');
  await expect(select).toBeFocused();
  await expect(page.getByTestId('recovery-provider-owner-retained')).toHaveText('true');
  return select;
}

for (const mode of ['deposit', 'recovery'] as const) test(`private fee payer actual provider: ${mode} signs both accounts and tracks the outer envelope`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: mode === 'deposit' ? 'reduce' : 'no-preference' });
  const dialog = await feeProvider(page, mode);
  const shell = await page.locator('[data-modal-shell]').elementHandle();
  const backdrop = await page.locator('[data-modal-backdrop]').elementHandle();
  await chooseTreasury(page);
  if (mode === 'deposit') {
    await dialog.getByLabel('Amount', { exact: true }).fill('1');
    await dialog.getByRole('button', { name: 'Review Add Funds', exact: true }).click();
  } else {
    await dialog.getByRole('button', { name: 'Prepare Balance Recovery', exact: true }).click();
    await expect(dialog.getByText(/both accounts are visible on Stellar/i)).toBeVisible();
    await dialog.getByRole('button', { name: 'Authorize Proof Sharing', exact: true }).click();
  }
  await expect(dialog.locator('dd').filter({ hasText: /^Synthetic Treasury$/ })).toBeVisible();
  await expect(dialog.getByText(/both accounts are visible on Stellar/i)).toBeVisible();
  await expect.poll(() => shell!.evaluate(node => node.isConnected)).toBe(true);
  await expect.poll(() => backdrop!.evaluate(node => node.isConnected)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await expect.poll(() => page.locator('[data-app-surface]').evaluate(node => (node as HTMLElement).inert)).toBe(true);
  const diagnostics = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(diagnostics.violations.map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length }))).toEqual([]);
  await dialog.getByRole('button', { name: mode === 'deposit' ? 'Confirm' : 'Sign Recovery', exact: true }).click();
  const password = page.getByRole('dialog', { name: 'Confirm transaction', exact: true });
  await password.getByLabel('Wallet Password', { exact: true }).fill('synthetic recovery correct horse battery staple');
  await password.getByRole('button', { name: 'Authorize', exact: true }).click();
  await expect(password).toHaveCount(0);
  await expect(page.getByTestId('recovery-provider-fee-binding')).toHaveText('matched');
  await expect(page.getByTestId('recovery-provider-outer-tracked')).toHaveText('true');
  await expect(page.getByTestId('recovery-provider-owner-retained')).toHaveText('true');
  await expect(page.getByTestId('recovery-provider-submissions')).toHaveText('1');
  if (mode === 'recovery') {
    await expect(dialog.getByText('Recovery submitted; waiting for ledger confirmation.', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Deliver real provider recovery record', exact: true }).click();
    await expect(page.getByTestId('recovery-provider-outcome')).toHaveText('recovered');
    await expect(page.getByTestId('recovery-provider-pending')).toHaveText('0');
  } else {
    await expect(dialog.getByText('Verifying on Stellar — your balance updates in a moment')).toBeVisible();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Add · private balance', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Network fee account', exact: true })).toHaveText('Synthetic Owner');
  }
});

test('private fee payer actual provider: depleted fee balance stops before proof disclosure', async ({ page }) => {
  const dialog = await feeProvider(page, 'deposit');
  await chooseTreasury(page);
  await page.getByRole('button', { name: 'Deplete synthetic fee balance', includeHidden: true, exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  await dialog.getByLabel('Amount', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Review Add Funds', exact: true }).click();
  await expect(dialog.getByText('Not enough XLM for network fees', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await expect(page.getByTestId('recovery-provider-shared')).toHaveText('0');
  await expect(page.getByTestId('recovery-provider-signs')).toHaveText('0');
  await expect(page.getByTestId('recovery-provider-submissions')).toHaveText('0');
});

test('private fee payer actual provider: recovery fee error allows a different payer before a fresh review', async ({ page }) => {
  const dialog = await feeProvider(page, 'recovery');
  const select = await chooseTreasury(page);
  await page.getByRole('button', { name: 'Deplete synthetic fee balance', includeHidden: true, exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  await dialog.getByRole('button', { name: 'Prepare Balance Recovery', exact: true }).click();
  await expect(dialog.getByText('Not enough XLM for network fees', { exact: true })).toBeVisible();
  await expect(select).toBeEnabled();
  await select.click();
  await page.getByRole('option', { name: /^Synthetic Reserve/ }).click();
  await expect(select).toHaveText('Synthetic Reserve');
  await expect(page.getByTestId('recovery-provider-signs')).toHaveText('0');
  await expect(page.getByTestId('recovery-provider-submissions')).toHaveText('0');
});

test('private fee payer actual provider: Max preserves the owner reserve and selection survives Back', async ({ page }) => {
  const dialog = await feeProvider(page, 'deposit');
  await expect(page.getByTestId('recovery-provider-ledger-ready')).toHaveText('true');
  const max = dialog.getByRole('button', { name: /^Max: / });
  await max.click();
  await expect(dialog.getByLabel('Amount', { exact: true })).toHaveValue('995.99999');
  const select = await chooseTreasury(page);
  await max.click();
  await expect(dialog.getByLabel('Amount', { exact: true })).toHaveValue('997');
  await select.click();
  await page.getByRole('option', { name: /^Synthetic Reserve/ }).click();
  await expect(select).toHaveText('Synthetic Reserve');
  await expect(page.getByTestId('recovery-provider-owner-retained')).toHaveText('true');
  await select.click();
  await page.getByRole('option', { name: /^Synthetic Treasury/ }).click();
  await dialog.getByLabel('Amount', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Review Add Funds', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(select).toHaveText('Synthetic Treasury');
  await expect(dialog.getByLabel('Amount', { exact: true })).toHaveValue('1');
  await expect(page.getByTestId('recovery-provider-submissions')).toHaveText('0');
  await page.setViewportSize({ width: 320, height: 568 });
  await select.scrollIntoViewIfNeeded();
  await select.click();
  expect(await page.getByRole('listbox').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(select).toBeFocused();
  await expect(dialog).toHaveCount(1);
  await select.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Review Add Funds', exact: true })).toBeFocused();
});

test('private fee payer actual provider: removing the payer during password approval cannot sign or fall back', async ({ page }) => {
  const dialog = await feeProvider(page, 'deposit');
  await chooseTreasury(page);
  await dialog.getByLabel('Amount', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Review Add Funds', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  const password = page.getByRole('dialog', { name: 'Confirm transaction', exact: true });
  await expect(password).toBeVisible();
  await page.getByRole('button', { name: 'Remove synthetic fee payer', includeHidden: true, exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  await expect(page.getByTestId('recovery-provider-account-count')).toHaveText('4');
  await password.getByLabel('Wallet Password', { exact: true }).fill('synthetic recovery correct horse battery staple');
  await password.getByRole('button', { name: 'Authorize', exact: true }).click();
  await expect(password).toHaveCount(0);
  await expect(dialog.getByText('Choose the fee account again', { exact: true })).toBeVisible();
  await expect(dialog.locator('dd').filter({ hasText: /^Unavailable account$/ })).toBeVisible();
  await expect(page.getByTestId('recovery-provider-signs')).toHaveText('0');
  await expect(page.getByTestId('recovery-provider-submissions')).toHaveText('0');
  await expect(page.getByTestId('recovery-provider-owner-retained')).toHaveText('true');
});

for (const presentation of ['reduced-motion', 'animated', '200-percent-reflow'] as const) test(`Receive actual provider recovers from a stopped scan: ${presentation}`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: presentation === 'animated' ? 'no-preference' : 'reduce' });
  // Equivalent CSS viewport to a 1280×900 desktop at 200% zoom. Physical
  // pinch-to-zoom and human screen-reader checks remain separate evidence.
  if (presentation === '200-percent-reflow') await page.setViewportSize({ width: 640, height: 450 });
  await page.getByRole('button', { name: 'Test real recovery provider', exact: true }).click();
  await page.getByLabel('Synthetic provider scenario', { exact: true }).selectOption('receive-stopped');
  await page.getByRole('button', { name: 'Prepare real recovery provider', exact: true }).click();
  await expect(page.getByTestId('recovery-provider-setup')).toHaveText('ready', { timeout: 30_000 });
  await expect(page.getByTestId('recovery-provider-phase')).toHaveText('safe-error');
  const opener = page.getByRole('button', { name: 'Open real provider receive', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Receive Funds', exact: true });
  const shell = await page.locator('[data-modal-shell]').elementHandle();
  const backdrop = await page.locator('[data-modal-backdrop]').elementHandle();
  const retry = dialog.getByRole('button', { name: 'Try Again', exact: true });
  await expect(retry).toBeVisible();
  await expect(dialog.getByText('Your address is loading — one moment', { exact: true })).toHaveCount(0);
  await retry.press('Enter');
  await expect(retry).toBeEnabled();
  await expect(page.getByTestId('recovery-provider-phase')).toHaveText('safe-error');
  await page.getByRole('button', { name: 'Restore synthetic receive archive', includeHidden: true, exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  await retry.click();
  // The first restored scan now starts this opening's fresh receive request.
  // The synthetic worker deliberately holds every issuance until released.
  await expect(page.getByTestId('recovery-provider-rotation')).toHaveText('waiting');
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Complete synthetic address rotation', includeHidden: true, exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await expect(page.getByTestId('recovery-provider-phase')).toHaveText('current');
  await expect(page.getByTestId('recovery-provider-submissions')).toHaveText('0');
  await expect(page.getByTestId('recovery-provider-signs')).toHaveText('0');
  const type = dialog.getByRole('button', { name: 'Private receive address type', exact: true });
  await type.press('ArrowDown');
  await dialog.getByRole('option', { name: 'Shielded', exact: true }).press('End');
  await expect(type).toHaveText('Shielded');
  await dialog.getByRole('option', { name: 'Reusable', exact: true }).press('Enter');
  await expect(type).toHaveText('Reusable');
  await expect(type).toBeFocused();
  await type.press('ArrowDown');
  await dialog.getByRole('option', { name: 'Reusable', exact: true }).press('Home');
  await dialog.getByRole('option', { name: 'Shielded', exact: true }).press('Enter');
  const publicTab = dialog.getByRole('tab', { name: 'Public', exact: true });
  const privateTab = dialog.getByRole('tab', { name: 'Private', exact: true });
  await privateTab.press('Home');
  await expect(publicTab).toBeFocused();
  await expect(privateTab).toHaveAttribute('aria-selected', 'true');
  await publicTab.press('Enter');
  await expect(type).toHaveCount(0);
  for (let repeat = 0; repeat < 3; repeat++) {
    await privateTab.click();
    await expect(type).toBeVisible();
    await publicTab.click();
  }
  await privateTab.click();
  await expect(type).toBeVisible();
  await dialog.getByRole('button', { name: 'New address', exact: true }).click();
  await expect(page.getByTestId('recovery-provider-rotation')).toHaveText('waiting');
  await expect(type).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Asset', exact: true })).toBeDisabled();
  await expect(publicTab).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await dialog.press('Escape');
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Complete synthetic address rotation', includeHidden: true, exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  await expect(dialog.getByRole('button', { name: 'New address', exact: true })).toBeEnabled();
  await expect(type).toBeEnabled();
  await expect(publicTab).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
  await expect.poll(() => dialog.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return bounds.left >= -1 && bounds.right <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1;
  })).toBe(true);
  await expect.poll(() => shell!.evaluate(node => node === document.querySelector('[data-modal-shell]'))).toBe(true);
  await expect.poll(() => backdrop!.evaluate(node => node === document.querySelector('[data-modal-backdrop]'))).toBe(true);
  await expect.poll(() => page.locator('[data-app-surface]').evaluate(node => (node as HTMLElement).inert)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  const audit = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(audit.violations.map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length }))).toEqual([]);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect.poll(() => page.locator('[data-app-surface]').evaluate(node => (node as HTMLElement).inert)).toBe(false);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
});

for (const mode of ['deposit-worker-failure', 'deposit-pending-worker-restart', 'deposit-uncertain-worker-restart']) {
  test(`Add funds actual provider: ${mode}`, async ({ page }) => {
    await page.getByRole('button', { name: 'Test real recovery provider', exact: true }).click();
    await page.getByLabel('Synthetic provider scenario', { exact: true }).selectOption(mode);
    await page.getByRole('button', { name: 'Prepare real recovery provider', exact: true }).click();
    await expect(page.getByTestId('recovery-provider-setup')).toHaveText('ready', { timeout: 30_000 });
    await expect(page.getByTestId('recovery-provider-phase')).toHaveText('current');
    const opener = page.getByRole('button', { name: 'Add · private balance', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog');
    const shell = await page.locator('[data-modal-shell]').elementHandle();
    const backdrop = await page.locator('[data-modal-backdrop]').elementHandle();
    await dialog.getByLabel('Amount', { exact: true }).fill('1');
    await dialog.getByRole('button', { name: 'Review Add Funds', exact: true }).press('Enter');
    if (mode === 'deposit-worker-failure') {
      await expect(dialog.getByText('Something interrupted the preparation', { exact: true })).toBeVisible();
      await expect(page.getByTestId('recovery-provider-worker-crashes')).toHaveText('1');
      await expect(page.getByTestId('recovery-provider-submissions')).toHaveText('0');
      await expect(page.getByTestId('recovery-provider-phase')).toHaveText('current');
      await expect(dialog.getByText(/nothing was sent|wallet context changed/i)).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Back', exact: true }).first().click();
      await dialog.getByRole('button', { name: 'Review Add Funds', exact: true }).click();
    }
    await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    await expect.poll(() => shell!.evaluate(node => node === document.querySelector('[data-modal-shell]'))).toBe(true);
    await expect.poll(() => backdrop!.evaluate(node => node === document.querySelector('[data-modal-backdrop]'))).toBe(true);
    await expect.poll(() => page.locator('[data-app-surface]').evaluate(node => (node as HTMLElement).inert)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    const password = page.getByRole('dialog', { name: 'Confirm transaction', exact: true });
    await password.getByLabel('Wallet Password', { exact: true }).fill('synthetic recovery correct horse battery staple');
    await password.getByRole('button', { name: 'Authorize', exact: true }).click();
    await expect(password).toHaveCount(0);
    await expect(dialog.getByRole('heading', { name: mode.includes('uncertain') ? "We couldn't confirm this payment yet" : 'Deposit Sent', exact: true }).last()).toBeVisible();
    await expect(page.getByTestId('recovery-provider-submissions')).toHaveText('1');
    await expect(page.getByTestId('recovery-provider-pending')).toHaveText('1');
    await expect(page.getByTestId('recovery-provider-worker-crashes')).toHaveText('1');
    await expect(page.getByTestId('recovery-provider-authority')).toHaveText('unchanged');
    await expect(dialog.getByText(/nothing was sent|wallet context changed/i)).toHaveCount(0);
    const audit = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(audit.violations.map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length }))).toEqual([]);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.locator('[data-app-surface]').evaluate(node => (node as HTMLElement).inert)).toBe(false);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
    await expect(opener).toBeFocused();
  });
}

for (const phase of ['review', 'expired-confirm'] as const) test(`Add funds actual provider fee limit: ${phase}`, async ({ page }) => {
  await page.getByRole('button', { name: 'Test real recovery provider', exact: true }).click();
  await page.getByLabel('Synthetic provider scenario', { exact: true }).selectOption('deposit-fee-limit');
  await page.getByRole('button', { name: 'Prepare real recovery provider', exact: true }).click();
  await expect(page.getByTestId('recovery-provider-setup')).toHaveText('ready', { timeout: 30_000 });
  await expect(page.getByTestId('recovery-provider-phase')).toHaveText('current');
  const opener = page.getByRole('button', { name: 'Add · private balance', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  const shell = await page.locator('[data-modal-shell]').elementHandle();
  const backdrop = await page.locator('[data-modal-backdrop]').elementHandle();
  const raiseFee = () => page.getByRole('button', { name: 'Raise synthetic resource fee', includeHidden: true, exact: true })
    .evaluate(node => (node as HTMLButtonElement).click());
  if (phase === 'review') await raiseFee();
  await dialog.getByLabel('Amount', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Review Add Funds', exact: true }).press('Enter');
  if (phase === 'expired-confirm') {
    const confirm = dialog.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeEnabled();
    await raiseFee();
    // Advance wall time only: expire the review without firing inactivity
    // timers or replacing the synthetic wallet/provider session.
    await page.clock.setSystemTime(new Date(Date.now() + 301_000));
    await confirm.press('Enter');
  }
  await expect(dialog.getByText('Network fee exceeds the limit', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/check private activity/i)).toBeVisible();
  await expect(dialog.getByText(/status could not be determined|nothing was sent|nothing left/i)).toHaveCount(0);
  await expect(page.getByTestId('recovery-provider-signs')).toHaveText('0');
  await expect(page.getByTestId('recovery-provider-submissions')).toHaveText('0');
  await expect(page.getByTestId('recovery-provider-pending')).toHaveText('0');
  await expect.poll(() => shell!.evaluate(node => node === document.querySelector('[data-modal-shell]'))).toBe(true);
  await expect.poll(() => backdrop!.evaluate(node => node === document.querySelector('[data-modal-backdrop]'))).toBe(true);
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await expect.poll(() => page.locator('[data-app-surface]').evaluate(node => (node as HTMLElement).inert)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  const audit = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(audit.violations.map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length }))).toEqual([]);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Discard changes?', exact: true });
  await discard.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect.poll(() => page.locator('[data-app-surface]').evaluate(node => (node as HTMLElement).inert)).toBe(false);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
});

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
