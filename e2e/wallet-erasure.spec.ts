import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.skip(!process.env.PRIVATE_COMPONENT_FIXTURE_SHA256, 'Use the isolated synthetic component runner.');

test('incomplete erasure remains truthful, accessible, and retryable', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === origin.replace('http', 'ws')) socket.connectToServer();
    else socket.close();
  });
  await page.goto('/private-component-fixture');
  await page.getByRole('button', { name: 'Test erasure recovery', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Wallet erasure incomplete', exact: true })).toBeVisible();
  await expect(page.getByText(/Your wallet has not been changed|Nothing has been overwritten/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export recovery data' })).toHaveCount(0);
  const violations = (await new AxeBuilder({ page }).include('main').analyze()).violations;
  expect(violations.map(({ id }) => id)).toEqual([]);
  const retry = page.getByRole('button', { name: 'Retry erasure', exact: true });
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('erasure-attempts')).toHaveText('1');
  await expect(retry).toBeDisabled();
  await page.getByRole('button', { name: 'Finish synthetic cleanup' }).click();
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.getByTestId('erasure-attempts')).toHaveText('2');
});
