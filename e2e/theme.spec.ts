import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { importTestWallet, installNetworkFixtures, installQuietEventSource } from './fixtures';

test.beforeEach(async ({ context, page }) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
  await page.emulateMedia({ colorScheme: 'dark' });
});

async function navigate(page: Page, name: 'Home' | 'Settings') {
  const tabs = page.getByRole('navigation', { name: 'Tabs' });
  const target = await tabs.isVisible().catch(() => false)
    ? tabs.getByRole('button', { name, exact: true })
    : page.getByRole('button', { name, exact: true }).first();
  await target.click();
  if (name === 'Settings') await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function appearance(page: Page) {
  await importTestWallet(page);
  await navigate(page, 'Settings');
  return page.getByRole('group', { name: 'Appearance', exact: true });
}

test('appearance retains blocked-storage choices through keyboard activation and remount', async ({ page }) => {
  const control = await appearance(page);
  await page.evaluate(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'stellarkey.theme') throw new DOMException('Synthetic theme storage blocked', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'stellarkey.theme') throw new DOMException('Synthetic theme storage blocked', 'SecurityError');
      return set.call(this, key, value);
    };
  });
  const light = control.getByRole('button', { name: 'Light', exact: true });
  await light.click();
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]:not([media])')).toHaveAttribute('content', '#f2f2f7');
  const dark = control.getByRole('button', { name: 'Dark', exact: true });
  await dark.focus();
  await dark.press('Enter');
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await control.getByRole('button', { name: 'System', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  for (const name of ['Light', 'Dark', 'System', 'Dark', 'Light']) {
    await control.getByRole('button', { name, exact: true }).click();
  }
  await navigate(page, 'Home');
  await navigate(page, 'Settings');
  await expect(page.getByRole('group', { name: 'Appearance' }).getByRole('button', { name: 'Light', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('cross-tab appearance updates mounted controls without remounting an active overlay', async ({ context, page }) => {
  const control = await appearance(page);
  await control.getByRole('button', { name: 'Light', exact: true }).click();
  const other = await context.newPage();
  await other.goto('/about', { waitUntil: 'domcontentloaded' });
  await other.evaluate(() => localStorage.setItem('stellarkey.theme', 'dark'));
  await expect(control.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await navigate(page, 'Home');
  await page.getByRole('main').getByRole('button', { name: 'Send', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Send Payment', exact: true });
  await expect(dialog).toBeVisible();
  const shell = await dialog.locator('[data-modal-shell]').elementHandle();
  const backdrop = await page.locator('[data-modal-backdrop]').last().elementHandle();
  const close = dialog.getByRole('button', { name: 'Close', exact: true }).first();
  await close.focus();
  await other.evaluate(() => localStorage.setItem('stellarkey.theme', 'light'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await shell!.evaluate(node => node.isConnected)).toBe(true);
  expect(await backdrop!.evaluate(node => node.isConnected)).toBe(true);
  await expect(close).toBeFocused();
  expect(await page.locator('[inert]').count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await close.press('Escape');
  await expect(dialog).toBeHidden();
  await other.close();
});

test('appearance controls and settings retain automated accessibility in both themes', async ({ page, browserName }) => {
  const control = await appearance(page);
  for (const name of ['Light', 'Dark']) {
    await control.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', name.toLowerCase());
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))));
    // The existing WebKit/axe transparent-backdrop limitation is unchanged;
    // Chromium remains the automated contrast gate for each appearance.
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .disableRules(browserName === 'webkit' ? ['color-contrast'] : [])
      .analyze();
    const blocking = result.violations
      .filter(violation => violation.impact === 'critical' || violation.impact === 'serious')
      .map(violation => ({ rule: violation.id, impact: violation.impact, count: violation.nodes.length }));
    expect(blocking, 'Appearance settings have blocking structural accessibility violations').toEqual([]);
  }
});

