import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.skip(!process.env.PRIVATE_COMPONENT_FIXTURE_SHA256, 'Use the isolated synthetic component runner.');

test.beforeEach(async ({ page, baseURL }) => {
  const ownedOrigin = new URL(baseURL!).origin;
  const ownedSocketOrigin = ownedOrigin.replace(/^http/, 'ws');
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === ownedOrigin ? route.continue() : route.abort();
  });
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === ownedSocketOrigin) socket.connectToServer();
    else socket.close();
  });
  await page.goto('/private-component-fixture');
  await page.getByRole('button', { name: 'Open privacy controls' }).click();
  await expect(page.getByRole('dialog', { name: 'Synthetic privacy controls' })).toBeVisible();
});

async function markShell(page: Page) {
  await page.evaluate(async () => {
    const shell = document.querySelector<HTMLElement>('[data-modal-shell]')!;
    const backdrop = document.querySelector<HTMLElement>('[data-modal-backdrop]')!;
    await Promise.all([...shell.getAnimations(), ...backdrop.getAnimations()].map(animation => animation.finished.catch(() => {})));
    shell.dataset.syntheticIdentity = 'retained';
    backdrop.dataset.syntheticIdentity = 'retained';
  });
}

async function stableShell(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('[data-modal-shell]');
    const backdrop = document.querySelector<HTMLElement>('[data-modal-backdrop]');
    const bounds = shell?.getBoundingClientRect();
    return {
      shell: shell?.dataset.syntheticIdentity, backdrop: backdrop?.dataset.syntheticIdentity,
      locked: document.body.style.overflow === 'hidden', focused: !!backdrop?.contains(document.activeElement),
      inert: !!document.querySelector('main')?.closest('[inert]'),
      contained: !!bounds && bounds.left >= -1 && bounds.right <= innerWidth + 1,
    };
  })).toEqual({ shell: 'retained', backdrop: 'retained', locked: true, focused: true, inert: true, contained: true });
}

async function syntheticDelivery(page: Page, name: string) {
  // Network/signing completions can arrive while the background fixture controls are inert.
  await page.getByRole('button', { name, exact: true }).evaluate(element => (element as HTMLButtonElement).click());
}

for (const mode of ['database-open', 'record-read', 'queued-write', 'uncommitted-put']) {
  test(`discovery cancellation fences real IndexedDB ${mode}`, async ({ page }) => {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: `Check discovery ${mode}`, exact: true }).click();
    await expect(page.getByTestId('discovery-storage-result')).toHaveText('passed');
  });
}

for (const mode of ['changed', 'expected-absent', 'matching', 'matching-absent']) {
  test(`discovery removal atomically checks real IndexedDB ${mode} snapshot`, async ({ page }) => {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: `Check discovery removal snapshot ${mode}`, exact: true }).click();
    await expect(page.getByTestId('discovery-storage-result')).toHaveText('passed');
  });
}

async function openDiscovery(page: Page) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Test discovery lifecycle', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare discovery runtime', exact: true }).click();
  await expect(page.getByTestId('discovery-wallet-phase')).toHaveText('unlocked');
  await expect(page.getByTestId('discovery-leader')).toHaveText('true');
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('1');
  await expect(page.getByTestId('discovery-identity')).toHaveText('present');
}

test('discovery removal rolls back both real IndexedDB records on cancellation', async ({ page }) => {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Check discovery removal rollback', exact: true }).click();
  await expect(page.getByTestId('discovery-storage-result')).toHaveText('passed');
});

for (const revoke of ['Lock discovery wallet', 'Replace discovery account', 'Replace discovery network', 'Replace discovery deployment', 'Take discovery lease elsewhere']) {
  test(`live discovery provider clears and cancels on ${revoke}`, async ({ page }) => {
    await openDiscovery(page);
    await page.getByRole('button', { name: revoke, exact: true }).click();
    await expect(page.getByTestId('discovery-aborts')).toHaveText('1');
    await expect(page.getByTestId('discovery-identity')).toHaveText('cleared');
    await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
    await expect(page.getByTestId('discovery-settled')).toHaveText('1');
    await expect(page.getByTestId('discovery-identity')).toHaveText('cleared');
    await expect(page.getByTestId('discovery-error')).toHaveText('none');
    await expect(page.getByTestId('discovery-reads')).toHaveText('1');
  });
}

test('live discovery removal drains old work before clearing real storage', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Remove synthetic discovery data', exact: true }).click();
  await expect(page.getByTestId('discovery-aborts')).toHaveText('1');
  await expect(page.getByTestId('discovery-removal')).toHaveText('waiting');
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await expect(page.getByTestId('discovery-reads')).toHaveText('1');
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-removal')).toHaveText('removed');
  await page.getByRole('button', { name: 'Inspect synthetic discovery storage', exact: true }).click();
  await expect(page.getByTestId('discovery-stored')).toHaveText('absent');
  await expect(page.getByTestId('discovery-identity')).toHaveText('cleared');
});

test('live discovery checks fresh lease authority even without a storage event', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Take discovery lease silently', exact: true }).click();
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await expect(page.getByTestId('discovery-identity')).toHaveText('cleared', { timeout: 500 });
  await expect(page.getByTestId('discovery-syncing')).toHaveText('false');
  await expect(page.getByTestId('discovery-error')).toHaveText('none');
});

test('live discovery completed identity is cleared on lock and a fresh unlock can retry', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await page.getByRole('button', { name: 'Lock discovery wallet', exact: true }).click();
  await expect(page.getByTestId('discovery-identity')).toHaveText('cleared');
  await page.getByRole('button', { name: 'Unlock discovery wallet', exact: true }).click();
  await expect(page.getByTestId('discovery-wallet-phase')).toHaveText('unlocked');
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('2');
  await expect(page.getByTestId('discovery-error')).toHaveText('none');
});

test('live discovery replacement waits for draining work and coalesces duplicate refreshes', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Replace discovery deployment', exact: true }).click();
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('1');
  await page.getByRole('button', { name: 'Fail oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await expect(page.getByTestId('discovery-syncing')).toHaveText('true');
  await expect(page.getByTestId('discovery-error')).toHaveText('none');
  await page.getByRole('button', { name: 'Finish newest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('3');
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await expect(page.getByTestId('discovery-syncing')).toHaveText('false');
});

test('live discovery unmount prevents old failures and finalizers from replacing new success', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Toggle discovery provider', exact: true }).click();
  await expect(page.getByTestId('discovery-aborts')).toHaveText('1');
  await page.getByRole('button', { name: 'Toggle discovery provider', exact: true }).click();
  await expect(page.getByTestId('discovery-leader')).toHaveText('true');
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await page.getByRole('button', { name: 'Finish newest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await page.getByRole('button', { name: 'Fail oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-identity')).toHaveText('present');
  await expect(page.getByTestId('discovery-syncing')).toHaveText('false');
  await expect(page.getByTestId('discovery-error')).toHaveText('none');
});

for (const kind of ['proof', 'build']) {
  test(`live discovery removal preserves a pending ${kind} reservation`, async ({ page }) => {
    await openDiscovery(page);
    await page.getByRole('button', { name: `Seed synthetic ${kind} reservation`, exact: true }).click();
    await expect(page.getByTestId('discovery-seeded')).toHaveText('ready');
    await page.getByRole('button', { name: 'Remove synthetic discovery data', exact: true }).click();
    await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
    await expect(page.getByTestId('discovery-removal')).toHaveText('refused');
    await expect(page.getByTestId('discovery-syncing')).toHaveText('false');
    await page.getByRole('button', { name: 'Inspect synthetic discovery storage', exact: true }).click();
    await expect(page.getByTestId('discovery-stored')).toHaveText('present');
  });
}

test('live discovery removal rechecks ownership after its scan drains', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Seed synthetic empty reservation', exact: true }).click();
  await expect(page.getByTestId('discovery-seeded')).toHaveText('ready');
  await page.getByRole('button', { name: 'Remove synthetic discovery data', exact: true }).click();
  await page.getByRole('button', { name: 'Take discovery lease elsewhere', exact: true }).click();
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-removal')).toHaveText('refused');
  await page.getByRole('button', { name: 'Inspect synthetic discovery storage', exact: true }).click();
  await expect(page.getByTestId('discovery-stored')).toHaveText('present');
});

test('live discovery rejects a stale refresh closure after scope replacement', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await page.getByRole('button', { name: 'Replace discovery network', exact: true }).click();
  await page.getByRole('button', { name: 'Start captured discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('2');
  await expect(page.getByTestId('discovery-reads')).toHaveText('1');
  await expect(page.getByTestId('discovery-identity')).toHaveText('cleared');
});

test('live discovery rejects a stale removal closure after scope replacement', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await page.getByRole('button', { name: 'Replace discovery network', exact: true }).click();
  await page.getByRole('button', { name: 'Remove captured discovery data', exact: true }).click();
  await expect(page.getByTestId('discovery-removal')).toHaveText('refused');
});

async function pauseShieldedSync(page: Page, stage: 'init' | 'prefix') {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await page.getByRole('button', { name: 'Seed synthetic empty reservation', exact: true }).click();
  await expect(page.getByTestId('discovery-seeded')).toHaveText('ready');
  await page.getByRole('button', { name: `Pause synthetic shielded ${stage}`, exact: true }).click();
  await page.getByRole('button', { name: 'Start synthetic shielded sync', exact: true }).click();
  await expect(page.getByTestId('discovery-shielded-stage')).toHaveText(stage);
}

test('live discovery replacement survives an old shielded worker response', async ({ page }) => {
  await pauseShieldedSync(page, 'init');
  await page.getByRole('button', { name: 'Replace discovery deployment', exact: true }).click();
  // The replacement runtime has its own empty durable state, so its legitimate
  // queued sync cannot fail simply because this test replaced the context.
  await page.getByRole('button', { name: 'Seed synthetic empty reservation', exact: true }).click();
  await expect(page.getByTestId('discovery-seeded')).toHaveText('ready');
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await expect(page.getByTestId('discovery-identity')).toHaveText('present');
  await page.getByRole('button', { name: 'Release old shielded response', exact: true }).click();
  await expect(page.getByTestId('discovery-shielded-settled')).toHaveText('1');
  await expect(page.getByTestId('discovery-aborts')).toHaveText('0');
  await expect(page.getByTestId('discovery-identity')).toHaveText('present');
  await expect(page.getByTestId('discovery-syncing')).toHaveText('true');
  await page.getByRole('button', { name: 'Finish newest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('2');
  await expect(page.getByTestId('discovery-error')).toHaveText('none');
});

test('live discovery completed replacement is not restarted by an old shielded final storage response', async ({ page }) => {
  await pauseShieldedSync(page, 'prefix');
  await page.getByRole('button', { name: 'Revoke vault without phase update', exact: true }).click();
  await page.getByRole('button', { name: 'Replace vault session without phase update', exact: true }).click();
  await expect(page.getByTestId('discovery-direct-vault')).toHaveText('unlocked');
  await expect(page.getByTestId('discovery-wallet-phase')).toHaveText('unlocked');
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await expect(page.getByTestId('discovery-identity')).toHaveText('present');
  await page.getByRole('button', { name: 'Finish newest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('2');
  await page.getByRole('button', { name: 'Release old shielded response', exact: true }).click();
  await expect(page.getByTestId('discovery-shielded-settled')).toHaveText('1');
  await expect(page.getByTestId('discovery-syncing')).toHaveText('false');
  await expect(page.getByTestId('discovery-aborts')).toHaveText('0');
  await expect(page.getByTestId('discovery-identity')).toHaveText('present');
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await expect(page.getByTestId('discovery-error')).toHaveText('none');
});

test('live discovery rearms completed identity revocation after a direct vault replacement', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await page.getByRole('button', { name: 'Revoke vault without phase update', exact: true }).click();
  await expect(page.getByTestId('discovery-identity')).toHaveText('cleared');
  await page.getByRole('button', { name: 'Replace vault session without phase update', exact: true }).click();
  await expect(page.getByTestId('discovery-direct-vault')).toHaveText('unlocked');
  await expect(page.getByTestId('discovery-wallet-phase')).toHaveText('unlocked');
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await page.getByRole('button', { name: 'Finish newest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('2');
  await expect(page.getByTestId('discovery-identity')).toHaveText('present');
  await page.getByRole('button', { name: 'Revoke vault without phase update', exact: true }).click();
  await expect(page.getByTestId('discovery-identity')).toHaveText('cleared');
  await expect(page.getByTestId('discovery-syncing')).toHaveText('false');
});

test('default relay recipient is blocked before session creation and can be corrected locally', async ({ page }) => {
  await markShell(page);
  await page.getByRole('tab', { name: 'Relay', exact: true }).click();
  await page.getByRole('button', { name: 'Try default synthetic recipient' }).click();
  await expect(page.getByRole('dialog')).toContainText('A new recipient address is needed');
  await expect(page.getByTestId('relay-creations')).toHaveText('0');
  await expect(page.getByTestId('relay-requests')).toHaveText('0');
  await stableShell(page);
  await page.getByRole('button', { name: 'Use fresh synthetic recipient' }).click();
  await expect(page.getByTestId('relay-requests')).toHaveText('1');
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeEnabled();
});

test('relay preflight preserves the direct form and distinguishes the earlier-payment blocker', async ({ page, browserName }) => {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open synthetic private send' }).click();
  await markShell(page);
  const amount = page.getByLabel('Amount', { exact: true });
  const memo = page.getByLabel('Private memo (optional)');
  await amount.fill('1'); await memo.fill('Synthetic memo');
  const review = page.getByRole('button', { name: 'Review Private Send', exact: true });
  await expect(review).toBeEnabled();
  await page.getByRole('button', { name: 'Privacy relay', exact: true }).click();
  await expect(review).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('Ask the recipient to open Receive');
  await expect(page.getByTestId('recipient-preparations')).toHaveText('0');
  await stableShell(page);
  await page.getByRole('button', { name: 'My account', exact: true }).click();
  await expect(review).toBeEnabled();
  await review.click();
  await expect(page.getByRole('dialog')).toContainText('Blocked by an earlier payment');
  await expect(page.getByRole('dialog')).toContainText('This new action has not started');
  await expect(page.getByRole('button', { name: 'Confirm Send', exact: true })).toBeDisabled();
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]')
    .disableRules(browserName === 'webkit' ? ['color-contrast'] : []).analyze();
  expect(axe.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(amount).toHaveValue('1'); await expect(memo).toHaveValue('Synthetic memo');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByLabel('Private recipient', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open synthetic private send' })).toBeFocused();
});

test('a stale direct recipient validation cannot enable relay review', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open synthetic private send' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('1');
  const review = page.getByRole('button', { name: 'Review Private Send', exact: true });
  await expect(review).toBeEnabled();
  await syntheticDelivery(page, 'Delay recipient validation');
  await page.getByRole('button', { name: 'Privacy relay', exact: true }).click();
  await expect(review).toBeDisabled();
  await syntheticDelivery(page, 'Finish recipient validation');
  await expect(review).toBeDisabled();
  await syntheticDelivery(page, 'Resume recipient validation');
  await expect(page.getByRole('dialog')).toContainText('Ask the recipient to open Receive');
  await expect(review).toBeDisabled();
  await page.getByRole('button', { name: 'My account', exact: true }).click();
  await expect(review).toBeEnabled();
  await syntheticDelivery(page, 'Finish recipient validation');
  await expect(review).toBeEnabled();
});

async function openHelperApproval(page: Page) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open synthetic helper', exact: true }).click();
  await expect(page.getByTestId('helper-phase')).toHaveText('ready');
  await syntheticDelivery(page, 'Deliver helper request');
  await syntheticDelivery(page, 'Deliver helper selection');
  await expect(page.getByTestId('helper-phase')).toHaveText('payout');
  await syntheticDelivery(page, 'Deliver helper preparation');
  await expect(page.getByTestId('helper-phase')).toHaveText('prepared');
  await syntheticDelivery(page, 'Deliver helper sign request');
  await expect(page.getByRole('dialog', { name: 'Relay Private Payment?' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await markShell(page);
}

test('helper accepts exact submit before signature acknowledgement and prevents duplicate submission', async ({ page }) => {
  await openHelperApproval(page);
  await page.getByRole('button', { name: 'Approve & sign', exact: true }).click();
  await expect(page.getByTestId('helper-signs')).toHaveText('1');
  await syntheticDelivery(page, 'Finish synthetic signing');
  await expect(page.getByTestId('helper-phase')).toHaveText('signature-delivered');
  await syntheticDelivery(page, 'Deliver changed helper submit');
  await expect(page.getByTestId('helper-rejects')).toHaveText('1');
  await expect(page.getByTestId('helper-submits')).toHaveText('0');
  await syntheticDelivery(page, 'Deliver duplicate helper submits');
  await expect(page.getByTestId('helper-submits')).toHaveText('1');
  await stableShell(page);
  await syntheticDelivery(page, 'Finish synthetic submission');
  await expect(page.getByRole('dialog')).toBeHidden();
  await syntheticDelivery(page, 'Acknowledge synthetic signature');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('helper duplicate approval clicks sign only once', async ({ page }) => {
  await openHelperApproval(page);
  await page.getByRole('button', { name: 'Approve & sign', exact: true }).evaluate(element => {
    (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click();
  });
  await expect(page.getByTestId('helper-signs')).toHaveText('1');
});

test('helper does not automatically resubmit after an uncertain RPC outcome', async ({ page }) => {
  await openHelperApproval(page);
  await page.getByRole('button', { name: 'Approve & sign', exact: true }).click();
  await syntheticDelivery(page, 'Finish synthetic signing');
  await expect(page.getByTestId('helper-phase')).toHaveText('signature-delivered');
  await syntheticDelivery(page, 'Deliver duplicate helper submits');
  await expect(page.getByTestId('helper-submits')).toHaveText('1');
  await syntheticDelivery(page, 'Fail synthetic submission');
  await expect(page.getByTestId('helper-rejects')).toHaveText('1');
  await syntheticDelivery(page, 'Deliver duplicate helper submits');
  await expect(page.getByTestId('helper-submits')).toHaveText('1');
  await syntheticDelivery(page, 'Acknowledge synthetic signature');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('lost signature acknowledgement preserves exact authorization and never invites another signature', async ({ page, browserName }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHelperApproval(page);
  const approve = page.getByRole('button', { name: 'Approve & sign', exact: true });
  await approve.focus(); await page.keyboard.press('Enter');
  await expect(page.getByTestId('helper-signs')).toHaveText('1');
  await syntheticDelivery(page, 'Finish synthetic signing');
  await expect(page.getByTestId('helper-phase')).toHaveText('signature-delivered');
  await syntheticDelivery(page, 'Lose signature acknowledgement');
  const alert = page.getByRole('dialog').getByRole('alert');
  await expect(alert).toContainText('was signed');
  await expect(alert).toContainText('may still be submitted');
  await expect(alert).not.toContainText('not signed');
  await expect(approve).toBeDisabled();
  await stableShell(page);
  // Scan the settled enabled state, not the prior disabled-opacity frame.
  await expect(page.getByRole('button', { name: 'Dismiss', exact: true })).toHaveCSS('opacity', '1');
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]')
    .disableRules(browserName === 'webkit' ? ['color-contrast'] : []).analyze();
  expect(axe.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await syntheticDelivery(page, 'Deliver duplicate helper submits');
  await expect(page.getByTestId('helper-submits')).toHaveText('1');
  await expect(page.getByTestId('helper-signs')).toHaveText('1');
});

test('helper account replacement cannot be undone by a late signature acknowledgement', async ({ page }) => {
  await openHelperApproval(page);
  await page.getByRole('button', { name: 'Approve & sign', exact: true }).click();
  await syntheticDelivery(page, 'Finish synthetic signing');
  await expect(page.getByTestId('helper-phase')).toHaveText('signature-delivered');
  await syntheticDelivery(page, 'Replace synthetic helper account');
  await expect(page.getByRole('dialog')).toBeHidden();
  await syntheticDelivery(page, 'Acknowledge synthetic signature');
  await syntheticDelivery(page, 'Deliver duplicate helper submits');
  await expect(page.getByTestId('helper-rejects')).toHaveText('2');
  await expect(page.getByTestId('helper-submits')).toHaveText('0');
});

test('live Nostr selection skips comparison without closing the selected session', async ({ page, browserName }) => {
  await markShell(page);
  await page.getByRole('tab', { name: 'Relay', exact: true }).click();
  await page.getByRole('button', { name: 'Find synthetic helpers' }).click();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  const first = page.getByRole('button', { name: /Choose peer 1/ });
  await expect(first).toBeEnabled();
  await first.evaluate(element => { (element as HTMLElement).dataset.syntheticPeer = 'first'; });
  await first.focus();
  await page.getByRole('button', { name: 'Deliver cheaper synthetic offer' }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(first).toHaveAttribute('data-synthetic-peer', 'first');
  await expect(first).toBeFocused();
  await expect(first).not.toContainText('Lowest fee');
  await expect(page.getByRole('button', { name: /Choose peer 2/ })).toContainText('Lowest fee');
  await page.getByRole('button', { name: 'Replace first synthetic quote' }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(first).toHaveAttribute('data-synthetic-peer', 'first');
  await expect(first).toBeFocused();
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]')
    .disableRules(browserName === 'webkit' ? ['color-contrast'] : []).analyze();
  expect(axe.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('relay-selections')).toHaveText('1');
  await expect(page.getByTestId('relay-collection-stopped')).toHaveText('true');
  await expect(page.getByTestId('relay-closed-at-selection')).toHaveText('false');
  await expect(page.getByTestId('relay-session-closed')).toHaveText('false');
  await expect(first).toBeDisabled();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(page.getByTestId('relay-selections')).toHaveText('1');
  await page.getByRole('button', { name: 'Cancel synthetic discovery' }).click();
  await expect(page.getByTestId('relay-session-closed')).toHaveText('true');
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(first).toBeHidden();
  await stableShell(page);
});

test('expired Nostr rows keep their slot while remaining helpers stay selectable', async ({ page }) => {
  await page.getByRole('tab', { name: 'Relay', exact: true }).click();
  await page.getByRole('button', { name: 'Find synthetic helpers' }).click();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await page.getByRole('button', { name: 'Deliver cheaper synthetic offer' }).click();
  const first = page.getByRole('button', { name: /Choose peer 1/ });
  const second = page.getByRole('button', { name: /Choose peer 2/ });
  await first.evaluate(element => { (element as HTMLElement).dataset.syntheticPeer = 'first'; });
  await second.evaluate(element => { (element as HTMLElement).dataset.syntheticPeer = 'second'; });
  await page.getByRole('button', { name: 'Expire first synthetic offer' }).click();
  await expect(first).toHaveAttribute('data-synthetic-peer', 'first');
  await expect(first).toBeDisabled();
  await expect(second).toHaveAttribute('data-synthetic-peer', 'second');
  await expect(second).toBeEnabled();
  await second.click();
  await expect(page.getByTestId('relay-selections')).toHaveText('1');
});

test('Nostr discovery replacement and account changes invalidate old choices', async ({ page }) => {
  await markShell(page);
  await page.getByRole('tab', { name: 'Relay', exact: true }).click();
  await page.getByRole('button', { name: 'Find synthetic helpers' }).click();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Find synthetic helpers' }).click();
  await expect(page.getByTestId('relay-requests')).toHaveText('2');
  await page.getByRole('button', { name: 'Deliver stale synthetic offer' }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeHidden();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Switch synthetic relay account' }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeHidden();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeHidden();
  await expect(page.getByTestId('relay-selections')).toHaveText('0');
  await stableShell(page);
  await page.getByRole('tab', { name: 'Recovery', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open privacy controls' })).toBeFocused();
});

test('cancelling Nostr discovery before session creation closes the late session without publishing', async ({ page }) => {
  await page.getByRole('tab', { name: 'Relay', exact: true }).click();
  await page.getByRole('button', { name: 'Delay synthetic session creation' }).click();
  await page.getByRole('button', { name: 'Find synthetic helpers' }).click();
  await page.getByRole('button', { name: 'Cancel synthetic discovery' }).click();
  await page.getByRole('button', { name: 'Finish synthetic session creation' }).click();
  await expect(page.getByTestId('relay-session-closed')).toHaveText('true');
  await expect(page.getByTestId('relay-requests')).toHaveText('0');
  await expect(page.getByRole('button', { name: /Choose peer/ })).toBeHidden();
});

test('the real chain controller accepts one live choice per step and ignores duplicate taps', async ({ page }) => {
  await page.getByRole('tab', { name: 'Relay', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare synthetic relay chain' }).click();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await page.getByRole('button', { name: /Choose peer 1/ }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeHidden();
  await page.getByRole('button', { name: 'Start approved synthetic chain' }).click();
  await expect(page.getByTestId('relay-requests')).toHaveText('2');
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Double choose first synthetic peer' }).click();
  await expect(page.getByTestId('relay-selections')).toHaveText('1');
  await expect(page.getByTestId('relay-error')).toHaveText('none');
  await page.getByRole('button', { name: 'Finish synthetic payout' }).click();
  await page.getByRole('button', { name: 'Advance synthetic chain step' }).click();
  await expect(page.getByTestId('relay-requests')).toHaveText('3');
  await page.getByRole('button', { name: 'Deliver stale synthetic offer' }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeHidden();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeEnabled();
  await page.getByRole('button', { name: /Choose peer 1/ }).click();
  await expect(page.getByTestId('relay-selections')).toHaveText('2');
  await page.getByRole('button', { name: 'Cancel synthetic discovery' }).click();
  await expect(page.getByTestId('relay-session-closed')).toHaveText('true');
});

test('the bounded native socket exchanges only synthetic local messages and survives its setup deadline', async ({ page }) => {
  let connection: Parameters<Parameters<typeof page.routeWebSocket>[1]>[0] | undefined;
  await page.routeWebSocket('**/synthetic-nostr', socket => {
    connection = socket;
    socket.onMessage(message => { if (message === 'synthetic-ping') socket.send('synthetic-pong'); });
  });
  await page.getByRole('tab', { name: 'Relay', exact: true }).click();
  await page.getByRole('button', { name: 'Open synthetic native socket' }).click();
  await expect(page.getByTestId('relay-native-socket')).toHaveText('exchanged');
  // Prove the CONNECTING deadline does not become an established-session TTL.
  await page.waitForTimeout(100);
  connection!.send('synthetic-after-deadline');
  await expect(page.getByTestId('relay-native-socket')).toHaveText('after deadline');
  await page.getByRole('button', { name: 'Close synthetic native socket' }).click();
  await expect(page.getByTestId('relay-native-socket')).toHaveText('closed');
});

test('recovery requires separate consent, survives stale account completion, and keeps the shell', async ({ page, browserName }) => {
  await markShell(page);
  const toggle = page.getByRole('switch', { name: 'Recover outgoing payment details' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('writes')).toHaveText('0');
  await page.getByRole('button', { name: 'Keep recovery enabled' }).click();
  await expect(page.getByRole('button', { name: 'Omit future outgoing details' })).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]')
    .disableRules(browserName === 'webkit' ? ['color-contrast'] : []).analyze();
  expect(axe.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
  await page.getByRole('button', { name: 'Omit future outgoing details' }).click();
  await expect(toggle).toBeDisabled();
  await page.getByRole('button', { name: 'Switch synthetic account' }).click();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Finish pending preference' }).click();
  await expect(page.getByTestId('writes')).toHaveText('1');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await stableShell(page);
  await page.getByRole('button', { name: 'Switch synthetic account' }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open privacy controls' })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('each chain step has an enabled explicit picker and cancellation keeps the shell stable', async ({ page, browserName }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await markShell(page);
  const tabs = page.getByRole('tablist', { name: 'Privacy check panels' });
  for (let index = 0; index < 3; index += 1) {
    await tabs.getByRole('tab', { name: 'Chain', exact: true }).click();
    await tabs.getByRole('tab', { name: 'Recovery', exact: true }).click();
  }
  await tabs.getByRole('tab', { name: 'Chain', exact: true }).click();
  const choose = page.getByRole('button', { name: /Choose peer 1/ });
  await expect(choose).toBeEnabled();
  await expect(page.getByText('Your private fee cap')).toBeVisible();
  // Check settled contrast, not an intermediate color in the rapid-tab test.
  await tabs.evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
  });
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]')
    .disableRules(browserName === 'webkit' ? ['color-contrast'] : []).analyze();
  expect(axe.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
  await choose.focus();
  await page.keyboard.press('Enter');
  await expect(choose).toBeHidden();
  await page.getByRole('button', { name: 'Deliver canonical synthetic result' }).click();
  await expect(choose).toBeEnabled();
  await choose.click();
  await page.getByRole('button', { name: 'Cancel Chain' }).click();
  await expect(page.getByText('Chain stopped locally')).toBeVisible();
  await page.getByRole('button', { name: 'Review another chain' }).click();
  await expect(choose).toBeEnabled();
  await choose.focus();
  await stableShell(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open privacy controls' })).toBeFocused();
});

test('saving outgoing recovery returns keyboard focus to the surviving switch', async ({ page }) => {
  await markShell(page);
  const toggle = page.getByRole('switch', { name: 'Recover outgoing payment details' });
  await toggle.click();
  await page.getByRole('button', { name: 'Omit future outgoing details' }).focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeDisabled();
  // Resolve the synthetic save without moving the user's keyboard focus.
  await page.getByRole('button', { name: 'Finish pending preference' }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(toggle).toBeEnabled();
  await expect(toggle).toBeFocused();
  await stableShell(page);
});

test('proof sharing waits for exact explicit consent and durable reservation before disclosure', async ({ page, browserName }) => {
  await markShell(page);
  await page.getByRole('tab', { name: 'Proof', exact: true }).click();
  await page.getByRole('button', { name: 'Start synthetic proof review' }).click();
  const authorize = page.getByRole('button', { name: 'Authorize Proof Sharing' });
  await expect(authorize).toBeEnabled();
  await expect(page.getByTestId('proof-events')).toHaveText('none');
  await expect(page.getByText(/Sharing authorizes the exact payment above/)).toBeVisible();
  await expect(page.getByText('Balance After', { exact: true }).locator('..').getByText('0.99999 XLM', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change synthetic amount' }).click();
  await expect(authorize).toBeDisabled();
  await expect(page.getByTestId('proof-events')).toHaveText('none');
  await page.getByRole('button', { name: 'Change synthetic amount' }).click();
  await expect(authorize).toBeEnabled();
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]')
    .disableRules(browserName === 'webkit' ? ['color-contrast'] : []).analyze();
  expect(axe.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('proof-status')).toHaveText('cancelled');
  await expect(page.getByTestId('proof-events')).toHaveText('none');
  await page.getByRole('button', { name: 'Start synthetic proof review' }).click();
  await authorize.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('proof-status')).toHaveText('shared');
  await expect(page.getByTestId('proof-events')).toHaveText('reserved,shared');
  await page.getByRole('button', { name: 'Start synthetic proof review' }).focus();
  await stableShell(page);
});

test('failed preference writes preserve recovery and keyboard focus without stealing another control', async ({ page }) => {
  await markShell(page);
  const toggle = page.getByRole('switch', { name: 'Recover outgoing payment details' });
  const omit = page.getByRole('button', { name: 'Omit future outgoing details' });
  const reject = page.getByRole('button', { name: 'Reject pending preference' });
  await toggle.click();
  await omit.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeDisabled();
  await reject.evaluate(element => (element as HTMLButtonElement).click());
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('writes')).toHaveText('0');
  await expect(toggle).toBeFocused();
  await stableShell(page);
  await omit.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeDisabled();
  await reject.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeEnabled();
  await expect(reject).toBeFocused();
  await expect(page.getByTestId('writes')).toHaveText('0');
  await stableShell(page);
});
