import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __merchantClipboard: { writes: number; pending: Array<{ resolve(): void; reject(): void }> };
    __merchantToastTimers: { owned: Set<number>; cleared: number };
  }
}

test.skip(!process.env.PRIVATE_COMPONENT_FIXTURE_SHA256, 'Use the isolated synthetic component runner.');

test.beforeEach(async ({ page, baseURL }) => {
  expect(Boolean(process.env.PRIVATE_COMPONENT_FIXTURE_SHA256)).toBe(true);
  const ownedOrigin = new URL(baseURL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === ownedOrigin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === ownedOrigin.replace(/^http/, 'ws')) socket.connectToServer();
    else socket.close();
  });
  await page.addInitScript(() => {
    window.__merchantClipboard = { writes: 0, pending: [] };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => {
        window.__merchantClipboard.writes += 1;
        await new Promise<void>((resolve, reject) => window.__merchantClipboard.pending.push({ resolve, reject: () => reject(new Error('Synthetic clipboard failure payload')) }));
      },
    } });
    const timers = window.__merchantToastTimers = { owned: new Set<number>(), cleared: 0 };
    const timeout = window.setTimeout.bind(window);
    const clear = window.clearTimeout.bind(window);
    window.setTimeout = (handler, delay, ...args) => {
      const id = timeout(handler, delay, ...args);
      if (delay === 4200) timers.owned.add(id);
      return id;
    };
    window.clearTimeout = id => {
      if (id !== undefined && timers.owned.delete(id)) timers.cleared += 1;
      clear(id);
    };
  });
  await page.goto('/private-component-fixture');
  await page.getByRole('button', { name: 'Test merchant feedback', exact: true }).click();
});

async function control(page: Page, name: string) {
  // Synthetic completions remain deliverable while the real modal makes the
  // fixture controls inert. No wallet content is returned by the boundary.
  await page.getByRole('button', { name, exact: true }).evaluate(node => (node as HTMLButtonElement).click());
}

async function prepare(page: Page, codes = false) {
  await page.getByRole('button', { name: 'Prepare feedback merchant', exact: true }).click();
  await expect(page.getByTestId('feedback-ready')).toHaveText('true');
  await expect(page.getByTestId('feedback-issue')).toHaveText('none');
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held?.some(lock => lock.name === 'stellarkey.merchant.writer.v1') ?? false)).toBe(true);
  await page.getByRole('button', { name: 'Authenticate merchant staff', exact: true }).click();
  await expect(page.getByTestId('feedback-authentication')).toHaveText('done');
  await expect(page.getByTestId('feedback-staff')).toHaveText('active');
  if (codes) await page.getByRole('button', { name: 'Show code actions', exact: true }).click();
}

async function openCustomer(page: Page, reward = false) {
  await page.getByRole('button', { name: `Open the card for Fixture ${reward ? 'reward' : 'customer'}`, exact: true }).click();
  return page.getByRole('dialog', { name: `Fixture ${reward ? 'reward' : 'customer'}`, exact: true });
}

async function copyCode(page: Page, title = 'First code') {
  await page.getByRole('button', { name: `More actions for ${title}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy request', exact: true }).click();
}

async function settleClipboard(page: Page, result: 'resolve' | 'reject') {
  await page.evaluate(outcome => window.__merchantClipboard.pending.shift()?.[outcome](), result);
}

test('aggregate merchant context preserves every field and reference through real provider updates', async ({ page }) => {
  await prepare(page);
  const probe = page.getByTestId('merchant-context-equivalence');
  await expect(probe).toHaveAttribute('data-fields', '125');
  await expect(probe).toHaveAttribute('data-mismatches', '0');
  expect(Number(await probe.getAttribute('data-callbacks'))).toBeGreaterThan(0);
  expect(Number(await probe.getAttribute('data-references'))).toBeGreaterThan(0);
  const initialSnapshots = Number(await probe.getAttribute('data-snapshots'));
  await control(page, 'Update aggregate configuration');
  await expect(page.getByTestId('feedback-context-settled')).toHaveText('1');
  await expect(probe).toHaveAttribute('data-large', 'true');
  await control(page, 'Add aggregate ticket line');
  await expect(probe).toHaveAttribute('data-lines', '1');
  await control(page, 'Open aggregate shift');
  await expect(page.getByTestId('feedback-context-settled')).toHaveText('2');
  await control(page, 'Settle aggregate cash');
  await expect(page.getByTestId('feedback-context-settled')).toHaveText('3');
  await expect(probe).toHaveAttribute('data-orders', '1');
  await expect(probe).toHaveAttribute('data-lines', '0');
  await page.context().setOffline(true);
  await expect(probe).toHaveAttribute('data-online', 'false');
  await page.context().setOffline(false);
  await expect(probe).toHaveAttribute('data-online', 'true');
  await control(page, 'Lock aggregate staff');
  await expect(page.getByTestId('feedback-context-settled')).toHaveText('4');
  await expect(probe).toHaveAttribute('data-active', 'false');
  await expect(probe).toHaveAttribute('data-reports', 'false');
  await expect(probe).toHaveAttribute('data-fields', '125');
  await expect(probe).toHaveAttribute('data-mismatches', '0');
  await expect(page.getByTestId('feedback-context-failure')).toHaveText('false');
  expect(Number(await probe.getAttribute('data-snapshots'))).toBeGreaterThan(initialSnapshots);
});

test('aggregate merchant context stays equivalent through revocation and fresh provider lifetimes', async ({ page }) => {
  await prepare(page);
  const probe = page.getByTestId('merchant-context-equivalence');
  await control(page, 'Fail feedback erase');
  await control(page, 'Reset feedback merchant');
  await expect(page.getByTestId('feedback-authorization')).toHaveText('waiting');
  await control(page, 'Authorize feedback reset');
  await expect(page.getByTestId('feedback-resets')).toHaveText('1');
  await expect(probe).toHaveAttribute('data-fields', '125');
  await expect(probe).toHaveAttribute('data-mismatches', '0');
  await control(page, 'Lock feedback wallet');
  await expect(page.getByTestId('feedback-phase')).toHaveText('locked');
  await expect(probe).toHaveAttribute('data-active', 'false');
  await expect(probe).toHaveAttribute('data-mismatches', '0');
  await control(page, 'Unlock feedback wallet');
  await expect(page.getByTestId('feedback-ready')).toHaveText('true');
  await control(page, 'Authenticate merchant staff');
  await expect(page.getByTestId('feedback-authentication')).toHaveText('done');
  await expect(probe).toHaveAttribute('data-active', 'true');
  await expect(probe).toHaveAttribute('data-mismatches', '0');
  await control(page, 'Toggle feedback provider');
  await expect(probe).toHaveCount(0);
  await control(page, 'Toggle feedback provider');
  await expect(page.getByTestId('feedback-ready')).toHaveText('true');
  await expect(probe).toHaveAttribute('data-fields', '125');
  await expect(probe).toHaveAttribute('data-mismatches', '0');
});

for (const outcome of ['resolve', 'reject'] as const) {
  test(`changed code requests retain physical copy ownership and suppress stale ${outcome} feedback`, async ({ page }) => {
    await prepare(page, true);
    await copyCode(page);
    await control(page, 'Replace synthetic code request');
    const changed = page.getByRole('switch', { name: 'Changed code in use', exact: true });
    await expect(changed).toBeVisible();
    const row = changed.locator('xpath=ancestor::div[contains(@class,"row-hover")]');
    await page.getByRole('button', { name: 'More actions for Changed code', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Copy request', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await copyCode(page, 'Second code');
    await expect.poll(() => page.evaluate(() => window.__merchantClipboard.writes)).toBe(2);
    await settleClipboard(page, outcome);
    await expect(row.getByRole('status')).toHaveCount(0);
    await expect(row.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.app-safe-toast')).toBeEmpty();
    await expect(page.getByRole('status')).toHaveText('Copying request…');
    await settleClipboard(page, 'resolve');
    await expect(page.locator('.app-safe-toast > div')).toHaveCount(1);
    await copyCode(page, 'Changed code');
    await expect.poll(() => page.evaluate(() => window.__merchantClipboard.writes)).toBe(3);
    await settleClipboard(page, 'resolve');
    await expect(page.locator('.app-safe-toast > div')).toHaveCount(2);
  });
}

test('retiring and restoring a code cannot start another copy while the earlier OS write is pending', async ({ page }) => {
  await prepare(page, true);
  await copyCode(page);
  const toggle = page.getByRole('switch', { name: 'First code in use', exact: true });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.getByRole('button', { name: 'More actions for First code', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Copy request', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.getByRole('button', { name: 'More actions for First code', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Copy request', exact: true })).toBeDisabled();
  await settleClipboard(page, 'reject');
  await expect(page.getByRole('menuitem', { name: 'Copy request', exact: true })).toBeEnabled();
  await expect(page.locator('.row-hover').getByRole('alert')).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Copy request', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__merchantClipboard.writes)).toBe(2);
  await settleClipboard(page, 'resolve');
  await expect(page.locator('.app-safe-toast')).toContainText('Payment request copied.');
});

for (const outcome of ['Deliver', 'Reject'] as const) {
  test(`reopened customer detail keeps its draft and pending action through an old ${outcome.toLowerCase()} completion`, async ({ page }) => {
    await prepare(page);
    let dialog = await openCustomer(page);
    await dialog.getByLabel('Note', { exact: true }).fill('Earlier synthetic draft');
    await control(page, outcome === 'Deliver' ? 'Hold after merchant write' : 'Hold before merchant write');
    await dialog.getByRole('button', { name: 'Save note', exact: true }).click();
    await expect(page.getByTestId('feedback-stage')).toHaveText(outcome === 'Deliver' ? 'after-write' : 'before-write');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    dialog = await openCustomer(page);
    await dialog.getByLabel('Note', { exact: true }).fill('Current synthetic draft');
    await control(page, 'Hold before merchant write');
    const save = dialog.getByRole('button', { name: 'Save note', exact: true });
    await save.click();
    await control(page, `${outcome} feedback response`);
    await expect(page.getByTestId('feedback-stage')).toHaveText('before-write');
    await expect(page.getByTestId('feedback-deliveries')).toHaveText('1');
    await expect(save).toBeDisabled();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.app-safe-toast')).toBeEmpty();
    await expect.poll(() => dialog.getByLabel('Note', { exact: true }).evaluate(node => (node as HTMLTextAreaElement).value === 'Current synthetic draft')).toBe(true);
    await control(page, 'Reject feedback response');
    await expect(dialog.getByRole('alert')).toHaveText('The note could not be saved. Try again.');
    await save.click();
    await expect(page.locator('.app-safe-toast')).toContainText('Customer note saved on this device.');
  });
}

test('a late forgotten-customer completion cannot close another customer detail', async ({ page }) => {
  await prepare(page);
  let dialog = await openCustomer(page);
  await dialog.getByRole('button', { name: 'Forget This Customer', exact: true }).click();
  await control(page, 'Hold after merchant write');
  await dialog.getByRole('button', { name: 'Forget', exact: true }).click();
  await expect(page.getByTestId('feedback-stage')).toHaveText('after-write');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  dialog = await openCustomer(page, true);
  await control(page, 'Deliver feedback response');
  await expect(page.getByTestId('feedback-customer-count')).toHaveText('1');
  await expect(dialog).toBeVisible();
  await expect(page.locator('.app-safe-toast')).toBeEmpty();
});

test('unmounted code actions cannot publish a delayed copy into a remounted page', async ({ page }) => {
  await prepare(page, true);
  await copyCode(page);
  await control(page, 'Hide merchant actions');
  await expect(page.getByRole('switch', { name: 'First code in use', exact: true })).toHaveCount(0);
  await control(page, 'Show code actions');
  await copyCode(page);
  await settleClipboard(page, 'resolve');
  await expect(page.getByRole('status')).toHaveText('Copying request…');
  await expect(page.locator('.app-safe-toast')).toBeEmpty();
  await settleClipboard(page, 'resolve');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.locator('.app-safe-toast > div')).toHaveCount(1);
});

for (const outcome of ['resolve', 'reject'] as const) {
  test(`failed same-session merchant reset revokes old copy ${outcome} and permits a fresh retry`, async ({ page }) => {
    await prepare(page, true);
    await copyCode(page);
    await control(page, 'Fail feedback erase');
    await control(page, 'Reset feedback merchant');
    await expect(page.getByTestId('feedback-authorization')).toHaveText('waiting');
    await control(page, 'Authorize feedback reset');
    await expect(page.getByTestId('feedback-resets')).toHaveText('1');
    await expect(page.getByTestId('feedback-ready')).toHaveText('true');
    await expect(page.getByTestId('feedback-phase')).toHaveText('unlocked');
    await settleClipboard(page, outcome);
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.locator('.row-hover').getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.app-safe-toast')).toBeEmpty();
    await copyCode(page);
    await expect.poll(() => page.evaluate(() => window.__merchantClipboard.writes)).toBe(2);
    await settleClipboard(page, 'resolve');
    await expect(page.locator('.app-safe-toast')).toContainText('Payment request copied.');
  });
}

test('failed same-session reset suppresses the old note error and leaves a fresh store retry usable', async ({ page }) => {
  await prepare(page);
  const dialog = await openCustomer(page);
  await dialog.getByLabel('Note', { exact: true }).fill('Synthetic retry draft');
  await control(page, 'Hold before merchant write');
  const save = dialog.getByRole('button', { name: 'Save note', exact: true });
  await save.click();
  await expect(page.getByTestId('feedback-stage')).toHaveText('before-write');
  await control(page, 'Fail feedback erase');
  await control(page, 'Reset feedback merchant');
  await expect(page.getByTestId('feedback-authorization')).toHaveText('waiting');
  await control(page, 'Authorize feedback reset');
  await expect(page.getByTestId('feedback-resets')).toHaveText('1');
  await control(page, 'Reject feedback response');
  await expect(save).toBeEnabled();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.app-safe-toast')).toBeEmpty();
  await control(page, 'Authenticate merchant staff');
  await expect(page.getByTestId('feedback-authentication')).toHaveText('done');
  await save.click();
  await expect(page.locator('.app-safe-toast')).toContainText('Customer note saved on this device.');
});

for (const motion of ['reduce', 'no-preference'] as const) {
  test.describe(`merchant feedback motion ${motion}`, () => {
    test.use({ contextOptions: { reducedMotion: motion } });
    test('local feedback preserves modal ownership and accessible reflow', async ({ page }) => {
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(motion === 'reduce');
      await page.setViewportSize({ width: 640, height: 900 });
      await prepare(page);
      const dialog = await openCustomer(page);
      await page.evaluate(async () => {
        const shell = document.querySelector<HTMLElement>('[data-modal-shell]')!;
        const backdrop = document.querySelector<HTMLElement>('[data-modal-backdrop]')!;
        await Promise.all([...shell.getAnimations(), ...backdrop.getAnimations()].map(animation => animation.finished.catch(() => {})));
        shell.dataset.feedbackIdentity = 'retained';
        backdrop.dataset.feedbackIdentity = 'retained';
      });
      // Halve the CSS viewport for 200% equivalent reflow, separately from
      // physical pinch zoom and human assistive-technology verification.
      await page.setViewportSize({ width: 320, height: 900 });
      await dialog.getByLabel('Note', { exact: true }).fill('Synthetic local feedback');
      await control(page, 'Hold before merchant write');
      const save = dialog.getByRole('button', { name: 'Save note', exact: true });
      await save.focus();
      await expect(save).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('feedback-stage')).toHaveText('before-write');
      await expect(save).toBeFocused();
      await page.keyboard.press('Space');
      await page.keyboard.press('Enter');
      await save.evaluate(node => (node as HTMLButtonElement).click());
      await control(page, 'Reject feedback response');
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(save).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('.app-safe-toast')).toContainText('Customer note saved on this device.');
      await expect(save).toBeDisabled();
      await expect(save).toBeFocused();
      const structure = await page.evaluate(() => {
        const shell = document.querySelector<HTMLElement>('[data-modal-shell]')!;
        const backdrop = document.querySelector<HTMLElement>('[data-modal-backdrop]')!;
        const bounds = shell.getBoundingClientRect();
        return { shell: shell.dataset.feedbackIdentity, backdrop: backdrop.dataset.feedbackIdentity,
          focused: backdrop.contains(document.activeElement), inert: !!document.querySelector('main')?.closest('[inert]'),
          locked: document.body.style.overflow === 'hidden', contained: bounds.left >= -1 && bounds.right <= innerWidth + 1,
          reflow: shell.scrollWidth <= shell.clientWidth + 1 };
      });
      expect(structure.shell).toBe('retained');
      expect(structure.backdrop).toBe('retained');
      expect(structure.focused).toBe(true);
      expect(structure.inert).toBe(true);
      expect(structure.locked).toBe(true);
      expect(structure.contained).toBe(true);
      expect(structure.reflow).toBe(true);
      const audit = await new AxeBuilder({ page }).include('[data-modal-shell]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(audit.violations.map(violation => ({ id: violation.id, count: violation.nodes.length }))).toEqual([]);
      await dialog.getByRole('button', { name: 'Close', exact: true }).locator('svg').click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Open the card for Fixture customer', exact: true })).toBeFocused();
      await expect.poll(() => page.evaluate(() => document.body.style.overflow !== 'hidden' && !document.querySelector('main')?.closest('[inert]'))).toBe(true);
    });
  });
}

test('toast provider teardown clears every owned expiry timer', async ({ page }) => {
  await control(page, 'Toggle local toast provider');
  await control(page, 'Local toast');
  await control(page, 'Local toast');
  await expect.poll(() => page.evaluate(() => window.__merchantToastTimers.owned.size)).toBe(2);
  await control(page, 'Toggle local toast provider');
  await expect.poll(() => page.evaluate(() => ({ pending: window.__merchantToastTimers.owned.size, cleared: window.__merchantToastTimers.cleared }))).toEqual({ pending: 0, cleared: 2 });
});

test('a code switch keeps keyboard focus while its own mutation is pending', async ({ page, browserName }) => {
  await prepare(page, true);
  // This installed WebKit uses Option-Tab for buttons, even before loading.
  // Exercise its native baseline and the pending state with the same key.
  const nextKey = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  const baseline = page.getByRole('switch', { name: 'First code in use', exact: true });
  await baseline.focus();
  await page.keyboard.press(nextKey);
  await expect(page.getByRole('button', { name: 'More actions for First code', exact: true })).toBeFocused();
  const writes = Number(await page.getByTestId('feedback-writes').textContent());
  await control(page, 'Hold rejected feedback continuation');
  await control(page, 'Hold before merchant write');
  const toggle = page.getByRole('switch', { name: 'First code in use', exact: true });
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('feedback-stage')).toHaveText('before-write');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');
  await toggle.evaluate(node => (node as HTMLButtonElement).click());
  await page.keyboard.press(nextKey);
  await expect(page.getByRole('button', { name: 'More actions for First code', exact: true })).toBeFocused();
  await control(page, 'Reject feedback response');
  await expect(page.getByTestId('feedback-stage')).toHaveText('rejection-continuation');
  await expect(toggle).toBeDisabled();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await toggle.evaluate(node => (node as HTMLButtonElement).click());
  await expect(toggle).toBeChecked();
  await expect(page.getByTestId('feedback-writes')).toHaveText(String(writes + 1));
  await expect(toggle).toBeFocused();
  await control(page, 'Deliver feedback response');
  const row = toggle.locator('xpath=ancestor::div[contains(@class,"row-hover")]');
  await expect(row.getByRole('alert')).toHaveText('The counter code could not be updated. Try again.');
  await expect(toggle).toBeEnabled();
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeFocused();
  await expect(row.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('feedback-writes')).toHaveText(String(writes + 2));
});

test('counter code failures belong to their row and leave other rows and actions usable', async ({ page }) => {
  await prepare(page, true);
  await control(page, 'Hold before merchant write');
  const first = page.getByRole('switch', { name: 'First code in use', exact: true });
  const second = page.getByRole('switch', { name: 'Second code in use', exact: true });
  const writes = Number(await page.getByTestId('feedback-writes').textContent());
  await first.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect(page.getByTestId('feedback-stage')).toHaveText('before-write');
  await expect(first).toBeDisabled();
  await expect(second).toBeEnabled();
  await expect(page.getByRole('button', { name: 'More actions for First code', exact: true })).toBeEnabled();
  await control(page, 'Reject feedback response');
  const row = first.locator('xpath=ancestor::div[contains(@class,"row-hover")]');
  await expect(row.getByRole('alert')).toHaveText('The counter code could not be updated. Try again.');
  await expect(first).toBeChecked();
  await page.clock.install();
  await page.clock.fastForward(5000);
  await expect(row.getByRole('alert')).toBeVisible();
  await first.focus();
  await page.keyboard.press('Space');
  await expect(first).not.toBeChecked();
  await expect(row.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('feedback-writes')).toHaveText(String(writes + 2));
  await expect(page.locator('.app-safe-toast')).toContainText('Counter code retired. Remove any printed copies from the counter.');
});

test('copy failure remains outside the closed menu and retries one physical write', async ({ page }) => {
  await prepare(page, true);
  await copyCode(page);
  await expect(page.getByRole('menu')).toHaveCount(0);
  const row = page.getByRole('switch', { name: 'First code in use', exact: true }).locator('xpath=ancestor::div[contains(@class,"row-hover")]');
  await expect(row.getByRole('status')).toHaveText('Copying request…');
  await page.getByRole('button', { name: 'More actions for First code', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Copy request', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__merchantClipboard.pending.shift()?.reject());
  await expect(row.getByRole('alert')).toHaveText('The request could not be copied. Try again.');
  await page.clock.install();
  await page.clock.fastForward(5000);
  await expect(row.getByRole('alert')).toBeVisible();
  await row.getByRole('button', { name: 'Retry copy', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(row.getByRole('button', { name: 'More actions for First code', exact: true })).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__merchantClipboard.writes)).toBe(2);
  await page.evaluate(() => window.__merchantClipboard.pending.shift()?.resolve());
  await expect(row.getByRole('status')).toHaveCount(0);
  await expect(row.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.app-safe-toast')).toContainText('Payment request copied.');
  await expect(row.getByRole('button', { name: 'More actions for First code', exact: true })).toBeFocused();
});

test('copy retry without focus ownership cannot steal focus from another row', async ({ page }) => {
  await prepare(page, true);
  await copyCode(page);
  await settleClipboard(page, 'reject');
  const other = page.getByRole('switch', { name: 'Second code in use', exact: true });
  await other.focus();
  await page.getByRole('button', { name: 'Retry copy', exact: true }).evaluate(node => {
    (node as HTMLButtonElement).click();
    (node as HTMLButtonElement).click();
  });
  await expect.poll(() => page.evaluate(() => window.__merchantClipboard.writes)).toBe(2);
  await expect(other).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await settleClipboard(page, 'resolve');
  await expect(page.locator('.app-safe-toast')).toContainText('Payment request copied.');
  await expect(other).toBeFocused();
});

test('contact encryption completing after lock cannot write or republish into a fresh wallet session', async ({ page }) => {
  await prepare(page);
  const dialog = await openCustomer(page);
  const writes = Number(await page.getByTestId('feedback-contacts').textContent());
  await control(page, 'Hold contact encryption');
  await dialog.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByTestId('feedback-stage')).toHaveText('contact-encryption');
  await control(page, 'Lock feedback wallet');
  await expect(page.getByTestId('feedback-phase')).toHaveText('locked');
  await control(page, 'Unlock feedback wallet');
  await expect(page.getByTestId('feedback-phase')).toHaveText('unlocked');
  await expect(page.getByTestId('feedback-ready')).toHaveText('true');
  await control(page, 'Deliver feedback response');
  await expect(page.getByTestId('feedback-deliveries')).toHaveText('1');
  // The gate releases an already completed SubtleCrypto encryption. Everything
  // after it in this single save is base64/JSON, synchronous localStorage, and
  // promise continuations; the next paint follows that microtask chain. The
  // storage/queue tests separately await the actual production promises.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByTestId('feedback-contacts')).toHaveText(String(writes));
  await expect(page.getByTestId('feedback-contact-count')).toHaveText('0');
  await expect(page.locator('.app-safe-toast')).toBeEmpty();
});

for (const action of ['save', 'remove', 'favorite']) {
  test(`contact provider ${action} preserves a completed commit without publishing after lock`, async ({ page }) => {
    await prepare(page);
    await control(page, 'Seed provider contacts');
    await expect(page.getByTestId('feedback-provider-settled')).toHaveText('1');
    await expect(page.getByTestId('feedback-contact-count')).toHaveText('2');
    const writes = Number(await page.getByTestId('feedback-contacts').textContent());
    await control(page, 'Revoke after contact commit');
    await control(page, `Run provider contact ${action}`);
    await expect(page.getByTestId('feedback-provider-settled')).toHaveText('2');
    await expect(page.getByTestId('feedback-phase')).toHaveText('locked');
    await expect(page.getByTestId('feedback-contact-count')).toHaveText('0');
    await expect(page.getByTestId('feedback-contacts')).toHaveText(String(writes + 1));
    await control(page, 'Unlock feedback wallet');
    await expect(page.getByTestId('feedback-phase')).toHaveText('unlocked');
    await expect(page.getByTestId('feedback-contact-count')).toHaveText(action === 'remove' ? '1' : '2');
  });
}

test('customer note failures persist beside retained drafts and retry once while other actions stay usable', async ({ page }) => {
  await prepare(page);
  const dialog = await openCustomer(page);
  await dialog.getByLabel('Note', { exact: true }).fill('Synthetic draft');
  await control(page, 'Hold before merchant write');
  const writes = Number(await page.getByTestId('feedback-writes').textContent());
  const save = dialog.getByRole('button', { name: 'Save note', exact: true });
  await save.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect(page.getByTestId('feedback-stage')).toHaveText('before-write');
  await expect(save).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Start a card', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Update', exact: true })).toBeEnabled();
  await control(page, 'Reject feedback response');
  await expect(dialog.getByRole('alert')).toHaveText('The note could not be saved. Try again.');
  await expect(page.getByTestId('feedback-writes')).toHaveText(String(writes + 1));
  await page.clock.install();
  await page.clock.fastForward(5000);
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect.poll(() => dialog.getByLabel('Note', { exact: true }).evaluate(node => (node as HTMLTextAreaElement).value === 'Synthetic draft')).toBe(true);
  await save.focus();
  await page.keyboard.press('Enter');
  await expect(save).toBeDisabled();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.app-safe-toast')).toContainText('Customer note saved on this device.');
  await expect(page.getByTestId('feedback-writes')).toHaveText(String(writes + 2));
});

test('customer contact validation and storage failures stay local with an explicit safe retry', async ({ page }) => {
  await prepare(page);
  const writes = Number(await page.getByTestId('feedback-contacts').textContent());
  const dialog = await openCustomer(page);
  const save = dialog.getByRole('button', { name: 'Update', exact: true });
  // A saved contact name changes the dialog's accessible name, not its owner.
  await dialog.evaluate(node => { (node as HTMLElement).dataset.contactDialogOwner = 'retained'; });
  await save.evaluate(node => { (node as HTMLElement).dataset.contactSaveOwner = 'retained'; });
  await dialog.getByRole('textbox', { name: 'Contact name', exact: true }).fill('');
  await save.click();
  await expect(dialog.getByRole('alert')).toHaveText('Enter a name before saving this address to Contacts.');
  await dialog.getByRole('textbox', { name: 'Contact name', exact: true }).fill('Synthetic contact');
  await control(page, 'Hold contact encryption');
  await control(page, 'Fail next contact write');
  await save.focus();
  await save.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect(page.getByTestId('feedback-stage')).toHaveText('contact-encryption');
  await expect(save).toBeDisabled();
  await expect(save).toBeFocused();
  await control(page, 'Deliver feedback response');
  await expect(dialog.getByRole('alert')).toHaveText('The contact could not be saved. Try again.');
  await expect(save).toBeFocused();
  await expect(page.getByTestId('feedback-contacts')).toHaveText(String(writes + 1));
  await expect.poll(() => dialog.getByRole('textbox', { name: 'Contact name', exact: true }).evaluate(node => (node as HTMLInputElement).value === 'Synthetic contact')).toBe(true);
  await page.keyboard.press('Space');
  await expect(page.locator('.app-safe-toast')).toContainText('Contact saved.');
  const updatedDialog = page.getByRole('dialog', { name: 'Synthetic contact', exact: true });
  await expect(updatedDialog).toHaveCount(1);
  await expect(updatedDialog).toBeVisible();
  await expect(updatedDialog).toHaveAttribute('data-contact-dialog-owner', 'retained');
  const updatedSave = updatedDialog.getByRole('button', { name: 'Update', exact: true });
  await expect(updatedSave).toHaveAttribute('data-contact-save-owner', 'retained');
  await expect(updatedSave).toBeFocused();
  await expect(updatedDialog.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('feedback-contacts')).toHaveText(String(writes + 2));
});

test('customer loyalty and forget failures are recoverable and a successful forget removes the real detail', async ({ page }) => {
  await prepare(page);
  const dialog = await openCustomer(page);
  await control(page, 'Hold before merchant write');
  const start = dialog.getByRole('button', { name: 'Start a card', exact: true });
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('feedback-stage')).toHaveText('before-write');
  await expect(start).toBeFocused();
  await control(page, 'Reject feedback response');
  await expect(dialog.getByRole('alert')).toHaveText('The loyalty card could not be opened. Try again.');
  await expect(start).toBeFocused();
  await page.keyboard.press('Space');
  await expect(dialog.getByRole('heading', { name: 'Loyalty card', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Loyalty card', exact: true })).toBeFocused();
  await expect(page.getByTestId('feedback-events')).toHaveText('1');
  await dialog.getByRole('button', { name: 'Forget This Customer', exact: true }).click();
  await control(page, 'Hold before merchant write');
  const forget = dialog.getByRole('button', { name: 'Forget', exact: true });
  await forget.focus();
  await forget.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect(page.getByTestId('feedback-stage')).toHaveText('before-write');
  await expect(forget).toBeDisabled();
  await expect(forget).toBeFocused();
  await control(page, 'Reject feedback response');
  await expect(dialog.getByRole('alert')).toHaveText('The customer could not be forgotten. Try again.');
  await expect(forget).toBeFocused();
  await forget.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('feedback-customer-count')).toHaveText('1');
  await expect(page.locator('.app-safe-toast')).not.toContainText('could not');
});

for (const departure of ['moved focus', 'closed detail', 'revoked reset'] as const) {
  test(`a completed loyalty card does not steal focus after ${departure}`, async ({ page }) => {
    await prepare(page);
    let dialog = await openCustomer(page);
    await control(page, 'Hold after merchant write');
    await dialog.getByRole('button', { name: 'Start a card', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('feedback-stage')).toHaveText('after-write');
    if (departure === 'closed detail') {
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      dialog = await openCustomer(page, true);
    } else if (departure === 'revoked reset') {
      await control(page, 'Fail feedback erase');
      await control(page, 'Reset feedback merchant');
      await expect(page.getByTestId('feedback-authorization')).toHaveText('waiting');
      await control(page, 'Authorize feedback reset');
      await expect(page.getByTestId('feedback-resets')).toHaveText('1');
    }
    const note = dialog.getByLabel('Note', { exact: true });
    await note.focus();
    await control(page, 'Deliver feedback response');
    await expect(page.getByTestId('feedback-deliveries')).toHaveText('1');
    if (departure === 'moved focus') {
      await expect(page.locator('.app-safe-toast')).toContainText('Loyalty card opened.');
    } else {
      await expect(page.locator('.app-safe-toast')).toBeEmpty();
    }
    await expect(note).toBeFocused();
    await expect(dialog).toBeVisible();
  });
}

test('customer reward failure retains the full card and retries one redemption', async ({ page }) => {
  await prepare(page);
  const dialog = await openCustomer(page, true);
  await control(page, 'Hold before merchant write');
  const redeem = dialog.getByRole('button', { name: 'Redeem', exact: true });
  await redeem.focus();
  await redeem.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect(page.getByTestId('feedback-stage')).toHaveText('before-write');
  await expect(redeem).toBeDisabled();
  await expect(redeem).toBeFocused();
  await control(page, 'Reject feedback response');
  await expect(dialog.getByRole('alert')).toHaveText('The reward could not be redeemed. Try again.');
  await expect(redeem).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('feedback-events')).toHaveText('1');
  await expect(page.locator('.app-safe-toast')).toContainText('Reward redeemed');
  await expect(redeem).toBeFocused();
});

test('supplementary toasts announce only additions, retain nodes, wrap and expire without moving focus', async ({ page }) => {
  const region = page.locator('.app-safe-toast');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await expect(region).toHaveAttribute('aria-atomic', 'false');
  await expect(region).toHaveAttribute('aria-relevant', 'additions');
  await expect(region.locator(':scope > div')).toHaveCount(0);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole('button', { name: 'First toast', exact: true }).focus();
  await page.keyboard.press('Enter');
  await region.locator(':scope > div').evaluate(node => { (node as HTMLElement).dataset.retainedToast = 'true'; });
  await page.getByRole('button', { name: 'Second toast', exact: true }).click();
  await expect(region.locator('[data-retained-toast]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Long toast', exact: true }).click();
  await expect(region.locator(':scope > div')).toHaveCount(3);
  await expect.poll(() => region.locator('p').last().evaluate(node => {
    const style = getComputedStyle(node);
    return style.whiteSpace !== 'nowrap' && node.scrollWidth <= node.clientWidth + 1;
  })).toBe(true);
  await page.getByRole('button', { name: 'Fourth toast', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(region.locator(':scope > div')).toHaveCount(3);
  await expect(region.locator('[data-retained-toast]')).toHaveCount(0);
  await page.clock.fastForward(4199);
  await expect(region.locator(':scope > div')).toHaveCount(3);
  await page.clock.fastForward(1);
  await expect(region.locator(':scope > div')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fourth toast', exact: true })).toBeFocused();
});
