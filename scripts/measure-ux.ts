import { chromium, devices, expect, type Locator, type Page } from '@playwright/test';
import { importTestWallet, installNetworkFixtures, installQuietEventSource, testPayer, testAccount } from '../e2e/fixtures.ts';

// Synthetic numeric-only lab. No captures, raw errors, request bodies or values.
const baseURL = process.env.UX_BASE_URL ?? 'http://127.0.0.1:3191';
const origin = new URL(baseURL);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('UX lab requires loopback.');
const runs = Number(process.env.UX_RUNS ?? 3);
if (!Number.isSafeInteger(runs) || runs < 2 || runs > 10) throw new Error('UX_RUNS must be 2–10.');
const listSize = Number(process.env.UX_LIST_SIZE ?? 0);
if (![0, 200].includes(listSize)) throw new Error('UX_LIST_SIZE must be 0 or the 200-row stress profile.');
const startupOnly = process.env.UX_STARTUP_ONLY === '1';
if (startupOnly && listSize) throw new Error('Startup calibration does not load wallet fixtures.');
const profiles = ['desktop', 'mobile-4x', 'reduced-motion'];
if (process.env.UX_PROFILE && !profiles.includes(process.env.UX_PROFILE)) throw new Error('Unsupported UX_PROFILE.');
type Sample = Record<string, number | null>;
type Lab = { times: Record<string, number>; cls: number | null; longTaskMax: number | null; eventDurationMax: number | null; startedAt: number };
async function arm(target: Locator, name: string, selector: string, text?: string, minimumMatches = 1) {
  await target.evaluate((element, input) => {
    element.addEventListener('click', () => {
      const lab = (window as typeof window & { __uxLab: Lab }).__uxLab;
      delete lab.times[input.name];
      const start = performance.now();
      const check = () => {
        const matches = [...document.querySelectorAll(input.selector)].filter(node => node.getClientRects().length && (!input.text || node.textContent?.trim() === input.text));
        if (matches.length >= input.minimumMatches) lab.times[input.name] = performance.now() - start;
        else if (performance.now() - start < 30_000) requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }, { capture: true, once: true });
  }, { name, selector, text, minimumMatches });
}
async function readTime(page: Page, name: string) {
  await expect.poll(() => page.evaluate(key => (window as typeof window & { __uxLab: Lab }).__uxLab.times[key] ?? null, name), { timeout: 30_000 }).not.toBeNull();
  return page.evaluate(key => (window as typeof window & { __uxLab: Lab }).__uxLab.times[key], name);
}
function summarize(samples: Sample[]) {
  return Object.fromEntries(Object.keys(samples[0]).map(key => {
    const values = samples.map(sample => sample[key]).filter((value): value is number => value !== null).sort((a,b) => a-b);
    const mid = Math.floor(values.length / 2);
    return [key, values.length ? { median: Number((values.length % 2 ? values[mid] : (values[mid-1]+values[mid])/2).toFixed(2)), slowest: Number(values.at(-1)!.toFixed(2)), n: values.length } : null];
  }));
}
const browser = await chromium.launch();
let phase = 'setup';
try {
  const output: Record<string, unknown> = { source: 'synthetic-local-next-frame-DOM-proxies', browser: browser.version(), runs, listSize, profiles: {} };
  for (const profile of profiles.filter(name => !process.env.UX_PROFILE || process.env.UX_PROFILE === name)) {
    const samples: Sample[] = [];
    for (let run=0; run<runs; run++) {
      const context = await browser.newContext({ baseURL, serviceWorkers: 'block', ...(profile === 'mobile-4x' ? devices['iPhone 13'] : { viewport: { width: 1440, height: 900 } }), reducedMotion: profile === 'reduced-motion' ? 'reduce' : 'no-preference' });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort());
      await context.routeWebSocket(/.*/, socket => {
        const url = new URL(socket.url());
        const local = url.host === origin.host && url.protocol === (origin.protocol === 'https:' ? 'wss:' : 'ws:');
        if (local) socket.connectToServer(); // Next dev bootstrap/HMR only.
        else socket.close();
      });
      await installQuietEventSource(context);
      await installNetworkFixtures(context);
      let submissions = 0;
      await context.route('**/transactions', route => {
        if (route.request().method() !== 'POST') return route.fallback();
        submissions += 1;
        return route.abort(); // Preparation-only lab must never reach broadcast.
      });
      if (listSize) {
        // Deliberately oversized first-page fixture stresses already-loaded list
        // rendering, not network pagination. Synthetic values never leave the lab.
        await context.route('https://horizon-testnet.stellar.org/accounts/*/operations*', route => route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ _embedded: { records: Array.from({ length: listSize }, (_, index) => ({
            id: String(10_000 - index), type: 'payment', created_at: new Date(Date.now() - 60_000 - index * 1_000).toISOString(),
            transaction_successful: true, transaction_hash: String(index + 1).padStart(64, '0'),
            from: testPayer, to: testAccount, amount: '1.0000000', asset_type: 'native',
          })) } }),
        }));
      }
      await context.addInitScript(({ measureStartup }) => {
        const lab: Lab = { times: {}, cls: null, longTaskMax: null, eventDurationMax: null, startedAt: Infinity };
        (window as typeof window & { __uxLab: Lab }).__uxLab = lab;
        if (measureStartup) {
          // Calibrate the coarse webdriver readiness upper bound against a
          // fixed public onboarding control. Never run this observer in the
          // wallet interaction profile or retain a DOM target/value.
          let scheduled = false;
          const observer = new MutationObserver(() => {
            const ready = [...document.querySelectorAll('button')].some(button =>
              button.getClientRects().length && button.textContent?.includes('Import Existing Wallet'));
            if (scheduled || !ready) return;
            scheduled = true;
            observer.disconnect();
            requestAnimationFrame(() => { lab.times.initialOnboardingReady = performance.now(); });
          });
          observer.observe(document, { childList: true, subtree: true });
        }
        if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
          lab.cls = 0;
          new PerformanceObserver(list => { for (const entry of list.getEntries()) { const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number }; if (entry.startTime >= lab.startedAt && !shift.hadRecentInput) lab.cls! += shift.value; } }).observe({ type: 'layout-shift', buffered: true });
        }
        if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
          lab.longTaskMax = 0;
          new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.startTime >= lab.startedAt) lab.longTaskMax = Math.max(lab.longTaskMax!, entry.duration); }).observe({ type: 'longtask', buffered: true });
        }
        if (PerformanceObserver.supportedEntryTypes.includes('event')) {
          lab.eventDurationMax = 0;
          // Duration includes input delay/processing/presentation; this is a
          // synthetic session maximum, not field INP. Never retain DOM targets.
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) if (entry.startTime >= lab.startedAt) {
              lab.eventDurationMax = Math.max(lab.eventDurationMax!, entry.duration);
            }
          }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit & { durationThreshold: number });
        }
      }, { measureStartup: startupOnly });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      if (profile === 'mobile-4x') {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750, connectionType: 'cellular4g' });
      }
      const sample: Sample = {};
      phase = profile + ':initial';
      await page.goto('/app', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: 'Import Existing Wallet' })).toBeVisible({ timeout: 30_000 });
      // Development tooling overlaps mobile navigation; excluded equally before/after.
      // Application overlays remain untouched.
      if (await page.locator('nextjs-portal').count()) await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      sample.coldAppDcl = await page.evaluate(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).domContentLoadedEventEnd);
      sample.coldAppReadyUpperBound = await page.evaluate(() => performance.now());
      if (startupOnly) {
        sample.coldOnboardingReadyDomFrame = await readTime(page, 'initialOnboardingReady');
        Object.assign(sample, await page.evaluate(() => {
          const scripts = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
            .filter(entry => new URL(entry.name).pathname.endsWith('.js'));
          return {
            coldJsResourceCount: scripts.length,
            coldJsEncodedBodyBytes: scripts.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
            coldJsLatestResponseEnd: Math.max(0, ...scripts.map(entry => entry.responseEnd)),
          };
        }));
        samples.push(sample);
        await context.close();
        continue;
      }
      phase = profile + ':fixture';
      await importTestWallet(page, { requirePasswordForSigning: true, readyTimeout: 30_000 });
      if (await page.locator('nextjs-portal').count()) await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      await page.evaluate(() => { const lab = (window as typeof window & { __uxLab: Lab }).__uxLab; lab.startedAt = performance.now(); if (lab.cls !== null) lab.cls = 0; if (lab.longTaskMax !== null) lab.longTaskMax = 0; if (lab.eventDurationMax !== null) lab.eventDurationMax = 0; });
      for (const temperature of ['cold','warm']) {
        phase = profile + ':' + temperature + ':activity';
        const activity = page.getByRole('button', { name: 'Activity', exact: true }).first();
        phase = profile + ':' + temperature + ':activity-arm';
        await arm(activity, 'activity', '[aria-label="Filter by asset"]');
        if (listSize) await arm(activity, 'activity-list', 'main button span', 'Received Payment', listSize);
        phase = profile + ':' + temperature + ':activity-click';
        await activity.click();
        phase = profile + ':' + temperature + ':activity-ready';
        sample[temperature+'ActivityControlsReady'] = await readTime(page, 'activity');
        if (listSize) sample[temperature+'ListReady'] = await readTime(page, 'activity-list');
        phase = profile + ':' + temperature + ':home';
        await page.getByRole('button', { name: 'Home', exact: true }).first().click({ timeout: 5_000 });
        phase = profile + ':' + temperature + ':home-ready';
        await expect(page.getByText('Your Assets', { exact: true })).toBeVisible();
        phase = profile + ':' + temperature + ':asset-details';
        const asset = page.getByRole('main').getByRole('button', { name: /Stellar Lumens/ }).first();
        phase = profile + ':' + temperature + ':asset-arm';
        await arm(asset, 'asset-details', '[role="dialog"] h2', 'XLM');
        phase = profile + ':' + temperature + ':asset-click';
        await asset.click();
        phase = profile + ':' + temperature + ':asset-ready';
        sample[temperature+'AssetDetailsShell'] = await readTime(page, 'asset-details');
        phase = profile + ':' + temperature + ':asset-close';
        const details = page.getByRole('dialog', { name: /^XLM/ });
        await details.getByRole('button', { name: 'Close', exact: true }).first().click();
        await expect(details).toBeHidden();
        phase = profile + ':' + temperature + ':send';
        const trigger = page.getByRole('main').getByRole('button', { name: 'Send', exact: true }).first();
        await arm(trigger, 'send', '[data-modal-shell]');
        await trigger.click();
        const dialog = page.getByRole('dialog', { name: 'Send Payment', exact: true });
        sample[temperature+'SendShell'] = await readTime(page, 'send');
        const privateTab = dialog.getByRole('tab', { name: 'Private', exact: true });
        if (await privateTab.count()) {
          phase = profile + ':' + temperature + ':private';
          const id = await privateTab.getAttribute('id');
          await arm(privateTab, 'private-selected', '[id="'+id+'"][aria-selected="true"]');
          await arm(privateTab, 'private-usable', '[role="dialog"] button', 'Turn On Private Payments');
          await privateTab.click();
          sample[temperature+'PrivateSelected'] = await readTime(page, 'private-selected');
          sample[temperature+'PrivateGateReady'] = await readTime(page, 'private-usable');
          await dialog.getByRole('tab', { name: 'Public', exact: true }).click();
        } else { sample[temperature+'PrivateSelected'] = null; sample[temperature+'PrivateGateReady'] = null; }
        phase = profile + ':' + temperature + ':review';
        await dialog.getByLabel('Amount', { exact: true }).fill('1');
        await dialog.getByLabel('Recipient Address or Federation').fill(testPayer);
        const review = dialog.getByRole('button', { name: 'Review Transfer', exact: true });
        phase = profile + ':' + temperature + ':review-ready';
        await expect(review).toBeEnabled();
        await arm(review, 'review', '[role="dialog"] button', 'Confirm Send');
        phase = profile + ':' + temperature + ':review-feedback';
        await review.click();
        sample[temperature+'FormReview'] = await readTime(page, 'review');
        phase = profile + ':' + temperature + ':review-confirm';
        const confirm = dialog.getByRole('button', { name: 'Confirm Send', exact: true });
        await expect(confirm).toBeVisible();
        await confirm.evaluate(element => element.setAttribute('data-ux-confirm', ''));
        await arm(confirm, 'prepare', '[data-ux-confirm][aria-busy="true"]');
        await confirm.click();
        sample[temperature+'PrepareFeedback'] = await readTime(page, 'prepare');
        const approval = page.getByRole('dialog', { name: 'Confirm transaction', exact: true });
        await expect(approval).toBeVisible();
        await approval.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(approval).toBeHidden();
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(dialog).toBeHidden();
      }
      if (submissions !== 0) throw new Error('Preparation-only lab attempted submission.');
      Object.assign(sample, await page.evaluate(() => { const { cls, longTaskMax, eventDurationMax } = (window as typeof window & { __uxLab: Lab }).__uxLab; return { interactionNonInputShiftSum: cls, interactionLongTaskMax: longTaskMax, interactionEventDurationMax: eventDurationMax }; }));
      samples.push(sample);
      await context.close();
    }
    (output.profiles as Record<string, unknown>)[profile] = { cpuRate: profile === 'mobile-4x' ? 4 : 1, network: profile === 'mobile-4x' ? '150ms RTT / 1.6Mbps down / 0.75Mbps up before navigation; mocked data responses local' : 'local', cache: startupOnly ? 'fresh context; startup-only (no wallet import or warm repeats); routing disables HTTP cache' : 'fresh context; warm repeats in same page; routing disables HTTP cache', summary: summarize(samples), samples };
  }
  process.stdout.write(JSON.stringify(output, null, 2)+'\n');
} catch {
  throw new Error('Synthetic UX lab failed at fixed phase '+phase+'; raw browser errors deliberately suppressed.');
} finally { await browser.close(); }
