import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
  expect(result.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
});
