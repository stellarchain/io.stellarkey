import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.skip(!process.env.PRIVATE_COMPONENT_FIXTURE_SHA256, 'Use the isolated synthetic component runner.');

const remoteSocketAttempts = new WeakMap<Page, number>();
const pageErrors = new WeakMap<Page, number>();

test.beforeEach(async ({ page, baseURL }) => {
  const ownedOrigin = new URL(baseURL!).origin;
  const ownedSocketOrigin = ownedOrigin.replace(/^http/, 'ws');
  remoteSocketAttempts.set(page, 0);
  pageErrors.set(page, 0);
  page.on('pageerror', () => {
    // Retain only a count, never the browser's error message or rendered data.
    pageErrors.set(page, (pageErrors.get(page) ?? 0) + 1);
  });
  await page.addInitScript(() => {
    // Obsolete preferences are synthetic public configuration, never wallet data.
    localStorage.setItem('stellarkey.private-relay.preferences.v1', JSON.stringify({
      useRelay: true, helpRelay: true, transport: 'waku', relayUrls: ['wss://synthetic.invalid'],
      wakuPeers: [], wakuClusterId: 1, feeAtomic: '10000',
    }));
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const owner = document.querySelector('[data-modal-shell][data-direct-identity="retained"]')?.closest('[data-modal-backdrop]');
      (window as Window & { directEscapeSnapshot?: { busy: boolean; shells: number } }).directEscapeSnapshot = {
        busy: owner?.getAttribute('aria-busy') === 'true', shells: document.querySelectorAll('[data-modal-shell]').length,
      };
    }, true);
  });
  await page.route('**/*', route => new URL(route.request().url()).origin === ownedOrigin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === ownedSocketOrigin) socket.connectToServer();
    else {
      remoteSocketAttempts.set(page, (remoteSocketAttempts.get(page) ?? 0) + 1);
      socket.close();
    }
  });
  await page.goto('/private-component-fixture');
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toBe(0);
  pageErrors.delete(page);
  expect(remoteSocketAttempts.get(page)).toBe(0);
  remoteSocketAttempts.delete(page);
});

async function deliver(page: Page, name: string) {
  // Runtime completions are permitted while the surrounding fixture is inert.
  await page.getByRole('button', { name, exact: true }).evaluate(element => (element as HTMLButtonElement).click());
}

async function markShell(page: Page) {
  await expect(page.locator('[data-modal-shell]')).toHaveCount(1);
  await page.locator('[data-modal-shell]').evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
    (element as HTMLElement).dataset.directIdentity = 'retained';
  });
  await page.locator('[data-modal-backdrop]').evaluate(element => { (element as HTMLElement).dataset.directIdentity = 'retained'; });
}

async function stableShell(page: Page) {
  await expect.poll(() => page.locator('[data-modal-shell]').evaluate(element => (element as HTMLElement).dataset.directIdentity === 'retained')).toBe(true);
  await expect.poll(() => page.locator('[data-modal-backdrop]').evaluate(element => (element as HTMLElement).dataset.directIdentity === 'retained')).toBe(true);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow === 'hidden')).toBe(true);
  await expect.poll(() => page.evaluate(() => !!document.querySelector('main')?.closest('[inert]'))).toBe(true);
  await expect.poll(() => page.evaluate(() => !!document.querySelector('[data-modal-backdrop]')?.contains(document.activeElement))).toBe(true);
}

async function openReview(page: Page, kind: 'send' | 'withdrawal') {
  await page.getByRole('button', { name: `Open synthetic private ${kind}`, exact: true }).click();
  await markShell(page);
  await page.getByLabel('Amount', { exact: true }).fill('1');
  await page.getByRole('button', { name: kind === 'send' ? 'Review Private Send' : 'Review Withdrawal', exact: true }).click();
  await stableShell(page);
}

async function observeSendContinuity(page: Page) {
  return page.evaluateHandle(async () => {
    const shell = document.querySelector<HTMLElement>('[data-modal-shell]')!;
    const backdrop = document.querySelector<HTMLElement>('[data-modal-backdrop]')!;
    const app = document.querySelector<HTMLElement>('[data-app-surface]')!;
    const entrances = [...shell.getAnimations(), ...backdrop.getAnimations()];
    await Promise.all(entrances.map(animation => animation.finished.catch(() => {})));
    const baseline = new Map(entrances.map(animation => [animation, animation.startTime]));
    const state = { interruptions: 0, animations: 0, stop: () => {} };
    const onStart = (event: AnimationEvent) => {
      if (event.target !== shell && event.target !== backdrop) return;
      const animations = (event.target as HTMLElement).getAnimations();
      // Ignore only late delivery of an unchanged, completed entrance.
      if (animations.length && animations.every(animation => baseline.has(animation)
        && animation.startTime === baseline.get(animation) && animation.playState === 'finished' && !animation.pending)) return;
      state.animations++;
    };
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.target === document.body && record.attributeName === 'style'
          && !/overflow:\s*hidden/.test(record.oldValue ?? '')) state.interruptions++;
        if (record.target === app && record.attributeName === 'inert' && record.oldValue === null) state.interruptions++;
        if (record.target === backdrop && record.attributeName === 'data-overlay-state'
          && backdrop.dataset.overlayState !== 'open') state.interruptions++;
      }
      if (!shell.isConnected || !backdrop.isConnected || !app.closest('[inert]')
        || document.body.style.overflow !== 'hidden') state.interruptions++;
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true,
      attributeOldValue: true, attributeFilter: ['style', 'inert', 'data-overlay-state'] });
    shell.addEventListener('animationstart', onStart);
    backdrop.addEventListener('animationstart', onStart);
    state.stop = () => {
      observer.disconnect();
      shell.removeEventListener('animationstart', onStart);
      backdrop.removeEventListener('animationstart', onStart);
    };
    return state;
  });
}

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  for (const activation of ['pointer', 'Enter', 'Space'] as const) {
    test(`regular send handoff retains the shared modal (${reducedMotion}, ${activation})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await page.getByRole('button', { name: 'Open shared send', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Send Payment', exact: true });
      await expect(dialog.getByLabel('Private Recipient', { exact: true })).toBeVisible();
      await markShell(page);
      const continuity = await observeSendContinuity(page);
      // Fixed non-usable fixtures only; no wallet import, signing or network.
      const recipient = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
      await dialog.getByLabel('Private Recipient', { exact: true }).fill(recipient);
      await dialog.getByLabel('Amount', { exact: true }).fill('1');
      await dialog.getByLabel('Private Memo (Optional)', { exact: true }).fill('synthetic-private-only');
      const regular = dialog.getByRole('button', { name: 'Use Regular Send', exact: true });
      if (activation === 'pointer') await regular.click();
      else { await regular.focus(); await regular.press(activation === 'Space' ? ' ' : activation); }
      const publicRecipient = dialog.getByLabel('Recipient Address or Federation', { exact: true });
      await expect(publicRecipient).toBeVisible();
      await expect(publicRecipient).toHaveValue(recipient);
      await expect(publicRecipient).toBeFocused();
      await expect(dialog.getByRole('tab', { name: 'Public', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(dialog.getByLabel('Memo (Optional)', { exact: true })).toHaveValue('');
      await expect(dialog.getByLabel('Amount', { exact: true })).toHaveValue('');
      await expect(page.getByTestId('public-send-requests')).toHaveText('0');
      await stableShell(page);
      await page.keyboard.press('Tab');
      await stableShell(page);
      for (let index = 0; index < 3; index++) {
        await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
        await dialog.getByRole('tab', { name: 'Public', exact: true }).click();
      }
      await stableShell(page);
      expect(await continuity.evaluate(({ interruptions, animations }) => ({ interruptions, animations })))
        .toEqual({ interruptions: 0, animations: 0 });
      await continuity.evaluate(state => state.stop());
      await continuity.dispose();
      const violations = await new AxeBuilder({ page }).include('[data-modal-backdrop]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(violations.violations.map(({ id, impact }) => ({ id, impact }))).toEqual([]);
      await publicRecipient.fill('');
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Open shared send', exact: true })).toBeFocused();
      await expect.poll(() => page.evaluate(() => document.body.style.overflow !== 'hidden'
        && !document.querySelector('main')?.closest('[inert]'))).toBe(true);
      await page.getByRole('button', { name: 'Open shared send', exact: true }).click();
      await dialog.getByRole('tab', { name: 'Public', exact: true }).click();
      await expect(publicRecipient).toHaveValue('');
    });
  }
}

test('regular send handoff ignores late private validation across switching and closing', async ({ page }) => {
  await page.getByRole('button', { name: 'Delay recipient validation', exact: true }).click();
  await page.getByRole('button', { name: 'Open shared send', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Send Payment', exact: true });
  const recipient = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  await expect(dialog.getByLabel('Private Recipient', { exact: true })).toBeVisible();
  await markShell(page);
  for (const closeBeforeCompletion of [false, true]) {
    await dialog.getByLabel('Private Recipient', { exact: true }).fill('tskpay_synthetic-delayed-only');
    await dialog.getByLabel('Private Recipient', { exact: true }).fill(recipient);
    await dialog.getByRole('button', { name: 'Use Regular Send', exact: true }).click();
    await expect(dialog.getByLabel('Recipient Address or Federation', { exact: true })).toHaveValue(recipient);
    if (closeBeforeCompletion) {
      await dialog.getByLabel('Recipient Address or Federation', { exact: true }).fill('');
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await deliver(page, 'Finish recipient validation');
    if (closeBeforeCompletion) await expect(page.getByRole('dialog')).toHaveCount(0);
    else {
      await stableShell(page);
      await expect(dialog.getByRole('tab', { name: 'Public', exact: true })).toHaveAttribute('aria-selected', 'true');
      await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
      await expect(dialog.getByLabel('Private Recipient', { exact: true })).toHaveValue('');
      await expect(dialog.getByText('Recipient verified,', { exact: true })).toHaveCount(0);
    }
  }
  await expect(page.getByTestId('public-send-requests')).toHaveText('0');
  await expect(page.getByTestId('recipient-preparations')).toHaveText('0');
  await expect(page.getByTestId('direct-submissions')).toHaveText('0');
});

test('regular send handoff from a standalone private sheet still opens public Send', async ({ page }) => {
  await page.getByRole('button', { name: 'Open synthetic private send', exact: true }).click();
  const recipient = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  await page.getByLabel('Private Recipient', { exact: true }).fill(recipient);
  await page.getByRole('button', { name: 'Use Regular Send', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Send Payment', exact: true });
  await expect(dialog.getByLabel('Recipient Address or Federation', { exact: true })).toHaveValue(recipient);
  await expect(dialog.getByRole('tab', { name: 'Public', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByTestId('public-send-requests')).toHaveText('1');
});

for (const kind of ['send', 'withdrawal'] as const) {
  test(`direct ${kind} ignores old relay preferences, preserves consent and does not claim ledger confirmation`, async ({ page }) => {
    await page.getByRole('button', { name: 'Use direct preparation', exact: true }).click();
    await page.getByRole('button', { name: 'Hold disclosed direct preparation', exact: true }).click();
    await openReview(page, kind);
    const authorize = page.getByRole('button', { name: 'Authorize Proof Sharing', exact: true });
    await expect(authorize).toBeEnabled();
    await expect(page.getByText('Your Stellar account is public as the submitting account and pays network fees.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Privacy relay|Start Relaying|Earn/ })).toHaveCount(0);
    await expect(page.getByTestId('direct-proof-events')).toHaveText('none');
    await expect(page.getByTestId('direct-submissions')).toHaveText('0');
    await authorize.press('Enter');
    await expect(page.getByTestId('direct-proof-events')).toHaveText('reserved,shared');
    const confirm = page.getByRole('button', { name: kind === 'send' ? 'Confirm Send' : 'Confirm', exact: true });
    await expect(confirm).toBeDisabled();
    await expect(confirm).toBeFocused();
    await confirm.press('Enter');
    await expect(page.getByTestId('direct-submission-attempts')).toHaveText('0');
    await stableShell(page);
    await deliver(page, 'Finish newest direct preparation');
    await expect(confirm).toBeEnabled();
    await expect(confirm).toBeFocused();
    await confirm.press('Enter');
    await expect(page.getByTestId('direct-submissions')).toHaveText('1');
    await expect(confirm).toBeFocused();
    await stableShell(page);
    await deliver(page, 'Finish direct submission');
    await expect(page.getByText('Verifying on Stellar — your balance updates in a moment')).toBeVisible();
    await expect(page.getByTestId('direct-outcomes')).toHaveText('1');
    await expect(page.getByRole('heading', { name: /confirmed/i })).toHaveCount(0);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Open synthetic private ${kind}`, exact: true })).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow !== 'hidden' && !document.querySelector('main')?.closest('[inert]'))).toBe(true);
  });
}

for (const mode of ['send', 'withdrawal', 'chained-send', 'chained-withdrawal'] as const) {
  test(`${mode} keeps the first submission outcome after two real confirmation events in the same render`, async ({ page }) => {
    const chained = mode === 'chained-send' || mode === 'chained-withdrawal';
    const withdrawal = mode === 'withdrawal' || mode === 'chained-withdrawal';
    await page.getByRole('button', { name: chained ? 'Use direct chained preparation' : 'Use direct preparation', exact: true }).click();
    await openReview(page, withdrawal ? 'withdrawal' : 'send');
    if (!chained) await page.getByRole('button', { name: 'Authorize Proof Sharing', exact: true }).click();
    const confirm = page.getByRole('button', { name: withdrawal ? 'Confirm' : 'Confirm Send', exact: true });
    await expect(confirm).toBeEnabled();
    await confirm.focus();
    await deliver(page, 'Double activate private confirmation');
    // Test the next real keyboard event before waiting for shell busy state.
    await page.keyboard.press('Escape');
    const escapeSnapshot = await page.evaluate(() => (window as Window & { directEscapeSnapshot?: { busy: boolean; shells: number } }).directEscapeSnapshot);
    expect(escapeSnapshot?.shells).toBe(1);
    expect(escapeSnapshot?.busy).toBe(true);
    await expect(page.getByRole('dialog', { name: 'Discard changes?', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('direct-same-tick-confirmations')).toHaveText('2');
    await expect(page.getByTestId('direct-submission-attempts')).toHaveText('1');
    await expect(page.getByTestId('direct-busy-rejections')).toHaveText('0');
    await expect(page.getByTestId('direct-submissions')).toHaveText('1');
    await expect(page.getByTestId('direct-outcomes')).toHaveText('0');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    await expect(confirm).toBeFocused();
    await stableShell(page);
    if (chained) {
      await expect(page.getByText('Step 1 of 2 · Confirming…')).toBeVisible();
      await deliver(page, 'Advance direct chain');
      await expect(page.getByText('Step 2 of 2 · Confirming…')).toBeVisible();
      await deliver(page, 'Advance direct chain');
    } else {
      await deliver(page, 'Finish direct submission');
    }
    await expect(page.getByText('Verifying on Stellar — your balance updates in a moment')).toBeVisible();
    await expect(page.getByTestId('direct-outcomes')).toHaveText('1');
    await expect(page.getByTestId('direct-submission-attempts')).toHaveText('1');
    await expect(page.getByTestId('direct-busy-rejections')).toHaveText('0');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`direct review cancellation keeps its shell and blocks stale preparation (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole('button', { name: 'Delay direct preparation', exact: true }).click();
    await openReview(page, 'send');
    await expect(page.getByTestId('recipient-preparations')).toHaveText('1');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('1');
    await page.getByRole('button', { name: 'Review Private Send', exact: true }).click();
    await expect(page.getByTestId('recipient-preparations')).toHaveText('2');
    await deliver(page, 'Finish oldest direct preparation');
    await expect(page.getByTestId('direct-cancellations')).toHaveText('1');
    await expect(page.getByRole('button', { name: 'Confirm Send', exact: true })).toBeDisabled();
    await deliver(page, 'Finish newest direct preparation');
    await expect(page.getByRole('button', { name: 'Confirm Send', exact: true })).toBeEnabled();
    const details = page.getByRole('button', { name: 'Details', exact: true });
    // Native summary remains in the modal's keyboard containment.
    await page.locator('summary').filter({ hasText: /^Details$/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('details[open]')).toHaveCount(1);
    await page.keyboard.press('Tab');
    await stableShell(page);
    const diagnostics = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(diagnostics.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? '')).map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.length }))).toEqual([]);
    expect(await page.locator('[data-modal-shell]').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    const discard = page.getByRole('dialog', { name: 'Discard changes?', exact: true });
    await discard.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open synthetic private send', exact: true }).click();
    await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('');
    await expect(details).toHaveCount(0);
  });
}

test('direct account replacement prevents late submission feedback from overwriting a fresh review', async ({ page }) => {
  await page.getByRole('button', { name: 'Use direct preparation', exact: true }).click();
  await openReview(page, 'send');
  await page.getByRole('button', { name: 'Authorize Proof Sharing', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Send', exact: true }).click();
  await expect(page.getByTestId('direct-submissions')).toHaveText('1');
  await deliver(page, 'Replace direct account');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Review Private Send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Authorize Proof Sharing', exact: true })).toBeEnabled();
  await deliver(page, 'Finish direct submission');
  await expect(page.getByTestId('direct-outcomes')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Authorize Proof Sharing', exact: true })).toBeEnabled();
  await expect(page.getByText('Verifying on Stellar — your balance updates in a moment')).toHaveCount(0);
  await stableShell(page);
});

test('an uncertain direct RPC outcome stays unconfirmed without inviting a second submission', async ({ page }) => {
  await page.getByRole('button', { name: 'Use direct preparation', exact: true }).click();
  await openReview(page, 'withdrawal');
  await page.getByRole('button', { name: 'Authorize Proof Sharing', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByTestId('direct-submissions')).toHaveText('1');
  await deliver(page, 'Return unknown direct status');
  await expect(page.getByRole('heading', { name: "We couldn't confirm this payment yet", exact: true })).toBeVisible();
  await expect(page.getByText('Verifying on Stellar — your balance updates in a moment')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('direct-submissions')).toHaveText('1');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('direct chained sends still preflight and progress without helper selection', async ({ page }) => {
  await page.getByRole('button', { name: 'Use direct chained preparation', exact: true }).click();
  await openReview(page, 'send');
  const confirm = page.getByRole('button', { name: 'Confirm Send', exact: true });
  await expect(confirm).toBeEnabled();
  await expect(page.locator('dd').filter({ hasText: 'Sends in 2 steps' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Choose peer|Cancel Chain/ })).toHaveCount(0);
  await confirm.press('Enter');
  await expect(page.getByText('Step 1 of 2 · Confirming…')).toBeVisible();
  await deliver(page, 'Advance direct chain');
  await expect(page.getByText('Step 2 of 2 · Confirming…')).toBeVisible();
  await stableShell(page);
  await deliver(page, 'Advance direct chain');
  await expect(page.getByText('Verifying on Stellar — your balance updates in a moment')).toBeVisible();
  await expect(page.getByTestId('direct-submissions')).toHaveText('1');
});

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`multi-note withdrawal uses its real form and keeps the approval shell (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.getByRole('button', { name: 'Use direct chained preparation', exact: true }).click();
    await openReview(page, 'withdrawal');
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeEnabled();
    await expect(page.locator('dd').filter({ hasText: 'Sends in 2 steps' })).toBeVisible();
    await expect(page.getByText('Consolidating notes', { exact: true })).toHaveCount(0);
    const audit = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(audit.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length }))).toEqual([]);
    await confirm.press('Enter');
    await expect(page.getByText('Step 1 of 2 · Confirming…')).toBeVisible();
    await stableShell(page);
    await deliver(page, 'Advance direct chain');
    await expect(page.getByText('Step 2 of 2 · Confirming…')).toBeVisible();
    await stableShell(page);
    await deliver(page, 'Advance direct chain');
    await expect(page.getByText('Verifying on Stellar — your balance updates in a moment')).toBeVisible();
    await expect(page.getByRole('heading', { name: /confirmed/i })).toHaveCount(0);
    await expect(page.getByTestId('direct-submissions')).toHaveText('1');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open synthetic private withdrawal', exact: true })).toBeFocused();
  });
}
