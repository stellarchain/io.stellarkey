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
  await page.getByRole('button', { name: 'Test relay startup', exact: true }).click();
});

const dialogFor = (page: Page) => page.getByRole('dialog', { name: 'Earn by relaying', exact: true });
const fixtureAction = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
  .evaluate(node => (node as HTMLButtonElement).click());
async function openEarn(page: Page) {
  await page.getByRole('button', { name: /Earn by relaying/ }).click();
  return dialogFor(page);
}
async function start(page: Page) {
  const dialog = await openEarn(page);
  await dialog.getByRole('button', { name: 'Start relaying', exact: true }).click();
  await expect(page.getByTestId('startup-requested')).toHaveText('true');
  return dialog;
}
async function connect(page: Page) {
  await fixtureAction(page, 'Finish wallet preparation');
  await expect(dialogFor(page).getByText('Connecting', { exact: true })).toBeVisible();
  await expect(page.getByTestId('startup-creates')).toHaveText('1');
  // The manager subscribes before readiness. Wait for its Connecting paint,
  // then resolve the controlled transport; no remote data or fixed sleeps.
  await fixtureAction(page, 'Connect relay transport');
  await expect(dialogFor(page).getByText('Connected', { exact: true })).toBeVisible();
}

test('fresh unlock Start prepares the real runtime before connecting and preserves the dialog', async ({ page }) => {
  const dialog = await openEarn(page);
  await expect(page.getByTestId('startup-requested')).toHaveText('false');
  await expect(page.getByTestId('startup-creates')).toHaveText('0');
  await dialog.evaluate(node => { node.setAttribute('data-startup-identity', 'original'); });
  await dialog.getByRole('button', { name: 'Start relaying', exact: true }).press('Enter');
  await expect(page.getByTestId('startup-requested')).toHaveText('true');
  await expect(dialog.getByText('Preparing wallet', { exact: true })).toBeVisible();
  await expect(page.getByTestId('startup-creates')).toHaveText('0');
  await connect(page);
  await expect(dialog).toHaveAttribute('data-startup-identity', 'original');
  await expect(dialog.getByRole('button', { name: 'Stop relaying', exact: true })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await expect(dialog.getByText('Connected to 1 of 2 public relays', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Earn by relaying/ })).toBeFocused();
});

test('saved participation is Paused after a fresh unlock and keyboard Resume retains focus', async ({ page }) => {
  await start(page);
  await connect(page);
  await page.keyboard.press('Escape');
  await fixtureAction(page, 'Fresh unlock or account');
  await expect(page.getByTestId('startup-requested')).toHaveText('false');
  await expect(page.getByTestId('startup-creates')).toHaveText('0');
  const dialog = await openEarn(page);
  await expect(dialog.getByText('Paused', { exact: true })).toBeVisible();
  await dialog.getByText('Relay connections', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Save connections', exact: true }).click();
  await expect(page.getByTestId('startup-requested')).toHaveText('false');
  await dialog.getByLabel('Your fee per payment').fill('unfinished');
  const resume = dialog.getByRole('button', { name: 'Resume relaying', exact: true });
  await resume.focus();
  await resume.press('Enter');
  await expect(page.getByTestId('startup-requested')).toHaveText('true');
  await expect(dialog.getByLabel('Your fee per payment')).toHaveValue('unfinished');
  await expect(dialog.getByRole('button', { name: 'Stop relaying', exact: true })).toBeFocused();
  await connect(page);
});

test('pointer Resume keeps focus in the modal without removing the active control', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Escape');
  await fixtureAction(page, 'Fresh unlock or account');
  const dialog = await openEarn(page);
  await dialog.getByLabel('Your fee per payment').focus();
  await dialog.getByRole('button', { name: 'Resume relaying', exact: true }).click();
  await expect(page.getByTestId('startup-requested')).toHaveText('true');
  // WebKit touch keeps the input focused; Chromium focuses the button. Both
  // must retain a connected, in-dialog control, not fall back to the page.
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
});

test('an external stop moves only a disappearing paused Stop focus to the stable control', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Escape');
  await fixtureAction(page, 'Fresh unlock or account');
  const dialog = await openEarn(page);
  await dialog.getByRole('button', { name: 'Stop relaying', exact: true }).focus();
  await fixtureAction(page, 'Stop relay elsewhere');
  await expect(dialog.getByRole('button', { name: 'Start relaying', exact: true })).toBeFocused();
});

test('a connected helper survives unrelated storage and sender-only preference changes', async ({ page }) => {
  await start(page);
  await connect(page);
  await fixtureAction(page, 'Unrelated storage update');
  await fixtureAction(page, 'Change sender preference only');
  await expect(dialogFor(page).getByText('Connected', { exact: true })).toBeVisible();
  await expect(page.getByTestId('startup-creates')).toHaveText('1');
  await expect(page.getByTestId('startup-closes')).toHaveText('0');
  await fixtureAction(page, 'Change real helper fee');
  await expect(page.getByTestId('startup-creates')).toHaveText('2');
  await expect(page.getByTestId('startup-closes')).toHaveText('1');
});

test('editing saved settings while paused does not supply relay startup intent', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Escape');
  await fixtureAction(page, 'Fresh unlock or account');
  const dialog = await openEarn(page);
  await dialog.getByLabel('Your fee per payment').fill('0.003');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Changes saved' })).toBeVisible();
  await expect(page.getByTestId('startup-requested')).toHaveText('false');
  await expect(dialog.getByText('Paused', { exact: true })).toBeVisible();
  const stop = dialog.getByRole('button', { name: 'Stop relaying', exact: true });
  await stop.focus();
  await stop.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Start relaying', exact: true })).toBeFocused();
  await expect(page.getByTestId('startup-requested')).toHaveText('false');
});

test('a failed relay setup reports failure and then recovers without restarting the helper', async ({ page }) => {
  const dialog = await start(page);
  await fixtureAction(page, 'Finish wallet preparation');
  await expect(dialog.getByText('Connecting', { exact: true })).toBeVisible();
  await fixtureAction(page, 'Fail relay transport');
  await expect(dialog.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Reconnecting', { exact: true })).toBeVisible();
  await fixtureAction(page, 'Connect relay transport');
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible();
  await expect(page.getByTestId('startup-creates')).toHaveText('1');
});

test('a failed save never starts private work and retry keeps the fee edit', async ({ page }) => {
  const dialog = await openEarn(page);
  await dialog.getByLabel('Your fee per payment').fill('0.004');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, '__restoreStartupStorage', { value: () => { Storage.prototype.setItem = original; } });
    Storage.prototype.setItem = () => { throw new Error('Synthetic storage unavailable'); };
  });
  await dialog.getByRole('button', { name: 'Start relaying', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not save');
  await expect(page.getByTestId('startup-requested')).toHaveText('false');
  await expect(page.getByTestId('startup-creates')).toHaveText('0');
  await expect(dialog.getByLabel('Your fee per payment')).toHaveValue('0.004');
  await page.evaluate(() => (window as typeof window & { __restoreStartupStorage(): void }).__restoreStartupStorage());
  await dialog.getByRole('button', { name: 'Start relaying', exact: true }).click();
  await expect(page.getByTestId('startup-requested')).toHaveText('true');
});

test('runtime failure is not Connecting and Stop cancels an in-flight connection', async ({ page }) => {
  const dialog = await start(page);
  await fixtureAction(page, 'Fail wallet preparation');
  await expect(dialog.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Connecting', { exact: true })).toHaveCount(0);
  await fixtureAction(page, 'Finish wallet preparation');
  await expect(dialog.getByText('Connecting', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Stop relaying', exact: true }).click();
  await expect(dialog.getByText('Not relaying', { exact: true })).toBeVisible();
  await expect(page.getByTestId('startup-closes')).toHaveText('1');
  await fixtureAction(page, 'Connect relay transport');
  await expect(dialog.getByText('Connected', { exact: true })).toHaveCount(0);
});

test('paused controls remain accessible at narrow width without reduced-motion dependence', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Escape');
  await fixtureAction(page, 'Fresh unlock or account');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 320, height: 740 });
  const dialog = await openEarn(page);
  await expect(dialog.getByRole('button', { name: 'Resume relaying', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Stop relaying', exact: true })).toBeVisible();
  const scan = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(scan.violations.map(({ id, impact }) => ({ id, impact }))).toEqual([]);
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});
