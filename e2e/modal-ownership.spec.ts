import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';

const test = base.extend<{ mnemonicWallet: boolean }>({ mnemonicWallet: [false, { option: true }] });

declare global {
  interface Window {
    __modalObservation?: { removed: number; scrollUnlocks: number; inertInterruptions: number; closing: number; stop(): void };
  }
}

test.skip(!process.env.PRIVATE_COMPONENT_FIXTURE_SHA256, 'Use the isolated synthetic component runner.');

test.beforeEach(async ({ page, baseURL, mnemonicWallet }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === origin.replace(/^http/, 'ws')) socket.connectToServer();
    else socket.close();
  });
  await page.addInitScript(() => { Object.defineProperty(window, 'EventSource', { value: undefined, configurable: true }); });
  await page.goto('/private-component-fixture');
  await page.getByRole('button', { name: 'Test modal ownership', exact: true }).click();
  if (mnemonicWallet) await page.getByRole('button', { name: 'Use recovery phrase setup', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare modal checks', exact: true }).click();
  await expect(page.getByTestId('modal-ready')).toHaveText('true');
});

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  await page.evaluate(() => window.__modalObservation?.stop());
  const dispose = page.getByRole('button', { name: 'Dispose modal checks', exact: true });
  if (await dispose.count()) {
    await dispose.evaluate(element => (element as HTMLButtonElement).click());
    await expect(page.getByRole('button', { name: 'Test modal ownership', exact: true })).toBeVisible();
  }
});

async function deliver(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).evaluate(element => (element as HTMLButtonElement).click());
}

async function markShell(page: Page) {
  await page.evaluate(async () => {
    window.__modalObservation?.stop();
    const shell = document.querySelector<HTMLElement>('[data-modal-shell]')!;
    const backdrop = document.querySelector<HTMLElement>('[data-modal-backdrop]')!;
    const entrance = [...shell.getAnimations(), ...backdrop.getAnimations()];
    await Promise.all(entrance.map(animation => animation.finished.catch(() => {})));
    const completedEntrance = new Map(entrance.filter(animation => animation.playState === 'finished' && !animation.pending)
      .map(animation => [animation, { startTime: animation.startTime, currentTime: animation.currentTime, playbackRate: animation.playbackRate }]));
    const isUnchangedCompletedEntrance = (animation: Animation) => {
      const baseline = completedEntrance.get(animation);
      return !!baseline && animation.playState === 'finished' && !animation.pending
        && animation.startTime === baseline.startTime && animation.currentTime === baseline.currentTime
        && animation.playbackRate === baseline.playbackRate;
    };
    shell.dataset.syntheticIdentity = 'retained';
    backdrop.dataset.syntheticIdentity = 'retained';
    if (document.activeElement instanceof HTMLElement) document.activeElement.dataset.syntheticFocus = 'retained';
    const stopAnimationObservers = [shell, backdrop].map(element => {
      element.dataset.syntheticAnimations = '0';
      const onStart = (event: AnimationEvent) => {
        if (event.target !== element) return;
        // Chromium can deliver the original animationstart after finished has
        // resolved. Ignore only that unchanged completed playback, not a new
        // animation or a restart of the same Animation object.
        const current = element.getAnimations();
        if (current.length > 0 && current.every(isUnchangedCompletedEntrance)) return;
        element.dataset.syntheticAnimations = String(Number(element.dataset.syntheticAnimations) + 1);
      };
      element.addEventListener('animationstart', onStart);
      return () => element.removeEventListener('animationstart', onStart);
    });
    const app = document.querySelector<HTMLElement>('[data-app-surface]');
    const scrollOwner = document.querySelector<HTMLElement>('[data-app-scroll-owner]');
    const state = { removed: 0, scrollUnlocks: 0, inertInterruptions: 0, closing: 0, stop: () => {} };
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.attributeName === 'style' && (record.target === document.body || record.target === scrollOwner)
          && !/overflow:\s*hidden/.test(record.oldValue ?? '')) state.scrollUnlocks++;
        if (record.target === app && record.attributeName === 'inert' && record.oldValue === null) state.inertInterruptions++;
        if (record.target === backdrop && record.attributeName === 'data-overlay-state' && backdrop.dataset.overlayState !== 'open') state.closing++;
      }
      if (document.body.style.overflow !== 'hidden' || scrollOwner?.style.overflow !== 'hidden') state.scrollUnlocks++;
      if (app && !app.inert) state.inertInterruptions++;
      if (!shell.isConnected || !backdrop.isConnected) { state.removed++; state.stop(); }
    });
    state.stop = () => { observer.disconnect(); stopAnimationObservers.forEach(stop => stop()); state.stop = () => {}; };
    window.__modalObservation = state;
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['style', 'inert', 'data-overlay-state'] });
  });
}

async function stableShell(page: Page, preserveFocus = false) {
  await expect.poll(() => page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('[data-modal-shell]');
    const backdrop = document.querySelector<HTMLElement>('[data-modal-backdrop]');
    const bounds = shell?.getBoundingClientRect();
    return { shell: shell?.dataset.syntheticIdentity, backdrop: backdrop?.dataset.syntheticIdentity,
      shellAnimations: shell?.dataset.syntheticAnimations, backdropAnimations: backdrop?.dataset.syntheticAnimations,
      removed: window.__modalObservation?.removed, scrollUnlocks: window.__modalObservation?.scrollUnlocks,
      inertInterruptions: window.__modalObservation?.inertInterruptions, closing: window.__modalObservation?.closing,
      bodyLocked: document.body.style.overflow === 'hidden', ownerLocked: document.querySelector<HTMLElement>('[data-app-scroll-owner]')?.style.overflow === 'hidden',
      focused: !!backdrop?.contains(document.activeElement), inert: !!document.querySelector('main')?.closest('[inert]'),
      contained: !!bounds && bounds.left >= -1 && bounds.right <= innerWidth + 1 };
  })).toEqual({ shell: 'retained', backdrop: 'retained', shellAnimations: '0', backdropAnimations: '0', removed: 0, scrollUnlocks: 0, inertInterruptions: 0, closing: 0, bodyLocked: true, ownerLocked: true, focused: true, inert: true, contained: true });
  if (preserveFocus) await expect.poll(() => page.evaluate(() => document.activeElement instanceof HTMLElement
    && document.activeElement.dataset.syntheticFocus === 'retained')).toBe(true);
}

async function outsidePointer(page: Page) {
  // This point must hit the backdrop itself on both desktop and iPhone, not
  // just dispatch a handler event through an element covered by the panel.
  await expect.poll(() => page.evaluate(() => document.elementFromPoint(2, 2) === document.querySelector('[data-modal-backdrop]'))).toBe(true);
  await page.mouse.click(2, 2);
}

async function closed(page: Page, opener: string) {
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow !== 'hidden'
    && document.querySelector<HTMLElement>('[data-app-scroll-owner]')?.style.overflow !== 'hidden'
    && !document.querySelector('main')?.closest('[inert]'))).toBe(true);
  await expect(page.getByRole('button', { name: opener, exact: true })).toBeFocused();
}

async function startImport(page: Page) {
  await deliver(page, 'Hold next encryption');
  // The dialog body loads lazily behind its static shell; the imperative fill needs the field present.
  await expect(page.getByPlaceholder('S...')).toBeVisible();
  await deliver(page, 'Fill synthetic import');
  await page.getByRole('button', { name: 'Import Account', exact: true }).click();
  await expect(page.getByTestId('modal-stage')).toHaveText('encryption');
  await page.keyboard.press('Tab');
}

async function startClaim(page: Page, response: string) {
  await deliver(page, `Use ${response} response`);
  await page.getByRole('button', { name: 'Open claim modal', exact: true }).click();
  await page.getByRole('button', { name: 'Select all available', exact: true }).click();
  await deliver(page, 'Hold submission');
  await page.getByRole('button', { name: 'Claim selected (1)', exact: true }).click();
  await expect(page.getByTestId('modal-stage')).toHaveText('submission');
}

async function openEntranceObserverControl(page: Page) {
  await page.getByRole('button', { name: 'Open account modal', exact: true }).click();
  await expect(page.locator('[data-modal-shell]').last()).toBeFocused();
  const counts = await page.evaluate(() => [
    ['[data-modal-shell]', 'dialogIn var(--motion-duration-emphasized) var(--motion-ease-enter) both'],
    ['[data-modal-backdrop]', 'overlayIn var(--motion-duration-standard) var(--motion-ease-standard) both'],
  ].map(([selector, entrance]) => {
    const element = document.querySelector<HTMLElement>(selector)!;
    // Deliberate observer fault injection: enable the real entrance keyframes
    // even under reduced motion. Ordinary reduced-motion cases remain untouched.
    element.style.setProperty('animation', entrance, 'important');
    return element.getAnimations().filter(animation => animation instanceof CSSAnimation).length;
  }));
  expect(counts).toEqual([1, 1]);
  await markShell(page);
}

test('synthetic modal fixture loads the actual claim review and account form', async ({ page }) => {
  await page.getByRole('button', { name: 'Open claim modal', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Open account modal', exact: true }).click();
  await expect(page.getByLabel('Secret Key', { exact: true })).toBeVisible();
});

for (const lateLayout of [false, true]) test(`integration safety: closing a revealed import removes the field before the shell exits${lateLayout ? ' after same-task layout growth' : ''}`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Open account modal', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Account', exact: true });
  await expect(dialog.getByLabel('Secret Key', { exact: true })).toBeVisible();
  await deliver(page, 'Fill synthetic import');
  await dialog.getByRole('button', { name: 'Show secret key', exact: true }).click();
  await expect(dialog.getByLabel('Secret Key', { exact: true })).toHaveAttribute('type', 'text');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Discard changes?', exact: true });
  const result = await discard.getByRole('button', { name: 'Discard', exact: true }).evaluate(async (node, lateLayout) => {
    const owner = document.querySelector<HTMLElement>('[data-modal-backdrop]')!;
    const shell = owner.querySelector<HTMLElement>('[data-modal-shell]')!;
    // Simulate layout settling just before close, before ResizeObserver can
    // publish. Change only synthetic field geometry, never read its contents.
    if (lateLayout) shell.querySelector<HTMLInputElement>('input')!.style.height = '180px';
    const height = shell.offsetHeight;
    const state = () => ({
      closing: owner.dataset.overlayState === 'closing',
      fieldRemoved: !owner.querySelector('input'),
      connected: shell.isConnected,
      heldStyleCurrent: parseFloat(shell.style.height) >= height - 1,
      geometryHeld: shell.offsetHeight >= height - 1,
    });
    // Observe the close commit before timers can unmount the shell. On a slow
    // WebKit frame, the next RAF can arrive after the entire exit has finished.
    const committed = new Promise<ReturnType<typeof state>>(resolve => {
      const observer = new MutationObserver(() => {
        if (owner.dataset.overlayState !== 'closing') return;
        observer.disconnect();
        resolve(state());
      });
      observer.observe(owner, { attributes: true, attributeFilter: ['data-overlay-state'] });
    });
    (node as HTMLButtonElement).click();
    return committed;
  }, lateLayout);
  expect(result.closing).toBe(true);
  expect(result.fieldRemoved).toBe(true);
  expect(result.connected).toBe(true);
  expect(result.heldStyleCurrent).toBe(true);
  expect(result.geometryHeld).toBe(true);
  await closed(page, 'Open account modal');
});

for (const motion of ['reduce', 'no-preference'] as const) {
  test.describe(`modal ownership with ${motion} motion`, () => {
    test.use({ contextOptions: { reducedMotion: motion } });

    test.beforeEach(async ({ page }) => {
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(motion === 'reduce');
    });

    test('entrance observer ignores late events from the completed baseline', async ({ page }) => {
      await openEntranceObserverControl(page);
      const completed = await page.evaluate(() => {
        const elements = [document.querySelector<HTMLElement>('[data-modal-shell]')!, document.querySelector<HTMLElement>('[data-modal-backdrop]')!];
        const completed = elements.every(element => {
          const entrances = element.getAnimations().filter(animation => animation instanceof CSSAnimation);
          return entrances.length === 1 && entrances.every(animation => animation.playState === 'finished' && !animation.pending);
        });
        for (const element of elements) {
          const animation = element.getAnimations().find(animation => animation instanceof CSSAnimation)!;
          // Reproduce the observed delivery boundary without replaying motion.
          element.dispatchEvent(new AnimationEvent('animationstart', { animationName: animation.animationName, elapsedTime: 0, bubbles: true }));
        }
        return completed;
      });
      expect(completed).toBe(true);
      await stableShell(page, true);
    });

    for (const replay of ['replacement', 'original object'] as const) {
      test(`entrance observer detects real ${replay} replay on shell and backdrop`, async ({ page }) => {
        await openEntranceObserverControl(page);
        await stableShell(page, true);
        for (const selector of ['[data-modal-shell]', '[data-modal-backdrop]']) {
          const element = page.locator(selector);
          const result = await element.evaluate(async (node, replay) => {
            const element = node as HTMLElement;
            const original = element.getAnimations().find(animation => animation instanceof CSSAnimation)!;
            await original.ready;
            const originalStart = original.startTime;
            element.addEventListener('animationstart', event => {
              if (event.target === element) element.dataset.syntheticReplayTrusted = String(event.isTrusted);
            }, { once: true });
            let animation = original;
            if (replay === 'replacement') {
              const entrance = element.style.getPropertyValue('animation');
              element.style.setProperty('animation', 'none', 'important');
              element.getAnimations(); // Commit removal before restoring the real entrance.
              element.style.setProperty('animation', entrance, 'important');
              animation = element.getAnimations().find(animation => animation instanceof CSSAnimation)!;
            } else {
              // Sample the real CSS animation back in its active phase before
              // replaying. Slow WebKit frames can otherwise coalesce after ->
              // active -> after and never emit a new animationstart event.
              original.pause();
              await original.ready;
              original.currentTime = 0;
              await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
              original.play();
            }
            // A replay's play task must settle before observing its completion.
            await animation.ready;
            await animation.finished;
            return { sameObject: animation === original, completed: animation.playState === 'finished',
              originalStartDefined: typeof originalStart === 'number',
              playbackChanged: animation !== original || animation.startTime !== originalStart };
          }, replay);
          expect(result.sameObject).toBe(replay === 'original object');
          expect(result.completed).toBe(true);
          expect(result.originalStartDefined).toBe(true);
          expect(result.playbackChanged).toBe(true);
          await expect(element).toHaveAttribute('data-synthetic-replay-trusted', 'true');
          await expect(element).toHaveAttribute('data-synthetic-animations', '1');
        }
      });
    }

    for (const mnemonicWallet of [false, true]) {
      test.describe(mnemonicWallet ? 'recovery phrase vault' : 'imported vault', () => {
        test.use({ mnemonicWallet });
        test('account wording describes the actual mode in the same accessible header', async ({ page }) => {
          await page.getByRole('button', { name: 'Open account modal', exact: true }).click();
          const dialog = page.getByRole('dialog', { name: 'Add Account', exact: true });
          await expect(page.locator('[data-modal-shell]').last()).toBeFocused();
          await expect(dialog).toHaveAccessibleDescription(mnemonicWallet
            ? "Create another account from this wallet's recovery phrase"
            : 'Import an existing Stellar secret key');
          await markShell(page);
          for (const [mode, description] of [
            ['Watch', 'Track any address — balances only, no keys'],
            ['Hardware', 'Connect a device and verify its Stellar address'],
            ['Import', 'Import an existing Stellar secret key'],
            ...(mnemonicWallet ? [['Derive', "Create another account from this wallet's recovery phrase"]] : []),
          ]) {
            await page.getByRole('button', { name: mode, exact: true }).click();
            await expect(dialog).toHaveAccessibleDescription(description);
            await stableShell(page);
          }
          if (!mnemonicWallet) await expect(page.getByRole('button', { name: 'Derive', exact: true })).toHaveCount(0);
          if (mnemonicWallet) {
            // Import → Derive enables the action. Audit its settled enabled
            // appearance, not the intermediate disabled-opacity transition.
            const create = page.getByRole('button', { name: 'Create Account', exact: true });
            await expect(create).toBeEnabled();
            await expect(create).toHaveCSS('opacity', '1');
          }
          const accessibility = await new AxeBuilder({ page }).include('[data-modal-backdrop]').analyze();
          expect(accessibility.violations.map(violation => ({ id: violation.id, impact: violation.impact, count: violation.nodes.length }))).toEqual([]);
          await page.keyboard.press('Escape');
          await closed(page, 'Open account modal');
        });
      });
    }

    test('account import guards header, dismissal, mode changes and duplicate clicks', async ({ page }) => {
      await page.getByRole('button', { name: 'Open account modal', exact: true }).click();
      await markShell(page);
      await startImport(page);
      await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Watch', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await outsidePointer(page);
      await page.getByRole('button', { name: 'Import Account', exact: true }).evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
      await page.keyboard.press('Tab');
      await stableShell(page);
      await expect(page.getByTestId('modal-encryptions')).toHaveText('1');
      await deliver(page, 'Deliver oldest response');
      await closed(page, 'Open account modal');
      await expect(page.getByTestId('modal-closes')).toHaveText('1');
    });

    for (const outcome of ['Deliver', 'Fail']) {
      test(`old account ${outcome.toLowerCase()} cannot affect a reopened busy import`, async ({ page }) => {
        await page.getByRole('button', { name: 'Open account modal', exact: true }).click();
        await startImport(page);
        await deliver(page, 'Force account closed');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.getByRole('button', { name: 'Open account modal', exact: true }).click();
        await expect(page.locator('[data-modal-shell]').last()).toBeFocused();
        await page.getByLabel('Account Label', { exact: true }).fill('Synthetic replacement');
        await expect(page.getByLabel('Account Label', { exact: true })).toHaveValue('Synthetic replacement');
        await startImport(page);
        await expect(page.getByLabel('Account Label', { exact: true })).toHaveValue('Synthetic replacement');
        await markShell(page);
        await deliver(page, `${outcome} oldest response`);
        await expect(page.getByTestId('modal-deliveries')).toHaveText('1');
        await stableShell(page, true);
        await expect(page.getByLabel('Account Label', { exact: true })).toHaveValue('Synthetic replacement');
        await expect(page.getByRole('button', { name: 'Import Account', exact: true })).toHaveAttribute('aria-busy', 'true');
        await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
        await expect(page.getByTestId('modal-closes')).toHaveText('0');
        await deliver(page, 'Deliver oldest response');
        if (outcome === 'Deliver') {
          // Both imports captured the same vault revision. A committed first;
          // B must report its own conflict and retry against the current vault.
          await expect(page.getByRole('button', { name: 'Import Account', exact: true })).toBeEnabled();
          await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(1);
          await expect(page.getByLabel('Account Label', { exact: true })).toHaveValue('Synthetic replacement');
          await expect(page.getByTestId('modal-closes')).toHaveText('0');
          await deliver(page, 'Hold next encryption');
          await page.getByRole('button', { name: 'Import Account', exact: true }).click();
          await expect(page.getByTestId('modal-encryptions')).toHaveText('3');
          await deliver(page, 'Deliver oldest response');
        }
        await closed(page, 'Open account modal');
        await expect(page.getByTestId('modal-closes')).toHaveText('1');
      });
    }

    for (const phase of ['preparation', 'submission']) {
    test(`claim ${phase} guards header, alternate done and asset handoff`, async ({ page }) => {
      await deliver(page, 'Use unknown response');
      await page.getByRole('button', { name: 'Open claim modal', exact: true }).click();
      await markShell(page);
      await page.getByRole('button', { name: 'Select all available', exact: true }).click();
      await deliver(page, `Hold ${phase}`);
      await page.getByRole('button', { name: 'Claim selected (1)', exact: true }).click();
      await expect(page.getByTestId('modal-stage')).toHaveText(phase);
      await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Add trusted asset', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Claim selected (1)', exact: true }).evaluate(element => (element as HTMLButtonElement).click());
      await page.getByRole('button', { name: 'Show dismissed (1)', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeDisabled();
      await expect(page.getByRole('dialog').getByRole('button').filter({ hasText: /^Restore$/ })).toBeDisabled();
      await page.keyboard.press('Escape');
      await outsidePointer(page);
      await page.keyboard.press('Tab');
      await stableShell(page);
      await deliver(page, 'Fail oldest response');
      await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await closed(page, 'Open claim modal');
      await expect(page.getByTestId('modal-handoffs')).toHaveText('0');
      await expect(page.getByTestId('modal-posts')).toHaveText(phase === 'submission' ? '1' : '0');
    });
    }

    test('confirmed claim permits closing while its balance refresh is pending', async ({ page }) => {
      await startClaim(page, 'confirmed');
      await deliver(page, 'Hold refresh');
      await deliver(page, 'Deliver oldest response');
      await expect(page.getByTestId('modal-stage')).toHaveText('refresh');
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await deliver(page, 'Deliver all responses');
      await expect(page.getByTestId('modal-closes')).toHaveText('1');
    });

    test('tracked confirmation refresh does not restart when its parent replaces the close callback', async ({ page }) => {
      await page.getByRole('button', { name: 'Toggle inline close callback', exact: true }).click();
      await startClaim(page, 'accepted');
      await deliver(page, 'Deliver oldest response');
      await expect(page.getByTestId('modal-stage')).toHaveText('canonical');
      await deliver(page, 'Hold refresh');
      await deliver(page, 'Canonical confirmed');
      await deliver(page, 'Deliver oldest response');
      await expect.poll(async () => Number(await page.getByTestId('modal-refreshes').textContent()) >= 2).toBe(true);
      await deliver(page, 'Rerender modal parent');
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      // One automatic provider refresh and one modal refresh; callback identity
      // changes cannot launch more work or cancel this opening's completion.
      expect(await page.getByTestId('modal-refreshes').textContent()).toBe('2');
      await deliver(page, 'Deliver all responses');
      await closed(page, 'Open claim modal');
      await expect(page.getByTestId('modal-closes')).toHaveText('1');
    });

    for (const mounting of ['retained', 'conditional']) {
      test(`confirmed claim refresh cannot close a reopened ${mounting} modal`, async ({ page }) => {
        if (mounting === 'conditional') await page.getByRole('button', { name: 'Toggle conditional mount', exact: true }).click();
        await startClaim(page, 'confirmed');
        await deliver(page, 'Hold refresh');
        await deliver(page, 'Deliver oldest response');
        await expect(page.getByTestId('modal-stage')).toHaveText('refresh');
        await deliver(page, 'Force claim closed');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.getByRole('button', { name: 'Open claim modal', exact: true }).click();
        await page.getByRole('button', { name: 'Show dismissed (1)', exact: true }).click();
        await markShell(page);
        await deliver(page, 'Deliver all responses');
        await expect(page.getByTestId('modal-deliveries')).not.toHaveText('1');
        await stableShell(page, true);
        await expect(page.getByRole('dialog', { name: 'Dismissed balances' })).toHaveCount(1);
        await expect(page.getByTestId('modal-closes')).toHaveText('0');
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
      });

      for (const response of ['accepted', 'unknown']) {
        for (const result of ['confirmed', 'failed']) {
          test(`${response} claim tracking ${result} preserves reopened ${mounting} modal`, async ({ page }) => {
            if (mounting === 'conditional') await page.getByRole('button', { name: 'Toggle conditional mount', exact: true }).click();
            await startClaim(page, response);
            await deliver(page, 'Deliver oldest response');
            await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
            await expect(page.getByTestId('modal-pending')).toHaveText('1');
            if (response === 'unknown') await deliver(page, 'Canonical hold');
            await expect(page.getByTestId('modal-stage')).toHaveText('canonical');
            await page.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await page.getByRole('button', { name: 'Open claim modal', exact: true }).click();
            if (response === 'unknown') await expect(page.getByRole('dialog').getByText('Claim status is unknown. Checking for ledger confirmation before another claim can be sent.', { exact: true })).toBeVisible();
            await page.getByRole('button', { name: 'Show dismissed (1)', exact: true }).click();
            await markShell(page);
            await deliver(page, `Canonical ${result}`);
            await deliver(page, 'Deliver all responses');
            await expect(page.getByTestId('modal-pending')).toHaveText('0');
            await stableShell(page, true);
            await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
            await expect(page.getByTestId('modal-closes')).toHaveText('1');
            await page.getByRole('button', { name: 'Done', exact: true }).click();
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await expect(page.getByTestId('modal-closes')).toHaveText('2');
          });
        }
      }
    }

    for (const appearance of ['light', 'dark'] as const) {
      test(`${appearance} account modes and claim views preserve the shell through rapid pointer and keyboard changes`, async ({ page }) => {
        await page.evaluate(() => { localStorage.setItem('stellarkey.theme', 'system'); window.dispatchEvent(new StorageEvent('storage', { key: 'stellarkey.theme', newValue: 'system', storageArea: localStorage })); });
        await page.emulateMedia({ colorScheme: appearance });
        await expect(page.locator('html')).toHaveAttribute('data-theme', appearance);
        await page.getByRole('button', { name: 'Open account modal', exact: true }).click();
        await markShell(page);
        for (let index = 0; index < 3; index++) {
          await page.getByRole('button', { name: 'Watch', exact: true }).click();
          await page.getByRole('button', { name: 'Import', exact: true }).focus();
          await page.keyboard.press('Enter');
        }
        await stableShell(page);
        const accountAxe = await new AxeBuilder({ page }).include('[data-modal-backdrop]').analyze();
        expect(accountAxe.violations.map(violation => ({ id: violation.id, impact: violation.impact, count: violation.nodes.length }))).toEqual([]);
        await page.keyboard.press('Escape');
        await closed(page, 'Open account modal');
        await page.getByRole('button', { name: 'Open claim modal', exact: true }).click();
        await markShell(page);
        for (let index = 0; index < 3; index++) {
          await page.getByRole('button', { name: 'Show dismissed (1)', exact: true }).click();
          await page.getByRole('button', { name: 'Review available (2)', exact: true }).focus();
          await page.keyboard.press('Space');
        }
        await stableShell(page);
        const claimAxe = await new AxeBuilder({ page }).include('[data-modal-backdrop]').analyze();
        expect(claimAxe.violations.map(violation => ({ id: violation.id, impact: violation.impact, count: violation.nodes.length }))).toEqual([]);
        await outsidePointer(page);
        await closed(page, 'Open claim modal');
      });
    }
  });
}
