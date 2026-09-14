import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

test.skip(!process.env.PRIVATE_COMPONENT_FIXTURE_SHA256, 'Use the isolated synthetic component runner.');

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === origin.replace('http', 'ws')) socket.connectToServer();
    else socket.close();
  });
  await page.goto('/private-component-fixture');
});

test('new shielded receive requests create an address only after private intent', async ({ page }) => {
  await page.getByRole('button', { name: 'Open QR freshness checks', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('0');
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('1');
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'About this address', exact: true }).click();
  await expect(dialog.getByText(/public diversifier/)).toBeVisible();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('1');
});

test('withdrawal warns about an exact locally recorded deposit without blocking payment', async ({ page }) => {
  await page.getByRole('button', { name: 'Use synthetic matching deposit', exact: true }).click();
  await page.getByRole('button', { name: 'Open synthetic private withdrawal', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Withdraw Funds' });
  await dialog.getByLabel('Amount', { exact: true }).fill('1');
  await expect(dialog.getByText('This amount matches a deposit in your local history.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Review Withdrawal', exact: true })).toBeEnabled();
  await page.locator('[data-modal-shell]').evaluate(async node => {
    await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  const violations = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.length }))).toEqual([]);
  await dialog.getByLabel('Amount', { exact: true }).fill('2');
  await expect(dialog.getByText('This amount matches a deposit in your local history.', { exact: true })).toHaveCount(0);
});

test('tab focus is not private intent and switching tabs keeps the same request', async ({ page }) => {
  await page.getByRole('button', { name: 'Open QR freshness checks', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  const publicTab = dialog.getByRole('tab', { name: 'Public', exact: true });
  const privateTab = dialog.getByRole('tab', { name: 'Private', exact: true });
  await publicTab.focus();
  await publicTab.press('ArrowRight');
  await expect(privateTab).toBeFocused();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('0');
  await privateTab.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  for (let index = 0; index < 3; index++) {
    await publicTab.click();
    await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toHaveCount(0);
    await privateTab.click();
    await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  }
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('1');
});

test('closing clears the request and reopening creates a new one', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Open QR freshness checks', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await dialog.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('2');
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
});

test('failed creation requires explicit retry or warned saved-address reuse', async ({ page }) => {
  await page.getByRole('button', { name: 'Open QR freshness checks', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  await dialog.getByRole('button', { name: 'Fail synthetic address creation', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'New address unavailable', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Resume synthetic address creation', exact: true }).click();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('1');
  await dialog.getByRole('button', { name: 'Reuse Saved Address', exact: true }).click();
  await expect(dialog.getByText(/Saved address reused\./)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('1');
  await dialog.getByRole('button', { name: 'New address', exact: true }).click();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('2');
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await expect(dialog.getByText(/Saved address reused\./)).toHaveCount(0);
});

test('saved receive works offline only after explicit reuse consent', async ({ page }) => {
  await page.getByRole('button', { name: 'Open QR freshness checks', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  await dialog.getByRole('button', { name: 'Keep saved address offline', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toHaveCount(0);
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('0');
  await dialog.getByRole('button', { name: 'Reuse Saved Address', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await expect(dialog.getByText(/Saved address reused\./)).toBeVisible();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('0');
});

for (const reduced of [false, true]) test(`address creation preserves its shell and revokes old results (reduced motion: ${reduced})`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.getByRole('button', { name: 'Open QR freshness checks', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  const shell = page.locator('[data-modal-shell]');
  await shell.evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
    (element as HTMLElement).dataset.requestIdentity = 'retained';
  });
  await page.locator('[data-modal-backdrop]').evaluate(element => { (element as HTMLElement).dataset.requestIdentity = 'retained'; });
  await dialog.getByRole('button', { name: 'Delay synthetic address creation', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('1');
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toHaveCount(0);
  await dialog.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(shell).toHaveAttribute('data-request-identity', 'retained');
  await expect(page.locator('[data-modal-backdrop]')).toHaveAttribute('data-request-identity', 'retained');
  expect(await page.evaluate(() => document.body.style.overflow === 'hidden')).toBe(true);
  expect(await page.evaluate(() => !!document.querySelector('main')?.closest('[inert]'))).toBe(true);
  await dialog.getByRole('button', { name: 'Replace synthetic receive account', exact: true }).click();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('2');
  await dialog.getByRole('button', { name: 'Reject oldest synthetic address', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'New address unavailable', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Complete oldest synthetic address', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await expect(shell).toHaveAttribute('data-request-identity', 'retained');
  expect(await page.evaluate(() => !!document.querySelector('[data-modal-backdrop]')?.contains(document.activeElement))).toBe(true);
});

test('session revocation prevents pending address and QR publication', async ({ page }) => {
  await page.getByRole('button', { name: 'Open QR freshness checks', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  await dialog.getByRole('button', { name: 'Delay synthetic address creation', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('1');
  await dialog.getByRole('button', { name: 'Revoke synthetic receive session', exact: true }).click();
  await dialog.getByRole('button', { name: 'Complete oldest synthetic address', exact: true }).click();
  await dialog.getByRole('button', { name: 'Complete initial synthetic QRs', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Unlock to receive privately', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toHaveCount(0);
  await expect(dialog.locator('img, a[download]')).toHaveCount(0);
});

test('withdrawal advice stays on review and does not disclose the proof by itself', async ({ page }) => {
  await page.getByRole('button', { name: 'Use synthetic matching deposit', exact: true }).click();
  await page.getByRole('button', { name: 'Open synthetic private withdrawal', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount', { exact: true }).fill('1');
  await expect(page.getByTestId('recipient-preparations')).toHaveText('0');
  await expect(page.getByTestId('direct-proof-events')).toHaveText('none');
  await dialog.getByRole('button', { name: 'Review Withdrawal', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Review Withdrawal', exact: true })).toBeVisible();
  await expect(dialog.getByText('This amount matches a deposit in your local history.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('direct-proof-events')).toHaveText('none');
});

test('changing assets in one pool keeps the request but changing pool creates another', async ({ page }) => {
  await page.getByRole('button', { name: 'Open QR freshness checks', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Change synthetic receive asset', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('1');
  await dialog.getByRole('button', { name: 'Change synthetic receive pool', exact: true }).click();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('2');
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
});

test('same-tick new-address activation issues once and hides the previous QR', async ({ page }) => {
  await page.getByRole('button', { name: 'Open QR freshness checks', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Complete initial synthetic QRs', exact: true }).click();
  await expect(dialog.locator('img')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Delay synthetic address creation', exact: true }).click();
  await dialog.getByRole('button', { name: 'Double activate new address', exact: true }).click();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('2');
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toHaveCount(0);
  await expect(dialog.locator('img, a[download]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Complete oldest synthetic address', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('2');
});

test('returning to a request never silently adopts an address issued elsewhere', async ({ page }) => {
  await page.getByRole('button', { name: 'Open QR freshness checks', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Synthetic receive continuity' });
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Public', exact: true }).click();
  await dialog.getByRole('button', { name: 'Replace saved receive address elsewhere', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Private', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'New address unavailable', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toHaveCount(0);
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('1');
  await dialog.getByRole('button', { name: 'Try New Address', exact: true }).click();
  await expect(dialog.getByTestId('receive-rotation-count')).toHaveText('2');
  await expect(dialog.getByRole('button', { name: 'Copy Address', exact: true })).toBeVisible();
});
