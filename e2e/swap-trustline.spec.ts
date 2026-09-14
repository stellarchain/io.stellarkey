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
  await page.addInitScript(() => { Object.defineProperty(window, 'EventSource', { value: undefined, configurable: true }); });
  await page.goto('/private-component-fixture');
  await page.getByRole('button', { name: 'Test swap', exact: true }).click();
});

async function prepare(page: Page) {
  await page.getByRole('button', { name: 'Prepare swap checks', exact: true }).click();
  await expect(page.getByTestId('swap-ready')).toHaveText('true');
}

async function authorize(page: Page) {
  await page.getByLabel('Wallet Password', { exact: true }).fill('synthetic swap correct horse battery staple');
  await page.getByRole('button', { name: 'Authorize', exact: true }).click();
}

test('preferred receive assets work without trustlines and MAX reserves the extra XLM and fee', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'You receive asset', exact: true }).click();
  await expect(page.getByRole('option', { name: /EURC/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Trustline included', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'MAX', exact: true }).click();
  await expect(page.getByLabel('You pay amount', { exact: true })).toHaveValue('18.49998');
  await expect(page.getByRole('button', { name: 'Invert Assets', exact: true })).toBeDisabled();
  await expect(page.getByTestId('swap-signs')).toHaveText('0');
  await expect(page.getByTestId('swap-posts')).toHaveText('0');
  const result = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map(({ id, impact }) => ({ id, impact }))).toEqual([]);
});

for (const mode of ['pay', 'receive'] as const) {
  test(`automatic trustline swap supports exact ${mode}, one authorization and pending status`, async ({ page }) => {
    await prepare(page);
    await page.getByLabel(`You ${mode} amount`, { exact: true }).fill(mode === 'pay' ? '2' : '1');
    await page.getByRole('button', { name: 'Review Swap', exact: true }).click();
    await expect(page.getByText('Additional XLM reserve', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Double confirm swap', exact: true }).click();
    await authorize(page);
    await expect(page.getByTestId('swap-posts')).toHaveText('1');
    await expect(page.getByTestId('swap-signs')).toHaveText('1');
    await expect(page.getByRole('heading', { name: 'Swap complete', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirm Swap', exact: true })).toHaveCount(0);
  });
}

test('an existing zero-balance trustline is usable without an extra trustline reserve', async ({ page }) => {
  await page.getByRole('button', { name: 'Use existing swap trustline', exact: true }).click();
  await prepare(page);
  await expect(page.getByText('Trustline included', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'MAX', exact: true }).click();
  await expect(page.getByLabel('You pay amount', { exact: true })).toHaveValue('18.49999');
});

test('insufficient XLM for a trustline stops swap review', async ({ page }) => {
  await page.getByRole('button', { name: 'Use low swap balance', exact: true }).click();
  await prepare(page);
  await page.getByLabel('You pay amount', { exact: true }).fill('0.1');
  await expect(page.getByRole('button', { name: 'Review Swap', exact: true })).toBeDisabled();
  await expect(page.getByTestId('swap-signs')).toHaveText('0');
  await expect(page.getByTestId('swap-posts')).toHaveText('0');
});

for (const reason of ['cancel', 'issuer-approval', 'reserve-change', 'account-change', 'expired-quote'] as const) {
  test(`automatic trustline signing safely refuses ${reason}`, async ({ page }) => {
    await prepare(page);
    await page.getByLabel('You pay amount', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Review Swap', exact: true }).click();
    if (reason === 'issuer-approval') await page.getByRole('button', { name: 'Require swap issuer approval', exact: true }).click();
    if (reason === 'reserve-change') await page.getByRole('button', { name: 'Raise swap reserve', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm Swap', exact: true }).click();
    const approval = page.getByRole('dialog', { name: 'Confirm transaction', exact: true });
    await expect(approval).toBeVisible();
    if (reason === 'cancel') await approval.getByRole('button', { name: 'Cancel', exact: true }).click();
    else if (reason === 'account-change') {
      await page.getByRole('button', { name: 'Replace swap account', exact: true })
        .evaluate(element => (element as HTMLButtonElement).click());
      // The outer password prompt remains available; approval must not revive
      // the old account's swap or the unmounted form's authorization.
      await authorize(page);
    } else {
      if (reason === 'expired-quote') await page.evaluate(() => {
        const now = Date.now;
        Date.now = () => now() + 31_000;
      });
      await authorize(page);
    }
    await expect(approval).toHaveCount(0);
    if (reason !== 'account-change') await expect(page.getByRole('button', { name: 'Review Swap', exact: true })).toBeVisible();
    if (reason === 'reserve-change') await expect(page.getByText('An additional 0.6 XLM stays reserved, not spent. It becomes available when you remove the empty trustline.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('swap-signs')).toHaveText('0');
    await expect(page.getByTestId('swap-posts')).toHaveText('0');
  });
}
