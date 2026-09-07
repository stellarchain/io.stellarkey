import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __syntheticTooltipListeners?: { count(): number; restore(): void };
  }
}

test.skip(!process.env.PRIVATE_COMPONENT_FIXTURE_SHA256, 'Use the isolated synthetic component runner.');

test.beforeEach(async ({ page, baseURL }) => {
  const ownedOrigin = new URL(baseURL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === ownedOrigin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === ownedOrigin.replace(/^http/, 'ws')) socket.connectToServer();
    else socket.close();
  });
  await page.addInitScript(() => {
    const boundary = { mode: 'resolve', writes: 0, clears: 0, finish: null as (() => void) | null };
    Object.defineProperty(window, '__syntheticClipboard', { value: boundary });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => {
        boundary.writes += 1;
        if (value === '') boundary.clears += 1;
        if (boundary.mode === 'reject') throw new DOMException('Synthetic permission failure', 'NotAllowedError');
        if (boundary.mode === 'hold') await new Promise<void>(resolve => { boundary.finish = resolve; });
      },
    } });
  });
  await page.goto('/private-component-fixture');
  await page.getByRole('button', { name: 'Open UX primitive checks', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Synthetic UX primitives' })).toBeVisible();
});

async function clipboardMode(page: Page, mode: 'resolve' | 'reject' | 'hold') {
  await page.evaluate(value => {
    (window as typeof window & { __syntheticClipboard: { mode: string } }).__syntheticClipboard.mode = value;
  }, mode);
}

async function finishClipboard(page: Page) {
  await page.evaluate(() => {
    (window as typeof window & { __syntheticClipboard: { finish: (() => void) | null } }).__syntheticClipboard.finish?.();
  });
}

test('manual tabs separate focus from activation and preserve the dialog shell', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Synthetic UX primitives' });
  await dialog.evaluate(node => { (node as HTMLElement).dataset.identity = 'stable'; });
  const tabs = dialog.getByRole('tablist', { name: 'Synthetic intent tabs' });
  const publicTab = tabs.getByRole('tab', { name: 'Public' });
  const privateTab = tabs.getByRole('tab', { name: 'Private' });
  await publicTab.focus();
  await publicTab.press('ArrowRight');
  await expect(privateTab).toBeFocused();
  await expect(privateTab).toHaveAttribute('tabindex', '0');
  await expect(publicTab).toHaveAttribute('tabindex', '-1');
  await expect(publicTab).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByText('Synthetic private panel', { exact: true })).toBeHidden();
  await privateTab.press('Enter');
  await expect(privateTab).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByText('Synthetic private panel', { exact: true })).toBeVisible();
  await privateTab.press('Home');
  await expect(publicTab).toBeFocused();
  await expect(privateTab).toHaveAttribute('aria-selected', 'true');
  await publicTab.press('Space');
  await expect(publicTab).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByText('Synthetic private panel', { exact: true })).toBeHidden();
  await expect(dialog).toHaveAttribute('data-identity', 'stable');
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
});

test('automatic local tabs keep their existing arrow activation', async ({ page }) => {
  const tabs = page.getByRole('tablist', { name: 'Synthetic automatic tabs' });
  await tabs.getByRole('tab', { name: 'First' }).press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Second' })).toBeFocused();
  await expect(tabs.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true');
});

for (const size of ['md', 'sm']) {
  test(`Field reaches the actual ${size} Select trigger and retains its descriptions when errors clear`, async ({ page }) => {
    const field = page.getByTestId(`select-field-${size}`);
    const trigger = field.getByRole('button', { name: `Synthetic ${size} field`, exact: true });
    expect(await trigger.evaluate(node => {
      const label = node.parentElement?.querySelector('label');
      return Boolean(node.id && label?.htmlFor === node.id && label.control === node);
    })).toBe(true);
    if (size === 'sm') await expect(trigger).toHaveAttribute('id', 'synthetic-existing-select');
    await expect(trigger).toHaveAttribute('aria-invalid', 'true');
    await expect(trigger).toHaveAccessibleDescription('Existing synthetic description Synthetic selection hint Synthetic selection error');
    const describedIds = (await trigger.getAttribute('aria-describedby'))!.split(' ');
    expect(describedIds.length).toBe(3);
    expect(new Set(describedIds).size).toBe(3);
    await field.locator('label').click();
    await expect(page.getByRole('listbox', { name: `Synthetic ${size} field`, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page.getByRole('button', { name: 'Toggle synthetic field error', exact: true }).click();
    await expect(trigger).toHaveAttribute('aria-invalid', 'false');
    await expect(trigger).toHaveAttribute('aria-describedby', describedIds.slice(0, 2).join(' '));
    await expect(trigger).toHaveAccessibleDescription('Existing synthetic description Synthetic selection hint');
    await expect(field.getByRole('alert')).toHaveCount(0);
  });
}

test('named Toggle has a visible keyboard focus indicator and native switch activation', async ({ page }) => {
  const toggle = page.getByRole('switch', { name: 'Synthetic privacy setting', exact: true });
  await toggle.focus();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(toggle).toBeFocused();
  expect(await toggle.evaluate(node => node.matches(':focus-visible'))).toBe(true);
  expect(await toggle.evaluate(node => {
    const style = getComputedStyle(node);
    return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2
      && !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.outlineColor);
  })).toBe(true);
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(await toggle.locator('span').last().evaluate(node => {
    const properties = getComputedStyle(node).transitionProperty.split(',').map(value => value.trim());
    return properties.includes('transform') && properties.every(value => ['transform', 'translate', 'scale', 'rotate'].includes(value));
  })).toBe(true);
});

for (const motion of ['no-preference', 'reduce'] as const) {
  test.describe(`Tooltip ${motion} motion`, () => {
    test.use({ contextOptions: { reducedMotion: motion } });
    test.beforeEach(async ({ page }) => {
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(motion === 'reduce');
      await page.getByRole('dialog', { name: 'Synthetic UX primitives', exact: true }).evaluate(async node => {
        await Promise.all([node, node.querySelector('[data-modal-shell]')!].flatMap(element => element.getAnimations())
          .map(animation => animation.finished.catch(() => {})));
      });
    });

    for (const placement of ['top', 'right', 'flipped']) {
      test(`Tooltip keeps pointer transfer across its ${placement} gap in both directions`, async ({ page }) => {
        if (placement === 'flipped') await page.setViewportSize({ width: 390, height: 844 });
        const trigger = page.getByRole('button', { name: `Show synthetic ${placement} help`, exact: true });
        const tooltip = page.getByRole('tooltip', { name: `Synthetic ${placement} guidance`, exact: true });
        await trigger.hover();
        await expect(tooltip).toBeVisible();
        const anchor = (await trigger.boundingBox())!;
        const content = (await tooltip.boundingBox())!;
        const anchorPoint = { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 };
        const contentPoint = { x: content.x + content.width / 2, y: content.y + content.height / 2 };
        const gap = placement === 'top' ? anchor.y - content.y - content.height
          : placement === 'right' ? content.x - anchor.x - anchor.width : anchor.x - content.x - content.width;
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeLessThanOrEqual(9);
        const gapPoint = placement === 'top'
          ? { x: anchorPoint.x, y: (anchor.y + content.y + content.height) / 2 }
          : { x: placement === 'right' ? (anchor.x + anchor.width + content.x) / 2 : (content.x + content.width + anchor.x) / 2, y: anchorPoint.y };
        await page.mouse.move(gapPoint.x, gapPoint.y, { steps: 4 });
        await expect(tooltip).toBeVisible();
        await page.mouse.move(contentPoint.x, contentPoint.y, { steps: 4 });
        await expect(tooltip).toBeVisible();
        expect(await tooltip.evaluate(node => node.matches(':hover'))).toBe(true);
        await page.mouse.move(gapPoint.x, gapPoint.y, { steps: 4 });
        await expect(tooltip).toBeVisible();
        await page.mouse.move(anchorPoint.x, anchorPoint.y, { steps: 4 });
        await expect(tooltip).toBeVisible();
        await page.mouse.move(1, 1);
        await expect(tooltip).toBeHidden();
      });
    }

    test('Tooltip Escape dismisses only its help without moving focus or reopening on resize', async ({ page }) => {
      const dialog = page.getByRole('dialog', { name: 'Synthetic UX primitives' });
      const trigger = page.getByRole('button', { name: 'Show synthetic top help', exact: true });
      const tooltip = page.getByRole('tooltip', { name: 'Synthetic top guidance', exact: true });
      await trigger.focus();
      await expect(tooltip).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('data-overlay-state', 'open');
      await expect(tooltip).toBeHidden();
      await expect(trigger).toBeFocused();
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await expect(tooltip).toBeHidden();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    test('Tooltip retains help for either focus or pointer interest and merges existing descriptions', async ({ page }) => {
      const trigger = page.getByRole('button', { name: 'Show synthetic top help', exact: true });
      const tooltip = page.getByRole('tooltip', { name: 'Synthetic top guidance', exact: true });
      await trigger.focus();
      await trigger.hover();
      await page.mouse.move(1, 1);
      await expect(tooltip).toBeVisible();
      await expect(trigger).toHaveAccessibleDescription('Existing synthetic help description Synthetic top guidance');
      await trigger.hover();
      await page.getByRole('button', { name: 'Open nested tooltip check', exact: true }).focus();
      await expect(tooltip).toBeVisible();
      await page.mouse.move(1, 1);
      await expect(tooltip).toBeHidden();
    });

    test('Tooltip stays in its modal and a background tooltip cannot consume a nested modal Escape', async ({ page }) => {
      const parent = page.getByRole('dialog', { name: 'Synthetic UX primitives', exact: true });
      await page.getByRole('button', { name: 'Show synthetic top help', exact: true }).hover();
      const tooltip = page.getByRole('tooltip', { name: 'Synthetic top guidance', exact: true });
      await expect(tooltip).toBeVisible();
      expect(await tooltip.evaluate(node => Boolean(node.closest('[data-modal-backdrop]')))).toBe(true);
      await expect(tooltip.locator('button, a[href], input, [tabindex]')).toHaveCount(0);
      await page.getByRole('button', { name: 'Open nested tooltip check', exact: true }).evaluate(node => (node as HTMLButtonElement).click());
      const nested = page.getByRole('dialog', { name: 'Synthetic nested tooltip check', exact: true });
      await expect(nested).toBeVisible();
      await expect.poll(() => parent.evaluate(node => (node as HTMLElement).inert)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(nested).toBeHidden();
      await expect(parent).toBeVisible();
      await expect.poll(() => parent.evaluate(node => (node as HTMLElement).inert)).toBe(false);
      await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    });

    test('Tooltip opened by hover outside a modal is dismissed when the app becomes inert', async ({ page }) => {
      const dialog = page.getByRole('dialog', { name: 'Synthetic UX primitives', exact: true });
      const trigger = page.getByRole('button', { name: 'Open UX primitive checks', exact: true });
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      await page.mouse.move(1, 1);
      await trigger.hover();
      await expect(trigger).not.toBeFocused();
      await expect(page.getByRole('tooltip', { name: 'Synthetic outside guidance', exact: true })).toBeVisible();
      await trigger.evaluate(node => (node as HTMLButtonElement).click());
      await expect(dialog).toBeVisible();
      await expect(page.locator('[role="tooltip"]')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    test('Tooltip at the viewport top does not intercept its own trigger and remains hoverable', async ({ page }) => {
      await page.getByRole('button', { name: 'Show viewport-edge tooltip', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Synthetic UX primitives', exact: true })).toBeHidden();
      const trigger = page.getByRole('button', { name: 'Show synthetic edge help', exact: true });
      const tooltip = page.getByRole('tooltip', { name: 'Synthetic edge guidance', exact: true });
      await trigger.hover();
      await expect(tooltip).toBeVisible();
      expect(await trigger.evaluate(node => {
        const bounds = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
      })).toBe(true);
      const anchor = (await trigger.boundingBox())!;
      const content = (await tooltip.boundingBox())!;
      expect(content.y - anchor.y - anchor.height).toBeGreaterThan(0);
      const gapPoint = { x: anchor.x + anchor.width / 2, y: (anchor.y + anchor.height + content.y) / 2 };
      await page.mouse.move(gapPoint.x, gapPoint.y, { steps: 4 });
      await expect(tooltip).toBeVisible();
      await page.mouse.move(content.x + content.width / 2, content.y + content.height / 2, { steps: 4 });
      expect(await tooltip.evaluate(node => node.matches(':hover'))).toBe(true);
      await page.mouse.move(gapPoint.x, gapPoint.y, { steps: 4 });
      await trigger.click();
      await expect(page.getByTestId('synthetic-edge-actions')).toHaveText('1');
    });

    test('Tooltip dismissal is latched until fresh pointer or keyboard intent', async ({ page }) => {
      const trigger = page.getByRole('button', { name: 'Show synthetic top help', exact: true });
      const tooltip = page.getByRole('tooltip', { name: 'Synthetic top guidance', exact: true });
      await trigger.hover();
      await expect(tooltip).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(tooltip).toBeHidden();
      const bounds = (await trigger.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width / 2 + 1, bounds.y + bounds.height / 2);
      await expect(tooltip).toBeHidden();
      await page.mouse.move(1, 1);
      await trigger.hover();
      await expect(tooltip).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(tooltip).toBeHidden();
      await page.mouse.move(1, 1);
      await trigger.focus();
      await expect(tooltip).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(tooltip).toBeHidden();
      await page.getByRole('button', { name: 'Toggle synthetic tooltip labels', exact: true }).focus();
      await trigger.focus();
      await expect(tooltip).toBeVisible();
    });

    test('Tooltip with a removed label keeps the original description without stale help', async ({ page }) => {
      const trigger = page.getByRole('button', { name: 'Show synthetic top help', exact: true });
      const tooltip = page.getByRole('tooltip', { name: 'Synthetic top guidance', exact: true });
      await trigger.focus();
      await expect(tooltip).toBeVisible();
      const toggle = page.getByRole('button', { name: 'Toggle synthetic tooltip labels', exact: true });
      await toggle.evaluate(node => (node as HTMLButtonElement).click());
      await expect(tooltip).toHaveCount(0);
      await expect(trigger).toHaveAttribute('aria-describedby', 'synthetic-tooltip-description');
      await expect(trigger).toHaveAccessibleDescription('Existing synthetic help description');
      await toggle.evaluate(node => (node as HTMLButtonElement).click());
      await expect(tooltip).toHaveCount(0);
      await trigger.focus();
      await expect(tooltip).toBeVisible();
    });

    test('Tooltip inside the nested modal consumes only its own first Escape', async ({ page }) => {
      await page.getByRole('button', { name: 'Open nested tooltip check', exact: true }).click();
      const nested = page.getByRole('dialog', { name: 'Synthetic nested tooltip check', exact: true });
      await expect(nested.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
      const trigger = nested.getByRole('button', { name: 'Show synthetic nested help', exact: true });
      await trigger.focus();
      await expect(nested.getByRole('tooltip', { name: 'Synthetic nested guidance', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(nested).toHaveAttribute('data-overlay-state', 'open');
      await expect(nested.getByRole('tooltip')).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(nested).toBeHidden();
      await expect(page.getByRole('dialog', { name: 'Synthetic UX primitives', exact: true })).toHaveAttribute('data-overlay-state', 'open');
    });

    test('Tooltip follows its modal containing block and viewport events without stealing focus', async ({ page }) => {
      const trigger = page.getByRole('button', { name: 'Show synthetic right help', exact: true });
      const tooltip = page.getByRole('tooltip', { name: 'Synthetic right guidance', exact: true });
      await trigger.focus();
      await expect(tooltip).toBeVisible();
      await page.getByRole('dialog', { name: 'Synthetic UX primitives', exact: true }).evaluate(node => {
        const style = (node as HTMLElement).style;
        style.left = '12px'; style.right = '12px'; style.top = '24px';
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('scroll'));
        window.visualViewport?.dispatchEvent(new Event('resize'));
        window.visualViewport?.dispatchEvent(new Event('scroll'));
      });
      await expect.poll(async () => {
        const anchor = (await trigger.boundingBox())!;
        const content = (await tooltip.boundingBox())!;
        return Math.abs(content.x - anchor.x - anchor.width - 8) < 1
          && Math.abs(content.y + content.height / 2 - anchor.y - anchor.height / 2) < 1;
      }).toBe(true);
      await expect(trigger).toBeFocused();
    });

    test('Tooltip unmount removes its portal and every registered viewport and Escape listener', async ({ page }) => {
      let pageErrors = 0;
      const onPageError = () => { pageErrors += 1; };
      page.on('pageerror', onPageError);
      await page.evaluate(() => {
        const add = EventTarget.prototype.addEventListener;
        const remove = EventTarget.prototype.removeEventListener;
        const active: Array<{ target: EventTarget; type: string; callback: EventListenerOrEventListenerObject; capture: boolean }> = [];
        const captureValue = (options?: boolean | EventListenerOptions) => typeof options === 'boolean' ? options : options?.capture ?? false;
        EventTarget.prototype.addEventListener = function(type, callback, options) {
          const capture = captureValue(options);
          const watched = ((this === window || this === window.visualViewport) && ['resize', 'scroll'].includes(type))
            || (this === document && type === 'keydown' && capture);
          if (watched && callback && !active.some(item => item.target === this && item.type === type && item.callback === callback && item.capture === capture)) {
            active.push({ target: this, type, callback, capture });
          }
          add.call(this, type, callback, options);
        };
        EventTarget.prototype.removeEventListener = function(type, callback, options) {
          const capture = captureValue(options);
          const index = active.findIndex(item => item.target === this && item.type === type && item.callback === callback && item.capture === capture);
          if (index >= 0) active.splice(index, 1);
          remove.call(this, type, callback, options);
        };
        window.__syntheticTooltipListeners = {
          count: () => active.length,
          restore: () => { EventTarget.prototype.addEventListener = add; EventTarget.prototype.removeEventListener = remove; },
        };
      });
      try {
        const toggle = page.getByRole('button', { name: 'Toggle synthetic tooltip controls', exact: true });
        for (let iteration = 0; iteration < 2; iteration += 1) {
          if (iteration) await toggle.evaluate(node => (node as HTMLButtonElement).click());
          await page.getByRole('button', { name: 'Show synthetic top help', exact: true }).focus();
          await expect(page.getByRole('tooltip', { name: 'Synthetic top guidance', exact: true })).toBeVisible();
          await expect.poll(() => page.evaluate(() => window.__syntheticTooltipListeners!.count())).toBeGreaterThan(0);
          await toggle.evaluate(node => (node as HTMLButtonElement).click());
          await expect(page.locator('[role="tooltip"]')).toHaveCount(0);
          await expect.poll(() => page.evaluate(() => window.__syntheticTooltipListeners!.count())).toBe(0);
          await page.evaluate(async () => {
            window.dispatchEvent(new Event('resize'));
            window.dispatchEvent(new Event('scroll'));
            window.visualViewport?.dispatchEvent(new Event('resize'));
            window.visualViewport?.dispatchEvent(new Event('scroll'));
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          });
          await page.keyboard.press('Tab');
          expect(await page.getByRole('dialog', { name: 'Synthetic UX primitives', exact: true })
            .evaluate(node => node.contains(document.activeElement))).toBe(true);
        }
        expect(pageErrors).toBe(0);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog', { name: 'Synthetic UX primitives', exact: true })).toBeHidden();
        await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
        await expect.poll(() => page.locator('[data-app-surface]').evaluate(node => (node as HTMLElement).inert)).toBe(false);
      } finally {
        page.off('pageerror', onPageError);
        await page.evaluate(() => { window.__syntheticTooltipListeners?.restore(); delete window.__syntheticTooltipListeners; });
      }
    });

    test('Tooltip visible in its owning dialog has no blocking axe violations', async ({ page, browserName }) => {
      await page.getByRole('button', { name: 'Show synthetic top help', exact: true }).focus();
      await expect(page.getByRole('tooltip', { name: 'Synthetic top guidance', exact: true })).toBeVisible();
      const result = await new AxeBuilder({ page }).include('[role="dialog"]').include('[role="tooltip"]')
        .disableRules(browserName === 'webkit' ? ['color-contrast'] : []).analyze();
      expect(result.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? '')).length).toBe(0);
    });
  });
}

test('Select exposes real option focus, skips disabled options, and closes only itself', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Synthetic asset', exact: true });
  await trigger.press('ArrowDown');
  const listbox = page.getByRole('listbox', { name: 'Synthetic asset' });
  await expect(listbox).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-controls', await listbox.getAttribute('id') ?? 'missing');
  await expect(listbox.getByRole('option', { name: 'Alpha' })).toBeFocused();
  await expect.poll(() => page.getByRole('dialog', { name: 'Synthetic UX primitives' })
    .evaluate(node => node.contains(document.activeElement))).toBe(true);
  await expect.poll(() => listbox.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.top >= 0 && bounds.bottom <= innerHeight + 1;
  })).toBe(true);
  await page.keyboard.press('ArrowDown');
  await expect(listbox.getByRole('option', { name: 'Gamma' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(listbox.getByRole('option', { name: 'Delta' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(listbox.getByRole('option', { name: 'Alpha' })).toBeFocused();
  await page.keyboard.press('g');
  await expect(listbox.getByRole('option', { name: 'Gamma' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(listbox).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText('Gamma');
  await trigger.press('ArrowUp');
  await page.keyboard.press('Escape');
  await expect(listbox).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Synthetic UX primitives' })).toBeVisible();
});

test('Select Tab resumes the containing dialog sequence and empty lists stay operable', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Synthetic asset', exact: true });
  await trigger.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Toggle empty options' })).toBeFocused();
  await page.getByRole('button', { name: 'Toggle empty options' }).click();
  await trigger.press('ArrowDown');
  await expect(page.getByRole('listbox')).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('Select selects the focused option identity after live reordering', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Synthetic asset', exact: true });
  await trigger.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Alpha', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const gamma = page.getByRole('option', { name: 'Gamma', exact: true });
  await expect(gamma).toBeFocused();
  await gamma.evaluate(node => { (node as HTMLElement).dataset.identity = 'same-gamma'; });
  await page.getByRole('button', { name: 'Reorder synthetic options', exact: true })
    .evaluate(node => (node as HTMLButtonElement).click());
  await expect(gamma).toHaveAttribute('data-identity', 'same-gamma');
  await expect(gamma).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(trigger).toContainText('Gamma');
  await expect(trigger).toBeFocused();
});

for (const action of ['Remove', 'Disable']) {
  test(`Select ${action.toLowerCase()}d focused options do not leave stale selection or focus`, async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Synthetic asset', exact: true });
    await trigger.press('ArrowDown');
    await expect(page.getByRole('option', { name: 'Alpha', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: 'Gamma', exact: true })).toBeFocused();
    await page.getByRole('button', { name: `${action} synthetic Gamma`, exact: true })
      .evaluate(node => (node as HTMLButtonElement).click());
    await expect(page.getByRole('option', { name: 'Alpha', exact: true })).toBeFocused();
    await expect(trigger).toContainText('Alpha');
    await expect.poll(() => page.getByRole('dialog', { name: 'Synthetic UX primitives' })
      .evaluate(node => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(trigger).toContainText('Alpha');
  });
}

test('Select keeps an empty refreshed listbox focused without submitting a stale option', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Synthetic asset', exact: true });
  await trigger.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Alpha', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Gamma', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Toggle empty options', exact: true })
    .evaluate(node => (node as HTMLButtonElement).click());
  await expect(page.getByRole('listbox')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.getByTestId('selected-synthetic-option')).toHaveText('alpha');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('Select disabled during navigation removes its popup and prevents stale choices', async ({ page }) => {
  await page.getByRole('button', { name: 'Synthetic asset', exact: true }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Alpha', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Toggle select disabled' }).evaluate(node => (node as HTMLButtonElement).click());
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Synthetic asset', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Toggle empty options' })).toBeFocused();
  await expect.poll(() => page.getByRole('dialog', { name: 'Synthetic UX primitives' })
    .evaluate(node => node.contains(document.activeElement))).toBe(true);
});

test('disabling a Select does not steal focus already moved to another control', async ({ page }) => {
  await page.getByRole('button', { name: 'Synthetic asset', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Alpha', exact: true })).toBeFocused();
  const other = page.getByRole('button', { name: 'Toggle select disabled', exact: true });
  await other.focus();
  await other.evaluate(node => (node as HTMLButtonElement).click());
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(other).toBeFocused();
});

for (const key of ['Tab', 'Shift+Tab']) {
  test(`Dropdown ${key} closes only the menu and resumes its trigger sequence`, async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Synthetic actions', exact: true });
    await trigger.click();
    await expect(page.getByRole('menuitem', { name: 'One', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Two', exact: true })).toBeFocused();
    await page.keyboard.press(key);
    await expect(page.getByRole('menu')).toBeHidden();
    const next = page.getByRole('button', { name: key === 'Tab' ? 'Copy synthetic item' : 'Toggle select disabled', exact: true });
    await expect(next).toBeFocused();
    await expect(page.getByRole('dialog', { name: 'Synthetic UX primitives' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  });
}

test('Dropdown does not move focused menu items when viewport geometry changes', async ({ page }) => {
  await page.getByRole('button', { name: 'Synthetic actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'One', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const third = page.getByRole('menuitem', { name: 'Three', exact: true });
  await expect(third).toBeFocused();
  await page.evaluate(async () => {
    window.dispatchEvent(new Event('resize'));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(third).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Synthetic actions' })).toBeFocused();
});

test('copy failures are announced in context and can be retried', async ({ page }) => {
  const region = page.getByTestId('ordinary-copy');
  const copy = region.getByRole('button');
  await clipboardMode(page, 'reject');
  await copy.focus();
  await copy.click();
  await expect(region.getByRole('status')).toContainText(/could not copy/i);
  await expect(copy).toBeFocused();
  await expect(copy).toBeEnabled();
  await clipboardMode(page, 'resolve');
  await copy.click();
  await expect(region.getByRole('status')).toHaveText('Copied to clipboard.');
});

test('pending clipboard writes reject duplicate clicks and stale success after value replacement', async ({ page }) => {
  const region = page.getByTestId('ordinary-copy');
  const copy = region.getByRole('button');
  await clipboardMode(page, 'hold');
  await copy.click();
  await expect(copy).toBeDisabled();
  await expect(copy).toHaveCSS('opacity', '0.6');
  await expect(region.getByRole('status')).toHaveText('Copying to clipboard…');
  await copy.evaluate(node => (node as HTMLButtonElement).click());
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __syntheticClipboard: { writes: number } }).__syntheticClipboard.writes)).toBe(1);
  await page.getByRole('button', { name: 'Change synthetic copy value' }).click();
  await finishClipboard(page);
  await expect(copy).toBeEnabled();
  await expect(region.getByRole('status')).toHaveText('');
  await expect(copy).toHaveAccessibleName('Copy synthetic item');
});

test('sensitive copy retains an explicit clear action after transient feedback ends', async ({ page }) => {
  await page.clock.install();
  const region = page.getByTestId('sensitive-copy');
  await region.getByRole('button', { name: 'Copy synthetic recovery' }).click();
  const clear = region.getByRole('button', { name: 'Clear copied secret from clipboard' });
  await expect(clear).toBeVisible();
  await page.clock.fastForward(2100);
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(region.getByRole('status')).toHaveText('Clipboard cleared. Clipboard managers may retain earlier copies.');
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __syntheticClipboard: { clears: number } }).__syntheticClipboard.clears)).toBe(1);
});

test('late clipboard completion does not update a replacement control', async ({ page }) => {
  await clipboardMode(page, 'hold');
  const region = page.getByTestId('ordinary-copy');
  await region.getByRole('button').click();
  await page.getByRole('button', { name: 'Toggle synthetic copy control' }).click();
  await page.getByRole('button', { name: 'Toggle synthetic copy control' }).click();
  await finishClipboard(page);
  await expect(region.getByRole('button')).toHaveAccessibleName('Copy synthetic item');
  await expect(region.getByRole('status')).toHaveText('');
});

test('HashValue shares generic copy feedback without moving focus or reading clipboard values', async ({ page }) => {
  const region = page.getByTestId('hash-copy');
  const copy = region.getByRole('button');
  await copy.focus();
  await copy.click();
  await expect(region.getByRole('status')).toHaveText('Copied to clipboard.');
  await expect(copy).toBeFocused();
});

test('open primitives have accessible names and no blocking axe violations', async ({ page, browserName }) => {
  await page.getByRole('button', { name: 'Synthetic asset', exact: true }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  const result = await new AxeBuilder({ page }).include('[role="dialog"]').include('[role="listbox"]')
    .disableRules(browserName === 'webkit' ? ['color-contrast'] : []).analyze();
  expect(result.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? '')).length).toBe(0);
});
