import { expect, test, type BrowserContext } from '@playwright/test';
import { importTestWallet, installNetworkFixtures, installQuietEventSource } from './fixtures';

// All activity is synthetic and read-only. The runner disables capture, and
// unmatched HTTP/WebSocket requests cannot leave the isolated browser context.
async function activityFixture(context: BrowserContext, baseURL: string) {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === origin.replace('http', 'ws')) socket.connectToServer();
    else socket.close();
  });
  await installQuietEventSource(context);
  await installNetworkFixtures(context);

  let continuationRequests = 0;
  let disposing = false;
  const pending: Array<(status: number) => void> = [];
  const inFlight = new Set<Promise<void>>();
  const record = (id: number, type: string) => ({
    id: String(id), paging_token: String(id), type,
    transaction_hash: 'synthetic-activity-only', transaction_successful: true,
    created_at: new Date(Date.now() - 60_000).toISOString(),
  });
  await context.route('https://horizon-testnet.stellar.org/accounts/*/operations?*', async route => {
    const response = (async () => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      if (!cursor) {
        await route.fulfill({ json: { _embedded: { records: Array.from({ length: 30 }, (_, index) => record(1000 - index, 'synthetic_first_page')) } } });
        return;
      }
      continuationRequests += 1;
      // Reject this cursor without Horizon's built-in 5xx transport retry. This
      // isolates the UI retry boundary. Explicit UI retries remain held until
      // the test advances them, so focus assertions do not race a timer.
      const status = disposing || continuationRequests === 1 ? 400 : await new Promise<number>(resolve => pending.push(resolve));
      await route.fulfill({ status, json: status === 200
        ? { _embedded: { records: [record(900, 'synthetic_older_page')] } }
        : { message: 'Synthetic rejected continuation' } });
    })();
    inFlight.add(response);
    try { await response; } finally { inFlight.delete(response); }
  });
  return {
    count: () => continuationRequests,
    finish: (status: number) => {
      const resolve = pending.shift();
      if (!resolve) throw new Error('Expected a synthetic activity continuation');
      resolve(status);
    },
    dispose: async () => {
      disposing = true;
      for (const resolve of pending.splice(0)) resolve(400);
      await Promise.allSettled(inFlight);
      // Keep all HTTP/WebSocket guards until Playwright closes this isolated
      // context. Removing routes while the page lives could expose a poll.
    },
  };
}

for (const { moveFocus, emptyFilter } of [
  { moveFocus: false, emptyFilter: false },
  { moveFocus: true, emptyFilter: false },
  { moveFocus: false, emptyFilter: true },
]) {
  test(`older activity retains rows, pauses automatic retries, and ${emptyFilter ? 'preserves retry focus with an empty filter' : moveFocus ? 'does not steal moved focus' : 'preserves keyboard retry focus'}`, async ({ page, context, baseURL }) => {
    const fixture = await activityFixture(context, baseURL!);
    try {
      await importTestWallet(page);
      await page.getByRole('button', { name: /^Activity/ }).click();
      const rows = page.getByText('synthetic first page', { exact: true });
      await expect(rows).toHaveCount(30);
      const footer = page.locator('[data-activity-pagination]');
      await footer.scrollIntoViewIfNeeded();
      await expect(footer.getByRole('alert')).toContainText('Could not load older activity');
      const readScroll = () => page.locator('[data-app-scroll-owner]').evaluate(owner =>
        Math.max(owner.scrollTop, document.scrollingElement?.scrollTop ?? 0));
      const initialScroll = await readScroll();
      expect(initialScroll).toBeGreaterThan(300);
      const retry = footer.getByRole('button');
      await expect(retry).toHaveAccessibleName('Retry older activity');
      // Trigger fresh viewport work while the sentinel remains visible. An
      // error must not become an unbounded automatic request/re-render loop.
      await page.evaluate(() => new Promise<void>(resolve => {
        window.dispatchEvent(new Event('resize'));
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      expect(fixture.count()).toBe(1);
      await expect(rows).toHaveCount(30);
      if (emptyFilter) {
        await page.getByRole('button', { name: 'Trustlines', exact: true }).click();
        await expect(rows).toHaveCount(0);
      }
      const originalButton = await retry.elementHandle();
      const initialWidth = await retry.evaluate(button => button.getBoundingClientRect().width);
      await retry.focus();
      await retry.press('Enter');
      await expect.poll(fixture.count).toBe(2);
      await expect(footer.getByRole('status', { name: 'Loading older activity' })).toBeVisible();
      expect(await originalButton!.evaluate(button => button.isConnected && document.activeElement === button)).toBe(true);
      await expect(footer.locator('[data-activity-pagination-action]')).toHaveAttribute('aria-busy', 'true');
      expect(await retry.evaluate(button => button.getBoundingClientRect().width)).toBe(initialWidth);
      await retry.press('Enter');
      expect(fixture.count()).toBe(2);
      fixture.finish(400);
      await expect(footer.getByRole('alert')).toBeVisible();
      await expect(retry).toBeFocused();
      await retry.press('Enter');
      await expect.poll(fixture.count).toBe(3);
      const activityNavigation = page.getByRole('button', { name: /^Activity/ });
      if (moveFocus) await activityNavigation.focus();
      fixture.finish(200);
      await expect(footer.getByRole('status', { name: 'Loading older activity' })).toHaveCount(0);
      expect(await originalButton!.evaluate(button => button.isConnected)).toBe(true);
      await expect(retry).toHaveAttribute('aria-disabled', 'true');
      await expect(footer.getByRole('alert')).toHaveCount(0);
      await expect(moveFocus ? activityNavigation : retry).toBeFocused();
      if (emptyFilter) {
        await expect(page.getByText('No activity found', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'All', exact: true }).click();
      }
      await expect(page.getByText('synthetic older page', { exact: true })).toHaveCount(1);
      await expect(rows).toHaveCount(30);
      if (!moveFocus && !emptyFilter) expect(await readScroll()).toBeGreaterThanOrEqual(initialScroll - 100);
      expect(fixture.count()).toBe(3);
    } finally {
      await fixture.dispose();
    }
  });
}
