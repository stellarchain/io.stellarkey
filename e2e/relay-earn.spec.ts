import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.skip(!process.env.PRIVATE_COMPONENT_FIXTURE_SHA256, 'Use the isolated synthetic component runner.');

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === origin.replace(/^http/, 'ws')) socket.connectToServer();
    else socket.close();
  });
  await page.goto('/private-component-fixture');
});

const dialogFor = (page: Page) => page.getByRole('dialog', { name: 'Earn by Relaying', exact: true });
async function openEarn(page: Page) {
  await page.getByRole('button', { name: /Earn by Relaying/ }).click();
  const dialog = dialogFor(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-modal-shell]')).toBeFocused();
  return dialog;
}

async function preference(page: Page, key: 'helpRelay' | 'useRelay') {
  return page.evaluate(key => JSON.parse(localStorage.getItem('stellarkey.private-relay.preferences.v1') ?? '{}')[key] === true, key);
}

async function observeShell(page: Page) {
  await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('[data-modal-shell]')!;
    const backdrop = document.querySelector<HTMLElement>('[data-modal-backdrop]')!;
    const surface = document.querySelector<HTMLElement>('[data-app-surface]')!;
    shell.dataset.earnIdentity = 'original';
    backdrop.dataset.earnIdentity = 'original';
    const audit = { removals: 0, unlocks: 0, closes: 0, entranceRestarts: 0, observer: null as MutationObserver | null };
    audit.observer = new MutationObserver(records => {
      for (const record of records) {
        for (const removed of record.removedNodes) {
          if (removed === shell || removed === backdrop || removed.contains(shell) || removed.contains(backdrop)) audit.removals++;
        }
        if (record.type === 'attributes' && record.target === document.body &&
            (!document.body.style.overflow.includes('hidden') || (record.oldValue !== null && !record.oldValue.includes('hidden')))) audit.unlocks++;
        if (record.type === 'attributes' && record.target === surface && (!surface.inert || record.oldValue === null)) audit.unlocks++;
        if (record.attributeName === 'data-overlay-state' && (backdrop.dataset.overlayState !== 'open' || record.oldValue !== 'open')) audit.closes++;
      }
    });
    audit.observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true,
      attributeFilter: ['style', 'inert', 'data-overlay-state'] });
    for (const node of [shell, backdrop]) node.addEventListener('animationstart', event => {
      if (event.target === node) audit.entranceRestarts++;
    });
    Object.defineProperty(window, '__earnAudit', { value: audit, configurable: true });
  });
}

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`Earn has a focused fee-first design and stable start/stop control (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    const dialog = await openEarn(page);
    await expect(dialog.getByLabel('Your fee per payment', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Waku service node', { exact: true })).toBeHidden();
    await expect(dialog.getByRole('button', { name: /^Check available peers/ })).toHaveCount(0);
    await expect(dialog.getByText('Relay on your terms.', { exact: true })).toBeVisible();
    // Wait for existing entrance animations, not an arbitrary wall-clock sleep.
    await dialog.evaluate(async node => { await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
    await observeShell(page);
    for (let index = 0; index < 3; index++) {
      const start = dialog.getByRole('button', { name: 'Start Relaying', exact: true });
      await start.focus();
      await start.press('Enter');
      await expect.poll(() => preference(page, 'helpRelay')).toBe(true);
      // This UI-only fixture has no manager/socket: an inactive status must
      // not claim a network connection attempt. Startup has its own suite.
      await expect(dialog.getByText('Preparing wallet', { exact: true })).toBeVisible();
      const stop = dialog.getByRole('button', { name: 'Stop Relaying', exact: true });
      await expect(stop).toBeFocused();
      await stop.press('Enter');
      await expect.poll(() => preference(page, 'helpRelay')).toBe(false);
      await expect(start).toBeFocused();
    }
    await expect(dialog).toHaveAttribute('data-earn-identity', 'original');
    await expect(dialog.locator('[data-modal-shell]')).toHaveAttribute('data-earn-identity', 'original');
    await expect.poll(() => page.evaluate(() => {
      const audit = (window as typeof window & { __earnAudit: { removals: number; unlocks: number; closes: number; entranceRestarts: number } }).__earnAudit;
      return [audit.removals, audit.unlocks, audit.closes, audit.entranceRestarts];
    })).toEqual([0, 0, 0, 0]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Earn by Relaying/ })).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
    await expect(page.getByLabel('Your fee per payment')).toHaveCount(0);
  });
}

test('Earn keeps invalid fee edits recoverable and Stop independent of unfinished settings', async ({ page }) => {
  const dialog = await openEarn(page);
  const fee = dialog.getByLabel('Your fee per payment', { exact: true });
  await fee.fill('invalid');
  await dialog.getByRole('button', { name: 'Start Relaying', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Enter a fee');
  await expect(fee).toHaveValue('invalid');
  await expect.poll(() => preference(page, 'helpRelay')).toBe(false);
  await fee.fill('0.002');
  await dialog.getByRole('button', { name: 'Start Relaying', exact: true }).click();
  await expect.poll(() => preference(page, 'helpRelay')).toBe(true);
  await fee.fill('unfinished');
  await dialog.getByText('Relay connections', { exact: true }).click();
  await dialog.getByLabel('Waku service node', { exact: true }).fill('unfinished');
  await dialog.getByRole('button', { name: 'Stop Relaying', exact: true }).click();
  await expect.poll(() => preference(page, 'helpRelay')).toBe(false);
  await expect(fee).toHaveValue('unfinished');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

for (const external of [false, true]) test(`Earn retains Save focus when ${external ? 'external settings' : 'saving'} makes its draft clean`, async ({ page }) => {
  const dialog = await openEarn(page);
  await dialog.getByLabel('Your fee per payment', { exact: true }).fill('0.002');
  const save = dialog.getByRole('button', { name: 'Save Changes', exact: true });
  await save.focus();
  if (external) {
    await page.getByRole('button', { name: 'Change external relay settings', exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  } else {
    await save.press('Enter');
  }
  await expect(save).toBeFocused();
  await expect(save).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('earn-runtime-requested')).toHaveText('false');
});

test('Earn fee presets and saving do not request private runtime', async ({ page }) => {
  const dialog = await openEarn(page);
  await dialog.getByRole('group', { name: 'Quick amounts', exact: true }).getByRole('button', { name: '0.005', exact: true }).click();
  await expect(dialog.getByLabel('Your fee per payment', { exact: true })).toHaveValue('0.005');
  await expect(page.getByTestId('earn-runtime-requested')).toHaveText('false');
  await dialog.getByRole('button', { name: 'Save Changes', exact: true }).press('Enter');
  await expect(page.getByTestId('earn-runtime-requested')).toHaveText('false');
  await expect.poll(() => preference(page, 'helpRelay')).toBe(false);
});

for (const storageFailure of [false, true]) test(`Earn pinned feedback remains visible after ${storageFailure ? 'storage' : 'fee'} failure`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const dialog = await openEarn(page);
  await dialog.getByLabel('Your fee per payment', { exact: true }).fill(storageFailure ? '0.004' : 'invalid');
  await dialog.getByText('Relay connections', { exact: true }).click();
  await dialog.getByText('Explore other peers', { exact: true }).click();
  if (storageFailure) await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new Error('synthetic storage failure'); };
  });
  const start = dialog.getByRole('button', { name: 'Start Relaying', exact: true });
  await start.focus();
  await start.press('Enter');
  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText(storageFailure ? 'Could not save' : 'Enter a fee');
  await expect.poll(() => alert.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const bottom = top + (viewport?.height ?? innerHeight);
    const action = document.querySelector<HTMLElement>('[id$="-participation"]')!.getBoundingClientRect();
    const shellNode = node.closest<HTMLElement>('[data-modal-shell]')!;
    const shell = shellNode.getBoundingClientRect();
    const heading = shellNode.querySelector('h2')?.closest('.sticky')?.getBoundingClientRect();
    return !!heading && bounds.top >= Math.max(top, shell.top, heading.bottom) &&
      bounds.bottom <= action.top && action.bottom <= Math.min(bottom, shell.bottom);
  })).toBe(true);
  await expect(start).toBeFocused();
  await expect(page.getByTestId('earn-runtime-requested')).toHaveText('false');
});

test('Earn distinguishes actual connection state, saves in place, and preserves independent opt-ins', async ({ page }) => {
  const dialog = await openEarn(page);
  await page.getByRole('button', { name: 'Enable independent sender preference', exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  await dialog.getByRole('button', { name: 'Start Relaying', exact: true }).click();
  await expect.poll(() => preference(page, 'useRelay')).toBe(true);
  for (const [button, state] of [['Connect synthetic helper', 'Connected'], ['Reconnect synthetic helper', 'Reconnecting'], ['Disconnect synthetic helper', 'Unavailable']]) {
    await page.getByRole('button', { name: button, exact: true }).evaluate(node => (node as HTMLButtonElement).click());
    await expect(dialog.getByText(state, { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Waiting for the network connection/)).toHaveCount(0);
  }
  await dialog.getByLabel('Your fee per payment').fill('0.003');
  await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Changes saved' })).toBeVisible();
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Stop helper elsewhere', exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  await expect(dialog.getByRole('button', { name: 'Start Relaying', exact: true })).toBeVisible();
  await expect(dialog.getByRole('status').filter({ hasText: 'Changes saved' })).toHaveCount(0);
  await expect.poll(() => preference(page, 'useRelay')).toBe(true);
});

test('Earn rebases untouched external settings but preserves actual unfinished edits', async ({ page }) => {
  const dialog = await openEarn(page);
  const fee = dialog.getByLabel('Your fee per payment', { exact: true });
  await fee.fill('0.005');
  await page.getByRole('button', { name: 'Change external relay settings', exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  await expect(fee).toHaveValue('0.005');
  await dialog.getByText('Relay connections', { exact: true }).click();
  await expect(dialog.getByLabel('Waku service node', { exact: true })).toHaveValue('/dns4/node-one.example/tcp/8000/wss/p2p/16Uiu2HAkykgaECHswi3YKJ5dMLbq2kPVCo89fcyTd38UcQD6ej5W');
  await dialog.getByRole('button', { name: 'Start Relaying', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem('stellarkey.private-relay.preferences.v1')!);
    return prefs.wakuPeers[0] === '/dns4/node-one.example/tcp/8000/wss/p2p/16Uiu2HAkykgaECHswi3YKJ5dMLbq2kPVCo89fcyTd38UcQD6ej5W' && prefs.feeAtomic === '50000';
  })).toBe(true);
});

test('advanced relay settings preserve independent opt-ins, validation and local save feedback', async ({ page }) => {
  await page.getByRole('button', { name: 'Open advanced relay settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic advanced relay settings', exact: true });
  await page.getByRole('button', { name: 'Enable independent sender preference', exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  await expect(dialog.getByRole('switch', { name: /Prefer privacy relay/ })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('switch', { name: /Help relay private payments/ }).click();
  await dialog.getByLabel('Private Fee', { exact: true }).fill('invalid');
  await dialog.getByRole('button', { name: 'Save relay settings', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Enter a fee');
  await expect(page.getByTestId('earn-runtime-requested')).toHaveText('false');
  await dialog.getByLabel('Private Fee', { exact: true }).fill('0.006');
  await dialog.getByRole('button', { name: 'Save relay settings', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Changes saved');
  await expect.poll(() => preference(page, 'useRelay')).toBe(true);
  await expect.poll(() => preference(page, 'helpRelay')).toBe(true);
  await expect(page.getByTestId('earn-runtime-requested')).toHaveText('true');
});

test('advanced sender-only changes do not resume saved helper participation', async ({ page }) => {
  await page.getByRole('button', { name: 'Restore saved helper preference', exact: true }).click();
  await page.getByRole('button', { name: 'Open advanced relay settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic advanced relay settings', exact: true });
  await dialog.getByRole('switch', { name: /Prefer privacy relay/ }).click();
  await dialog.getByRole('button', { name: 'Save relay settings', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Changes saved');
  await expect(page.getByTestId('earn-runtime-requested')).toHaveText('false');
  await expect.poll(() => preference(page, 'helpRelay')).toBe(true);
});

test('Earn clears its content on close without collapsing exit geometry', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const dialog = await openEarn(page);
  const result = await dialog.evaluate(node => {
    const shell = node.querySelector<HTMLElement>('[data-modal-shell]')!;
    const before = shell.clientHeight;
    return new Promise<{ stable: boolean; cleared: boolean }>(resolve => {
      const observer = new MutationObserver(() => {
        if (node.getAttribute('data-overlay-state') !== 'closing') return;
        observer.disconnect();
        resolve({ stable: Math.abs(shell.clientHeight - before) <= 1, cleared: !node.querySelector('input') });
      });
      observer.observe(node, { attributes: true, subtree: true, childList: true });
      (node.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
    });
  });
  expect(result).toEqual({ stable: true, cleared: true });
  await expect(dialog).toHaveCount(0);
});

test('Earn storage failures are safe, inline and retryable without losing edits', async ({ page }) => {
  const dialog = await openEarn(page);
  await dialog.getByLabel('Your fee per payment').fill('0.004');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, '__restoreEarnStorage', { value: () => { Storage.prototype.setItem = original; } });
    Storage.prototype.setItem = () => { throw new Error('synthetic-sensitive-error-must-not-render'); };
  });
  await dialog.getByRole('button', { name: 'Start Relaying', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not save');
  await expect(dialog.getByRole('alert')).not.toContainText('synthetic-sensitive-error');
  await expect(dialog.getByLabel('Your fee per payment')).toHaveValue('0.004');
  await page.evaluate(() => (window as typeof window & { __restoreEarnStorage(): void }).__restoreEarnStorage());
  await dialog.getByRole('button', { name: 'Start Relaying', exact: true }).click();
  await expect.poll(() => preference(page, 'helpRelay')).toBe(true);
});

test('Earn disclosure, keyboard focus, narrow layout and accessibility remain usable', async ({ page, browserName }) => {
  const dialog = await openEarn(page);
  await expect(dialog.getByText(/automatically signs encrypted account-possession offers/i)).toBeVisible();
  await expect(dialog.getByText(/network fees in XLM/i)).toBeVisible();
  await expect(dialog.getByText(/your account is public/i)).toBeVisible();
  const connections = dialog.getByText('Relay connections', { exact: true });
  await connections.focus();
  await connections.press('Enter');
  await expect(dialog.getByLabel('Waku service node', { exact: true })).toBeVisible();
  await connections.press('Enter');
  await expect(dialog.getByLabel('Waku service node', { exact: true })).toBeHidden();
  const peers = dialog.getByText('Explore other peers', { exact: true });
  await peers.focus();
  await peers.press('Enter');
  await expect(dialog.getByRole('button', { name: /^Check available peers/ })).toBeVisible();
  await peers.press('Enter');
  await expect(dialog.getByRole('button', { name: /^Check available peers/ })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 740 });
  await expect.poll(() => dialog.locator('[data-modal-shell]').evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return node.scrollWidth <= node.clientWidth + 1 && bounds.left >= 0 && bounds.right <= innerWidth;
  })).toBe(true);
  await expect.poll(() => dialog.getByLabel('Your fee per payment').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  for (let index = 0; index < 10; index++) {
    await page.keyboard.press('Tab');
    await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  let scan = new AxeBuilder({ page }).include('[data-modal-backdrop]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
  if (browserName === 'webkit') scan = scan.disableRules(['color-contrast']);
  const results = await scan.analyze();
  expect(results.violations.map(result => ({ id: result.id, impact: result.impact, count: result.nodes.length }))).toEqual([]);
});

test('Earn lab acknowledgement and structural layout budgets', async ({ page, browserName }) => {
  // Lab proxy only: synthetic state, owned local server, no private values in
  // measurements. A task posted from rAF includes the acknowledgement's
  // rendering opportunity without charging a later, unrelated frame interval.
  // https://codelabs.developers.google.com/understanding-inp#13
  // Establish hydration with a real interaction before timing warm local
  // state changes. A synthetic click on pre-hydration HTML has no handler.
  const warmup = await openEarn(page);
  await warmup.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(warmup).toHaveCount(0);
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  const opening: number[] = [];
  const acknowledgement: number[] = [];
  for (let run = 0; run < 5; run++) {
    opening.push(await page.evaluate(() => new Promise<number>(resolve => {
      const started = performance.now();
      const observer = new MutationObserver(() => {
        if (!document.querySelector('[data-modal-shell]')) return;
        observer.disconnect();
        requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - started), 0));
      });
      observer.observe(document.body, { childList: true, subtree: true });
      (document.querySelector('section[aria-label="Synthetic earn checks"] button[aria-haspopup="dialog"]') as HTMLButtonElement).click();
    })));
    const dialog = dialogFor(page);
    await expect(dialog.locator('[data-modal-shell]')).toBeFocused();
    acknowledgement.push(await dialog.getByRole('button', { name: 'Start Relaying', exact: true }).evaluate(node => new Promise<number>(resolve => {
      const started = performance.now();
      const observer = new MutationObserver(() => {
        if (!node.textContent?.includes('Stop Relaying')) return;
        observer.disconnect();
        requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - started), 0));
      });
      observer.observe(node, { childList: true, subtree: true, characterData: true });
      (node as HTMLButtonElement).click();
    })));
    await dialog.getByRole('button', { name: 'Stop Relaying', exact: true }).click();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  const summarize = (samples: number[]) => ({ medianMs: Math.round([...samples].sort((a, b) => a - b)[2]), slowestMs: Math.round(Math.max(...samples)) });
  console.log(JSON.stringify({ profile: browserName === 'chromium' ? 'desktop-4x-CPU-local' : 'iphone-webkit-local', samples: 5,
    modalPaintProxy: summarize(opening), startFeedbackPaintProxy: summarize(acknowledgement) }));
  expect(Math.max(...acknowledgement)).toBeLessThanOrEqual(100);
  const dialog = await openEarn(page);
  const geometry = await dialog.evaluate(node => {
    const shell = node.querySelector<HTMLElement>('[data-modal-shell]')!;
    const input = node.querySelector<HTMLInputElement>('input')!;
    const primary = Array.from(node.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Start Relaying')!;
    return { viewportHeight: innerHeight, shellHeight: shell.clientHeight, contentHeight: shell.scrollHeight,
      feeTypePx: parseFloat(getComputedStyle(input).fontSize), primaryTargetHeight: Math.round(primary.getBoundingClientRect().height),
      scrollToActionPx: Math.max(0, Math.round(primary.getBoundingClientRect().bottom - shell.getBoundingClientRect().bottom)),
      noHorizontalOverflow: shell.scrollWidth <= shell.clientWidth + 1 };
  });
  console.log(JSON.stringify({ profile: browserName, earnGeometry: geometry }));
  expect(geometry.noHorizontalOverflow).toBe(true);
  expect(geometry.feeTypePx).toBeGreaterThanOrEqual(20);
  expect(geometry.primaryTargetHeight).toBeGreaterThanOrEqual(browserName === 'chromium' ? 40 : 44);
});
