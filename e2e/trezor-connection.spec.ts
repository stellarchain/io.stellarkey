import { expect, test } from '@playwright/test';
import { installNetworkFixtures, installQuietEventSource } from './fixtures';

test('the installed Trezor client loads the Suite Web bootstrap through the production CSP', async ({ page, context }) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
  // Exercise the real thin client with a local synthetic approval surface.
  // No device is connected and no address or signing response is returned.
  await context.route('https://suite.trezor.io/web/connect-popup/**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Synthetic Suite bootstrap</title>',
  }));
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Connect Trezor\b/ }).click();
  const loaded = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.origin === 'https://suite.trezor.io'
      && url.pathname === '/web/connect-popup/bootstrap.html';
  });
  await page.getByRole('button', { name: 'Connect with Trezor Connect', exact: true }).click();
  await loaded;
  await expect.poll(() => page.frames().some(frame =>
    frame.url().startsWith('https://suite.trezor.io/web/connect-popup/bootstrap.html'))).toBe(true);
  await expect(page.getByRole('heading', { name: 'Connect your Trezor', exact: true })).toBeVisible();
  await page.goto('/');
  for (const popup of context.pages().filter(candidate => candidate !== page)) await popup.close();
});
