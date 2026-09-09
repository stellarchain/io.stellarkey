import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.skip(!process.env.PRIVATE_COMPONENT_FIXTURE_SHA256, 'Use the isolated synthetic component runner.');

test.beforeEach(async ({ page, baseURL }) => {
  const ownedOrigin = new URL(baseURL!).origin;
  const ownedSocketOrigin = ownedOrigin.replace(/^http/, 'ws');
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === ownedOrigin ? route.continue() : route.abort();
  });
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin === ownedSocketOrigin) socket.connectToServer();
    else socket.close();
  });
  await page.goto('/private-component-fixture');
  await page.getByRole('button', { name: 'Open privacy controls' }).click();
  await expect(page.getByRole('dialog', { name: 'Synthetic privacy controls' })).toBeVisible();
});

async function markShell(page: Page) {
  await page.evaluate(async () => {
    const shell = document.querySelector<HTMLElement>('[data-modal-shell]')!;
    const backdrop = document.querySelector<HTMLElement>('[data-modal-backdrop]')!;
    await Promise.all([...shell.getAnimations(), ...backdrop.getAnimations()].map(animation => animation.finished.catch(() => {})));
    shell.dataset.syntheticIdentity = 'retained';
    backdrop.dataset.syntheticIdentity = 'retained';
  });
}

async function stableShell(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('[data-modal-shell]');
    const backdrop = document.querySelector<HTMLElement>('[data-modal-backdrop]');
    const bounds = shell?.getBoundingClientRect();
    return {
      shell: shell?.dataset.syntheticIdentity, backdrop: backdrop?.dataset.syntheticIdentity,
      locked: document.body.style.overflow === 'hidden', focused: !!backdrop?.contains(document.activeElement),
      inert: !!document.querySelector('main')?.closest('[inert]'),
      contained: !!bounds && bounds.left >= -1 && bounds.right <= innerWidth + 1,
    };
  })).toEqual({ shell: 'retained', backdrop: 'retained', locked: true, focused: true, inert: true, contained: true });
}

async function syntheticDelivery(page: Page, name: string) {
  // Network/signing completions can arrive while the background fixture controls are inert.
  await page.getByRole('button', { name, exact: true }).evaluate(element => (element as HTMLButtonElement).click());
}

async function openSigningReview(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Test signing context', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare signing context', exact: true }).click();
  await expect(page.getByText('Your Assets', { exact: true })).toBeVisible();
  await expect(page.getByTestId('signing-ledger-ready')).toHaveText('true');
  await page.getByRole('button', { name: 'Open account menu for Signing account', exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole('menuitem', { name: /Other account/ })).toBeVisible();
  await page.keyboard.press('Control+s');
  const send = page.getByRole('dialog', { name: 'Send Payment', exact: true });
  await expect(send).toBeVisible();
  await markShell(page);
  await send.locator('[data-tabs-root]').evaluate(element => { (element as HTMLElement).dataset.syntheticIdentity = 'retained'; });
  await send.getByPlaceholder('G…, user*domain.com, or tsm…').fill('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
  await send.getByPlaceholder('0.00', { exact: true }).fill('1');
  // Keyboard activation intentionally does not dispatch an outside mousedown.
  await expect(send.getByRole('button', { name: 'Review Transfer', exact: true })).toBeEnabled();
  await send.getByRole('button', { name: 'Review Transfer', exact: true }).press('Enter');
  return send;
}

async function openSigningApproval(page: Page, pauseInitialFocus = false) {
  const send = await openSigningReview(page);
  if (pauseInitialFocus) {
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
  }
  await send.getByRole('button', { name: 'Confirm Send', exact: true }).press('Enter');
  const approval = page.getByRole('dialog', { name: 'Confirm transaction', exact: true });
  await expect(approval).toBeVisible();
  await expect(send.getByRole('tab', { name: 'Public', exact: true, includeHidden: true })).toBeDisabled();
  await expect(send.getByRole('tab', { name: 'Private', exact: true, includeHidden: true })).toBeDisabled();
  if (pauseInitialFocus) return { send, approval };
  await expect.poll(() => approval.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect.poll(() => approval.evaluate(element => element.contains(document.activeElement))).toBe(true);
  return { send, approval };
}

test('Send review mode switch requires activation and resets the unsigned public draft', async ({ page }) => {
  await openSigningReview(page);
  const send = page.locator('[data-modal-backdrop][data-synthetic-identity="retained"]');
  const publicTab = send.getByRole('tab', { name: 'Public', exact: true });
  const privateTab = send.getByRole('tab', { name: 'Private', exact: true });
  await expect(privateTab).toBeVisible();
  await publicTab.focus();
  await publicTab.press('ArrowRight');
  await expect(privateTab).toBeFocused();
  await expect(publicTab).toHaveAttribute('aria-selected', 'true');
  await expect(send.getByText(/Turn on Private Payments/i)).toHaveCount(0);
  await privateTab.press('Enter');
  await expect(privateTab).toHaveAttribute('aria-selected', 'true');
  await expect(privateTab).toBeFocused();
  await expect(send.getByText(/Turn on Private Payments/i).first()).toBeVisible();
  await expect(send.locator('[data-tabs-root]')).toHaveAttribute('data-synthetic-identity', 'retained');
  await stableShell(page);
  await privateTab.press('ArrowLeft');
  await publicTab.press('Space');
  await expect(publicTab).toHaveAttribute('aria-selected', 'true');
  await expect(publicTab).toBeFocused();
  await expect(send.getByPlaceholder('G…, user*domain.com, or tsm…')).toHaveValue('');
  await expect(send.getByPlaceholder('0.00', { exact: true })).toHaveValue('');
  await expect(page.getByTestId('signing-signs')).toHaveText('0');
  await expect(page.getByTestId('signing-posts')).toHaveText('0');
  await stableShell(page);
});

for (const reducedMotion of ['reduce', 'no-preference'] as const) test.describe(`signing context motion ${reducedMotion}`, () => {
test.use({ contextOptions: { reducedMotion } });

test('signing context approval preserves owned focus through its pending initializer', async ({ page }) => {
  const { approval } = await openSigningApproval(page, true);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(reducedMotion === 'reduce');
  await approval.getByLabel('Wallet Password').fill('synthetic signing correct horse battery staple');
  const authorize = approval.getByRole('button', { name: 'Authorize', exact: true });
  await authorize.focus();
  await expect(authorize).toBeFocused();
  // Dispatch the genuine opening frame between focus and Enter. It must not
  // replace the user's newer Authorize focus with the header Close control.
  await page.clock.runFor(17);
  await expect(authorize).toBeFocused();
  await page.keyboard.press('Enter');
  await page.clock.resume();
  await expect(approval).toHaveCount(0);
  await expect(page.getByTestId('signing-signs')).toHaveText('1');
  await expect(page.getByTestId('signing-posts')).toHaveText('1');
  await expect(page.getByRole('dialog', { name: 'Payment Status', exact: true }).getByRole('heading', { name: 'Submission Status Unknown', exact: true })).toBeFocused();
  await stableShell(page);
});

for (const switchAccount of [true, false]) test(`signing context ${switchAccount ? 'rejects changed' : 'retains unchanged'} account during real approval`, async ({ page }) => {
  const { send, approval } = await openSigningApproval(page);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(reducedMotion === 'reduce');
  if (switchAccount) {
    // This is a genuine pointer action. No forced click or provider context setter.
    await page.getByRole('menuitem', { name: /Other account/ }).click();
    await expect(page.getByTestId('signing-account')).toHaveText('Other account');
  }
  await approval.getByLabel('Wallet Password').fill('synthetic signing correct horse battery staple');
  await approval.getByRole('button', { name: 'Authorize', exact: true }).press('Enter');
  await expect(approval).toHaveCount(0);
  if (switchAccount) {
    await expect(send.getByText('Wallet context changed. Review the payment again before signing.', { exact: true })).toBeVisible();
    await expect(send.locator('[data-tabs-root]')).toHaveAttribute('data-synthetic-identity', 'retained');
    await stableShell(page);
    await expect(send.getByRole('tablist', { name: 'Send type' })).toHaveCount(0);
    expect(await send.locator('[role="tab"]').filter({ hasText: 'Private' }).evaluate(element => (element as HTMLButtonElement).disabled)).toBe(true);
    // Supplementary availability transition: restore the provider identity,
    // without treating this synthetic delivery as a permitted user menu path.
    await page.getByText('Restore provider signing account', { exact: true }).evaluate(element => (element as HTMLButtonElement).click());
    await expect(send.getByRole('tab', { name: 'Private', exact: true })).toBeEnabled();
    await expect(send.locator('[data-tabs-root]')).toHaveAttribute('data-synthetic-identity', 'retained');
    await expect(send.getByText('Wallet context changed. Review the payment again before signing.', { exact: true })).toBeVisible();
    await stableShell(page);
    // Cancellation re-enables these existing controls. Audit their settled
    // enabled styles rather than sampling the disabled-opacity transition.
    await expect(send.getByRole('button', { name: 'Back', exact: true })).toHaveCSS('opacity', '1');
    await expect(send.getByRole('button', { name: 'Confirm Send', exact: true })).toHaveCSS('opacity', '1');
    const accessibility = await new AxeBuilder({ page }).include('[data-modal-shell]').analyze();
    expect(accessibility.violations.map(violation => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length }))).toEqual([]);
    await expect(page.getByTestId('signing-signs')).toHaveText('0');
    await expect(page.getByTestId('signing-posts')).toHaveText('0');
    // Intentional fresh-review navigation must allow retry with the retained
    // draft; no arbitrary input mutation is needed to clear cancellation.
    await send.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(send.getByRole('button', { name: 'Review Transfer', exact: true })).toBeEnabled();
    await send.getByRole('button', { name: 'Review Transfer', exact: true }).press('Enter');
    await send.getByRole('button', { name: 'Confirm Send', exact: true }).press('Enter');
    await expect(approval).toBeVisible();
    await approval.getByLabel('Wallet Password').fill('synthetic signing correct horse battery staple');
    await approval.getByRole('button', { name: 'Authorize', exact: true }).press('Enter');
  }
  await expect(page.getByTestId('signing-signs')).toHaveText('1');
  await expect(page.getByTestId('signing-posts')).toHaveText('1');
  await expect(page.getByRole('dialog', { name: 'Payment Status', exact: true }).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Payment Status', exact: true }).getByRole('heading', { name: 'Submission Status Unknown', exact: true })).toBeFocused();
  await stableShell(page);
  await page.getByRole('dialog', { name: 'Payment Status', exact: true }).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(send).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({ locked: document.body.style.overflow === 'hidden', inert: !!document.querySelector('main')?.closest('[inert]') }))).toEqual({ locked: false, inert: false });
});

for (const switchAccount of [true, false]) test(`signing context ${switchAccount ? 'rejects changed' : 'retains unchanged'} account during real preparation`, async ({ page }) => {
  const { send, approval } = await openSigningApproval(page);
  await page.getByText('Hold signing preparation', { exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  await approval.getByLabel('Wallet Password').fill('synthetic signing correct horse battery staple');
  await approval.getByRole('button', { name: 'Authorize', exact: true }).press('Enter');
  await expect(page.getByTestId('signing-stage')).toHaveText('preparation');
  await expect(approval).toHaveCount(0);
  await expect(send.getByRole('button', { name: 'Confirm Send', exact: true })).toBeFocused();
  await send.getByRole('button', { name: 'Confirm Send', exact: true }).press('Enter');
  await send.getByRole('button', { name: 'Confirm Send', exact: true }).press('Space');
  await expect(page.getByTestId('signing-signs')).toHaveText('0');
  await expect(page.getByTestId('signing-posts')).toHaveText('0');
  if (switchAccount) {
    await page.getByRole('menuitem', { name: /Other account/ }).click();
    await expect(page.getByTestId('signing-account')).toHaveText('Other account');
  }
  await page.getByText('Deliver signing preparation', { exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(page.getByTestId('signing-deliveries')).toHaveText('1');
  if (switchAccount) {
    await expect(send.getByText('Wallet context changed. Review the payment again before signing.', { exact: true })).toBeVisible();
    await page.keyboard.press('Tab');
    await stableShell(page);
  } else await expect(page.getByTestId('signing-posts')).toHaveText('1');
  await expect(page.getByTestId('signing-signs')).toHaveText(switchAccount ? '0' : '1');
  await expect(page.getByTestId('signing-posts')).toHaveText(switchAccount ? '0' : '1');
});
});

test('signing preparation gate belongs to the payment rather than a background account refresh', async ({ page }) => {
  const { approval } = await openSigningApproval(page);
  await page.getByText('Hold signing preparation', { exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  const reads = Number(await page.getByTestId('signing-account-reads').textContent());
  await page.getByText('Refresh provider signing balances', { exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  await expect.poll(async () => Number(await page.getByTestId('signing-account-reads').textContent())).toBeGreaterThan(reads);
  await expect(page.getByTestId('signing-stage')).toHaveText('armed');
  await approval.getByLabel('Wallet Password').fill('synthetic signing correct horse battery staple');
  await approval.getByRole('button', { name: 'Authorize', exact: true }).press('Enter');
  await expect(page.getByTestId('signing-stage')).toHaveText('preparation');
  await expect(page.getByTestId('signing-signs')).toHaveText('0');
  await expect(page.getByTestId('signing-posts')).toHaveText('0');
  await page.getByText('Deliver signing preparation', { exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(page.getByTestId('signing-posts')).toHaveText('1');
});

for (const intent of ['pointer', 'overlay']) test(`signing context completion respects newer ${intent} intent`, async ({ page }) => {
  const { send, approval } = await openSigningApproval(page);
  await page.getByText('Hold signing preparation', { exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  await approval.getByLabel('Wallet Password').fill('synthetic signing correct horse battery staple');
  await approval.getByRole('button', { name: 'Authorize', exact: true }).press('Enter');
  await expect(page.getByTestId('signing-stage')).toHaveText('preparation');
  await expect(approval).toHaveCount(0);
  await expect(send.getByRole('button', { name: 'Confirm Send', exact: true })).toBeFocused();
  if (intent === 'pointer') {
    // A real backdrop pointer action deliberately leaves focus unowned while
    // dismissal is blocked by the pending operation; no synthetic blur.
    await send.click({ position: { x: 2, y: 2 } });
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(send).toBeVisible();
    await expect(send.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  } else {
    await page.getByRole('menuitem', { name: 'Add Account', exact: true }).click();
    const newer = page.getByRole('dialog', { name: 'Add Account', exact: true });
    await expect(newer).toBeVisible();
    await expect.poll(() => newer.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.getByText('Deliver signing preparation', { exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(page.getByTestId('signing-posts')).toHaveText('1');
  // DOM structure only: the older Send is intentionally inaccessible while
  // another dialog owns focus, so do not query its hidden accessible name.
  const resultHeading = page.locator('[data-modal-shell] h2').filter({ hasText: 'Submission Status Unknown' });
  await expect(resultHeading).toHaveCount(1);
  expect(await resultHeading.evaluate(element => element === document.activeElement)).toBe(false);
  if (intent === 'overlay') {
    expect(await resultHeading.evaluate(element => !!element.closest('[inert]'))).toBe(true);
    const newer = page.getByRole('dialog', { name: 'Add Account', exact: true });
    await expect.poll(() => newer.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(newer).toHaveCount(0);
  } else expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.keyboard.press('Tab');
  await stableShell(page);
});

test('signing context real network command stays inert during approval', async ({ page }) => {
  const { send, approval } = await openSigningApproval(page);
  // App-level launchers stay quiet while a dialog holds focus: the palette never opens.
  await page.keyboard.press('Control+k');
  const networkChoice = page.getByText('Switch to Mainnet', { exact: true });
  await expect(networkChoice).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Command palette', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('signing-network')).toHaveText('testnet');
  await expect(approval).toBeVisible();
  await approval.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(approval).toHaveCount(0);
  await stableShell(page);
  await expect(page.getByTestId('signing-signs')).toHaveText('0');
  await expect(page.getByTestId('signing-posts')).toHaveText('0');
  await page.keyboard.press('Escape');
  await expect(send).toHaveCount(0);
});

test('signing context keeps a broadcast receipt and its canonical tracking on the originating network', async ({ page }) => {
  const { approval } = await openSigningApproval(page);
  await approval.getByLabel('Wallet Password').fill('synthetic signing correct horse battery staple');
  await approval.getByRole('button', { name: 'Authorize', exact: true }).press('Enter');
  await expect(page.getByTestId('signing-posts')).toHaveText('1');
  await expect(page.getByRole('dialog', { name: 'Payment Status', exact: true }).getByRole('heading', { name: 'Submission Status Unknown', exact: true })).toBeVisible();
  // Supplementary post-broadcast provider delivery. The real network command
  // is separately proved inert, so this is not a claimed menu exploit.
  await page.getByText('Switch provider result network', { exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(page.getByTestId('signing-network')).toHaveText('mainnet');
  // Inspect only the fixed network text node, never the neighboring hash.
  const status = page.getByRole('dialog', { name: 'Payment Status', exact: true });
  expect(await status.locator('p.break-all').evaluate(element => element.firstChild?.textContent === 'testnet')).toBe(true);
  await page.getByText('Confirm canonical synthetic submission', { exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  const sent = page.getByRole('dialog', { name: 'Payment Sent', exact: true });
  await expect(sent.getByRole('heading', { name: 'Payment Confirmed', exact: true })).toBeVisible();
  expect(await sent.getByRole('link', { name: 'View on Explorer', exact: true }).evaluate(element => new URL((element as HTMLAnchorElement).href).hostname === 'testnet.stellarchain.io')).toBe(true);
  await expect(page.getByTestId('signing-signs')).toHaveText('1');
  await expect(page.getByTestId('signing-posts')).toHaveText('1');
});

for (const context of ['account', 'network']) test(`signing context batched ${context} ABA revokes old authority and admits fresh review`, async ({ page }) => {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Test signing context', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare signing context', exact: true }).click();
  await expect(page.getByText('Your Assets', { exact: true })).toBeVisible();
  await expect(page.getByTestId('signing-ledger-ready')).toHaveText('true');
  // Supplementary mounted-provider regression: synthetic batched calls test
  // publication, not the real user control path proved by the menu cases.
  const deliver = (name: string) => page.getByText(name, { exact: true })
    .evaluate(element => (element as HTMLButtonElement).click());
  await deliver('Capture provider signing context');
  await deliver(`Batch provider ${context} roundtrip`);
  await deliver('Check provider signing contexts');
  await expect(page.getByTestId('signing-old-authority')).toHaveText('revoked');
  await expect(page.getByTestId('signing-fresh-authority')).toHaveText('current');
  // A net-zero synthetic batch clears balances without changing the normal
  // refresh effect's dependencies. Use the real Refresh control to rehydrate
  // ledger data; the new authority has already been independently checked.
  await page.getByRole('button', { name: /^(Refresh network data|Refresh)$/ }).filter({ visible: true }).first().click();
  await expect(page.getByTestId('signing-ledger-ready')).toHaveText('true');
  await page.keyboard.press('Control+s');
  const send = page.getByRole('dialog', { name: 'Send Payment', exact: true });
  await expect(send).toBeVisible();
  await send.getByPlaceholder('G…, user*domain.com, or tsm…').fill('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
  await send.getByPlaceholder('0.00', { exact: true }).fill('1');
  await expect(send.getByRole('button', { name: 'Review Transfer', exact: true })).toBeEnabled();
  await send.getByRole('button', { name: 'Review Transfer', exact: true }).press('Enter');
  await send.getByRole('button', { name: 'Confirm Send', exact: true }).press('Enter');
  const approval = page.getByRole('dialog', { name: 'Confirm transaction', exact: true });
  await expect(approval).toBeVisible();
  await approval.getByLabel('Wallet Password').fill('synthetic signing correct horse battery staple');
  await approval.getByRole('button', { name: 'Authorize', exact: true }).press('Enter');
  await expect(page.getByTestId('signing-posts')).toHaveText('1');
});

async function prepareMerchantLifetime(page: Page, pauseLoad = false) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Test merchant lifetime', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare merchant lifetime', exact: true }).click();
  await expect(page.getByTestId('merchant-prepared')).toHaveText('true');
  if (pauseLoad) await page.getByRole('button', { name: 'Pause merchant read', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle merchant provider', exact: true }).click();
  await expect(page.getByTestId(pauseLoad ? 'merchant-stage' : 'merchant-ready')).toHaveText(pauseLoad ? 'read' : 'true');
}

for (const operation of ['load', 'reload']) {
  for (const outcome of ['Deliver', 'Fail']) {
    test(`merchant lifetime revokes delayed ${operation} ${outcome.toLowerCase()} before wallet phase cleanup`, async ({ page }) => {
      await prepareMerchantLifetime(page, operation === 'load');
      if (operation === 'reload') {
        await page.getByRole('button', { name: 'Pause merchant read', exact: true }).click();
        await page.getByRole('button', { name: 'Reload merchant externally', exact: true }).click();
        await expect(page.getByTestId('merchant-stage')).toHaveText('read');
      }
      await page.getByRole('button', { name: 'Revoke merchant vault directly', exact: true }).click();
      await page.getByRole('button', { name: `${outcome} merchant response`, exact: true }).click();
      await expect(page.getByTestId('merchant-delivered')).toHaveText('1');
      await expect(page.getByTestId('merchant-ready')).toHaveText('false');
      await expect(page.getByTestId('merchant-error')).toHaveText('none');
      await expect(page.getByTestId('merchant-issue')).toHaveText('none');
      await expect(page.getByTestId('merchant-phase')).toHaveText('unlocked');
    });
  }
}

test('merchant lifetime preserves a committed write and rejects an old queued action after replacement', async ({ page }) => {
  await prepareMerchantLifetime(page);
  await page.getByRole('button', { name: 'Pause merchant commit', exact: true }).click();
  await page.getByRole('button', { name: 'Write large merchant text', exact: true }).click();
  await expect(page.getByTestId('merchant-stage')).toHaveText('commit');
  await page.getByRole('button', { name: 'Write standard merchant text', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke merchant vault directly', exact: true }).click();
  await page.getByRole('button', { name: 'Replace merchant vault directly', exact: true }).click();
  await expect(page.getByTestId('merchant-vault')).toHaveText('unlocked');
  await page.getByRole('button', { name: 'Deliver merchant response', exact: true }).click();
  await expect(page.getByTestId('merchant-settled')).toHaveText('2');
  await expect(page.getByTestId('merchant-error')).toHaveText('none');
  await page.getByRole('button', { name: 'Toggle merchant provider', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle merchant provider', exact: true }).click();
  await expect(page.getByTestId('merchant-ready')).toHaveText('true');
  await expect(page.getByTestId('merchant-size')).toHaveText('large');
  await page.getByRole('button', { name: 'Write standard merchant text', exact: true }).click();
  await expect(page.getByTestId('merchant-settled')).toHaveText('3');
  await expect(page.getByTestId('merchant-size')).toHaveText('standard');
});

test('merchant lifetime unmount ignores an old reload failure after a new provider succeeds', async ({ page }) => {
  await prepareMerchantLifetime(page);
  await page.getByRole('button', { name: 'Pause merchant read', exact: true }).click();
  await page.getByRole('button', { name: 'Reload merchant externally', exact: true }).click();
  await expect(page.getByTestId('merchant-stage')).toHaveText('read');
  await page.getByRole('button', { name: 'Toggle merchant provider', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle merchant provider', exact: true }).click();
  await expect(page.getByTestId('merchant-ready')).toHaveText('true');
  await page.getByRole('button', { name: 'Fail merchant response', exact: true }).click();
  await expect(page.getByTestId('merchant-delivered')).toHaveText('1');
  await expect(page.getByTestId('merchant-ready')).toHaveText('true');
  await expect(page.getByTestId('merchant-error')).toHaveText('none');
});

test('merchant lifetime resumes in the same provider after direct session replacement', async ({ page }) => {
  await prepareMerchantLifetime(page);
  await page.getByRole('button', { name: 'Revoke merchant vault directly', exact: true }).click();
  await expect(page.getByTestId('merchant-ready')).toHaveText('false');
  await page.getByRole('button', { name: 'Replace merchant vault directly', exact: true }).click();
  await expect(page.getByTestId('merchant-vault')).toHaveText('unlocked');
  await expect(page.getByTestId('merchant-ready')).toHaveText('true');
  await page.getByRole('button', { name: 'Write large merchant text', exact: true }).click();
  await expect(page.getByTestId('merchant-settled')).toHaveText('1');
  await expect(page.getByTestId('merchant-size')).toHaveText('large');
  await page.getByRole('button', { name: 'Revoke merchant vault directly', exact: true }).click();
  await expect(page.getByTestId('merchant-ready')).toHaveText('false');
  await expect(page.getByTestId('merchant-size')).toHaveText('standard');
});

async function damageMerchantLifetime(page: Page) {
  await prepareMerchantLifetime(page);
  await page.getByRole('button', { name: 'Damage synthetic merchant metadata', exact: true }).click();
  await expect(page.getByTestId('merchant-stage')).toHaveText('damaged');
  await page.getByRole('button', { name: 'Reload merchant externally', exact: true }).click();
  await expect(page.getByTestId('merchant-issue')).toHaveText('issue');
}

async function approveMerchantReset(page: Page) {
  await page.getByRole('button', { name: 'Reset merchant recovery', exact: true }).click();
  await expect(page.getByTestId('merchant-authorization')).toHaveText('waiting');
  await page.getByRole('button', { name: 'Approve synthetic merchant reset', exact: true }).click();
}

for (const outcome of ['success', 'failure']) {
  test(`merchant lifetime reset ${outcome} restarts a queued writer acquisition`, async ({ page }) => {
    await prepareMerchantLifetime(page);
    await page.getByRole('button', { name: 'Toggle merchant provider', exact: true }).click();
    await page.getByRole('button', { name: 'Hold competing merchant writer', exact: true }).click();
    await expect(page.getByTestId('merchant-competing-writer')).toHaveText('held');
    await page.getByRole('button', { name: 'Damage synthetic merchant metadata', exact: true }).click();
    await expect(page.getByTestId('merchant-stage')).toHaveText('damaged');
    await page.getByRole('button', { name: 'Toggle merchant provider', exact: true }).click();
    await expect(page.getByTestId('merchant-ready')).toHaveText('true');
    await expect(page.getByTestId('merchant-issue')).toHaveText('issue');
    if (outcome === 'failure') await page.getByRole('button', { name: 'Fail merchant erase', exact: true }).click();
    await approveMerchantReset(page);
    await expect(page.getByTestId('merchant-settled')).toHaveText('1');
    await page.getByRole('button', { name: 'Release competing merchant writer', exact: true }).click();
    await expect(page.getByTestId('merchant-competing-writer')).toHaveText('released');
    await expect.poll(() => page.evaluate(async () =>
      (await navigator.locks.query()).held?.filter(lock => lock.name === 'stellarkey.merchant.writer.v1').length,
    )).toBe(1);
    if (outcome === 'success') {
      await page.getByRole('button', { name: 'Write large merchant text', exact: true }).click();
      await expect(page.getByTestId('merchant-settled')).toHaveText('2');
      await expect(page.getByTestId('merchant-size')).toHaveText('large');
    }
  });
}

test('merchant lifetime reset preserves an already-held writer lease', async ({ page }) => {
  await damageMerchantLifetime(page);
  await page.getByRole('button', { name: 'Hold competing merchant writer', exact: true }).click();
  await expect(page.getByTestId('merchant-competing-writer')).toHaveText('waiting');
  await approveMerchantReset(page);
  await expect(page.getByTestId('merchant-settled')).toHaveText('1');
  await page.getByRole('button', { name: 'Write large merchant text', exact: true }).click();
  await expect(page.getByTestId('merchant-settled')).toHaveText('2');
  await expect(page.getByTestId('merchant-size')).toHaveText('large');
  await expect(page.getByTestId('merchant-competing-writer')).toHaveText('waiting');
});

test('merchant lifetime reset revokes an earlier external reload failure', async ({ page }) => {
  await damageMerchantLifetime(page);
  await page.getByRole('button', { name: 'Pause merchant read', exact: true }).click();
  await page.getByRole('button', { name: 'Reload merchant externally', exact: true }).click();
  await expect(page.getByTestId('merchant-stage')).toHaveText('read');
  await approveMerchantReset(page);
  await expect(page.getByTestId('merchant-settled')).toHaveText('1');
  await page.getByRole('button', { name: 'Fail merchant response', exact: true }).click();
  await expect(page.getByTestId('merchant-delivered')).toHaveText('1');
  await expect(page.getByTestId('merchant-error')).toHaveText('none');
  await expect(page.getByTestId('merchant-issue')).toHaveText('none');
});

test('merchant lifetime replacement settlement wakes a new session without restoring an old reset', async ({ page }) => {
  await damageMerchantLifetime(page);
  await page.getByRole('button', { name: 'Pause merchant replacement', exact: true }).click();
  await approveMerchantReset(page);
  await expect(page.getByTestId('merchant-stage')).toHaveText('replace');
  await page.getByRole('button', { name: 'Replace merchant vault directly', exact: true }).click();
  await expect(page.getByTestId('merchant-vault')).toHaveText('unlocked');
  await expect(page.getByTestId('merchant-ready')).toHaveText('false');
  await page.getByRole('button', { name: 'Deliver merchant response', exact: true }).click();
  await expect(page.getByTestId('merchant-settled')).toHaveText('1');
  await expect(page.getByTestId('merchant-ready')).toHaveText('true');
  await page.getByRole('button', { name: 'Write large merchant text', exact: true }).click();
  await expect(page.getByTestId('merchant-settled')).toHaveText('2');
  await expect(page.getByTestId('merchant-size')).toHaveText('large');
  await expect(page.getByTestId('merchant-error')).toHaveText('none');
});

for (const mode of ['database-open', 'record-read', 'queued-write', 'uncommitted-put']) {
  test(`discovery cancellation fences real IndexedDB ${mode}`, async ({ page }) => {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: `Check discovery ${mode}`, exact: true }).click();
    await expect(page.getByTestId('discovery-storage-result')).toHaveText('passed');
  });
}

for (const mode of ['changed', 'expected-absent', 'matching', 'matching-absent', 'snapshot-copy', 'prefix-copy', 'readback-rollback', 'cache-integration']) {
  test(`public cache atomic range checks real IndexedDB ${mode}`, async ({ page }) => {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: `Check public cache atomic range ${mode}`, exact: true }).click();
    await expect(page.getByTestId('discovery-storage-result')).toHaveText('passed');
  });
}

for (const mode of ['changed', 'expected-absent', 'matching', 'matching-absent']) {
  test(`discovery removal atomically checks real IndexedDB ${mode} snapshot`, async ({ page }) => {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: `Check discovery removal snapshot ${mode}`, exact: true }).click();
    await expect(page.getByTestId('discovery-storage-result')).toHaveText('passed');
  });
}

async function openDiscovery(page: Page) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Test discovery lifecycle', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare discovery runtime', exact: true }).click();
  await expect(page.getByTestId('discovery-wallet-phase')).toHaveText('unlocked');
  await expect(page.getByTestId('discovery-leader')).toHaveText('true');
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('1');
  await expect(page.getByTestId('discovery-identity')).toHaveText('present');
}

test('discovery removal rolls back both real IndexedDB records on cancellation', async ({ page }) => {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Check discovery removal rollback', exact: true }).click();
  await expect(page.getByTestId('discovery-storage-result')).toHaveText('passed');
});

for (const revoke of ['Lock discovery wallet', 'Replace discovery account', 'Replace discovery network', 'Replace discovery deployment', 'Take discovery lease elsewhere']) {
  test(`live discovery provider clears and cancels on ${revoke}`, async ({ page }) => {
    await openDiscovery(page);
    await page.getByRole('button', { name: revoke, exact: true }).click();
    await expect(page.getByTestId('discovery-aborts')).toHaveText('1');
    await expect(page.getByTestId('discovery-identity')).toHaveText('cleared');
    await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
    await expect(page.getByTestId('discovery-settled')).toHaveText('1');
    await expect(page.getByTestId('discovery-identity')).toHaveText('cleared');
    await expect(page.getByTestId('discovery-error')).toHaveText('none');
    await expect(page.getByTestId('discovery-reads')).toHaveText('1');
  });
}

test('live discovery removal drains old work before clearing real storage', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Remove synthetic discovery data', exact: true }).click();
  await expect(page.getByTestId('discovery-aborts')).toHaveText('1');
  await expect(page.getByTestId('discovery-removal')).toHaveText('waiting');
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await expect(page.getByTestId('discovery-reads')).toHaveText('1');
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-removal')).toHaveText('removed');
  await page.getByRole('button', { name: 'Inspect synthetic discovery storage', exact: true }).click();
  await expect(page.getByTestId('discovery-stored')).toHaveText('absent');
  await expect(page.getByTestId('discovery-identity')).toHaveText('cleared');
});

test('live discovery checks fresh lease authority even without a storage event', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Take discovery lease silently', exact: true }).click();
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await expect(page.getByTestId('discovery-identity')).toHaveText('cleared', { timeout: 500 });
  await expect(page.getByTestId('discovery-syncing')).toHaveText('false');
  await expect(page.getByTestId('discovery-error')).toHaveText('none');
});

test('live discovery completed identity is cleared on lock and a fresh unlock can retry', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await page.getByRole('button', { name: 'Lock discovery wallet', exact: true }).click();
  await expect(page.getByTestId('discovery-identity')).toHaveText('cleared');
  await page.getByRole('button', { name: 'Unlock discovery wallet', exact: true }).click();
  await expect(page.getByTestId('discovery-wallet-phase')).toHaveText('unlocked');
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('2');
  await expect(page.getByTestId('discovery-error')).toHaveText('none');
});

test('live discovery replacement waits for draining work and coalesces duplicate refreshes', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Replace discovery deployment', exact: true }).click();
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('1');
  await page.getByRole('button', { name: 'Fail oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await expect(page.getByTestId('discovery-syncing')).toHaveText('true');
  await expect(page.getByTestId('discovery-error')).toHaveText('none');
  await page.getByRole('button', { name: 'Finish newest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('3');
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await expect(page.getByTestId('discovery-syncing')).toHaveText('false');
});

test('live discovery unmount prevents old failures and finalizers from replacing new success', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Toggle discovery provider', exact: true }).click();
  await expect(page.getByTestId('discovery-aborts')).toHaveText('1');
  await page.getByRole('button', { name: 'Toggle discovery provider', exact: true }).click();
  await expect(page.getByTestId('discovery-leader')).toHaveText('true');
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await page.getByRole('button', { name: 'Finish newest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await page.getByRole('button', { name: 'Fail oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-identity')).toHaveText('present');
  await expect(page.getByTestId('discovery-syncing')).toHaveText('false');
  await expect(page.getByTestId('discovery-error')).toHaveText('none');
});

for (const kind of ['proof', 'build']) {
  test(`live discovery removal preserves a pending ${kind} reservation`, async ({ page }) => {
    await openDiscovery(page);
    await page.getByRole('button', { name: `Seed synthetic ${kind} reservation`, exact: true }).click();
    await expect(page.getByTestId('discovery-seeded')).toHaveText('ready');
    await page.getByRole('button', { name: 'Remove synthetic discovery data', exact: true }).click();
    await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
    await expect(page.getByTestId('discovery-removal')).toHaveText('refused');
    await expect(page.getByTestId('discovery-syncing')).toHaveText('false');
    await page.getByRole('button', { name: 'Inspect synthetic discovery storage', exact: true }).click();
    await expect(page.getByTestId('discovery-stored')).toHaveText('present');
  });
}

test('live discovery removal rechecks ownership after its scan drains', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Seed synthetic empty reservation', exact: true }).click();
  await expect(page.getByTestId('discovery-seeded')).toHaveText('ready');
  await page.getByRole('button', { name: 'Remove synthetic discovery data', exact: true }).click();
  await page.getByRole('button', { name: 'Take discovery lease elsewhere', exact: true }).click();
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-removal')).toHaveText('refused');
  await page.getByRole('button', { name: 'Inspect synthetic discovery storage', exact: true }).click();
  await expect(page.getByTestId('discovery-stored')).toHaveText('present');
});

test('live discovery rejects a stale refresh closure after scope replacement', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await page.getByRole('button', { name: 'Replace discovery network', exact: true }).click();
  await page.getByRole('button', { name: 'Start captured discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('2');
  await expect(page.getByTestId('discovery-reads')).toHaveText('1');
  await expect(page.getByTestId('discovery-identity')).toHaveText('cleared');
});

test('live discovery rejects a stale removal closure after scope replacement', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await page.getByRole('button', { name: 'Replace discovery network', exact: true }).click();
  await page.getByRole('button', { name: 'Remove captured discovery data', exact: true }).click();
  await expect(page.getByTestId('discovery-removal')).toHaveText('refused');
});

async function pauseShieldedSync(page: Page, stage: 'init' | 'prefix') {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await page.getByRole('button', { name: 'Seed synthetic empty reservation', exact: true }).click();
  await expect(page.getByTestId('discovery-seeded')).toHaveText('ready');
  await page.getByRole('button', { name: `Pause synthetic shielded ${stage}`, exact: true }).click();
  await page.getByRole('button', { name: 'Start synthetic shielded sync', exact: true }).click();
  await expect(page.getByTestId('discovery-shielded-stage')).toHaveText(stage);
}

test('live discovery replacement survives an old shielded worker response', async ({ page }) => {
  await pauseShieldedSync(page, 'init');
  await page.getByRole('button', { name: 'Replace discovery deployment', exact: true }).click();
  // The replacement runtime has its own empty durable state, so its legitimate
  // queued sync cannot fail simply because this test replaced the context.
  await page.getByRole('button', { name: 'Seed synthetic empty reservation', exact: true }).click();
  await expect(page.getByTestId('discovery-seeded')).toHaveText('ready');
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await expect(page.getByTestId('discovery-identity')).toHaveText('present');
  await page.getByRole('button', { name: 'Release old shielded response', exact: true }).click();
  await expect(page.getByTestId('discovery-shielded-settled')).toHaveText('1');
  await expect(page.getByTestId('discovery-aborts')).toHaveText('0');
  await expect(page.getByTestId('discovery-identity')).toHaveText('present');
  await expect(page.getByTestId('discovery-syncing')).toHaveText('true');
  await page.getByRole('button', { name: 'Finish newest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('2');
  await expect(page.getByTestId('discovery-error')).toHaveText('none');
});

test('live discovery completed replacement is not restarted by an old shielded final storage response', async ({ page }) => {
  await pauseShieldedSync(page, 'prefix');
  await page.getByRole('button', { name: 'Revoke vault without phase update', exact: true }).click();
  await page.getByRole('button', { name: 'Replace vault session without phase update', exact: true }).click();
  await expect(page.getByTestId('discovery-direct-vault')).toHaveText('unlocked');
  await expect(page.getByTestId('discovery-wallet-phase')).toHaveText('unlocked');
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await expect(page.getByTestId('discovery-identity')).toHaveText('present');
  await page.getByRole('button', { name: 'Finish newest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('2');
  await page.getByRole('button', { name: 'Release old shielded response', exact: true }).click();
  await expect(page.getByTestId('discovery-shielded-settled')).toHaveText('1');
  await expect(page.getByTestId('discovery-syncing')).toHaveText('false');
  await expect(page.getByTestId('discovery-aborts')).toHaveText('0');
  await expect(page.getByTestId('discovery-identity')).toHaveText('present');
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await expect(page.getByTestId('discovery-error')).toHaveText('none');
});

test('live discovery rearms completed identity revocation after a direct vault replacement', async ({ page }) => {
  await openDiscovery(page);
  await page.getByRole('button', { name: 'Finish oldest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('1');
  await page.getByRole('button', { name: 'Revoke vault without phase update', exact: true }).click();
  await expect(page.getByTestId('discovery-identity')).toHaveText('cleared');
  await page.getByRole('button', { name: 'Replace vault session without phase update', exact: true }).click();
  await expect(page.getByTestId('discovery-direct-vault')).toHaveText('unlocked');
  await expect(page.getByTestId('discovery-wallet-phase')).toHaveText('unlocked');
  await page.getByRole('button', { name: 'Start discovery scan', exact: true }).click();
  await expect(page.getByTestId('discovery-reads')).toHaveText('2');
  await page.getByRole('button', { name: 'Finish newest discovery page', exact: true }).click();
  await expect(page.getByTestId('discovery-settled')).toHaveText('2');
  await expect(page.getByTestId('discovery-identity')).toHaveText('present');
  await page.getByRole('button', { name: 'Revoke vault without phase update', exact: true }).click();
  await expect(page.getByTestId('discovery-identity')).toHaveText('cleared');
  await expect(page.getByTestId('discovery-syncing')).toHaveText('false');
});

test('default relay recipient is blocked before session creation and can be corrected locally', async ({ page }) => {
  await markShell(page);
  await page.getByRole('tab', { name: 'Relay', exact: true }).click();
  await page.getByRole('button', { name: 'Try default synthetic recipient' }).click();
  await expect(page.getByRole('dialog')).toContainText('A new recipient address is needed');
  await expect(page.getByTestId('relay-creations')).toHaveText('0');
  await expect(page.getByTestId('relay-requests')).toHaveText('0');
  await stableShell(page);
  await page.getByRole('button', { name: 'Use fresh synthetic recipient' }).click();
  await expect(page.getByTestId('relay-requests')).toHaveText('1');
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeEnabled();
});

test('relay preflight preserves the direct form and distinguishes the earlier-payment blocker', async ({ page, browserName }) => {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open synthetic private send' }).click();
  await markShell(page);
  const amount = page.getByLabel('Amount', { exact: true });
  const memo = page.getByLabel('Private Memo (Optional)');
  await amount.fill('1'); await memo.fill('Synthetic memo');
  const review = page.getByRole('button', { name: 'Review Private Send', exact: true });
  await expect(review).toBeEnabled();
  await page.getByRole('button', { name: 'Privacy relay', exact: true }).click();
  await expect(review).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('Ask the recipient to open Receive');
  await expect(page.getByTestId('recipient-preparations')).toHaveText('0');
  await stableShell(page);
  await page.getByRole('button', { name: 'My account', exact: true }).click();
  await expect(review).toBeEnabled();
  await review.click();
  await expect(page.getByRole('dialog')).toContainText('Blocked by an earlier payment');
  await expect(page.getByRole('dialog')).toContainText('This new action has not started');
  await expect(page.getByRole('button', { name: 'Confirm Send', exact: true })).toBeDisabled();
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]')
    .disableRules(browserName === 'webkit' ? ['color-contrast'] : []).analyze();
  expect(axe.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(amount).toHaveValue('1'); await expect(memo).toHaveValue('Synthetic memo');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  // Typed amount and memo: the sheet asks before discarding them.
  const discard = page.getByRole('dialog', { name: 'Discard changes?', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByLabel('Private Recipient', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open synthetic private send' })).toBeFocused();
});

test('a stale direct recipient validation cannot enable relay review', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open synthetic private send' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('1');
  const review = page.getByRole('button', { name: 'Review Private Send', exact: true });
  await expect(review).toBeEnabled();
  await syntheticDelivery(page, 'Delay recipient validation');
  await page.getByRole('button', { name: 'Privacy relay', exact: true }).click();
  await expect(review).toBeDisabled();
  await syntheticDelivery(page, 'Finish recipient validation');
  await expect(review).toBeDisabled();
  await syntheticDelivery(page, 'Resume recipient validation');
  await expect(page.getByRole('dialog')).toContainText('Ask the recipient to open Receive');
  await expect(review).toBeDisabled();
  await page.getByRole('button', { name: 'My account', exact: true }).click();
  await expect(review).toBeEnabled();
  await syntheticDelivery(page, 'Finish recipient validation');
  await expect(review).toBeEnabled();
});

async function openHelperApproval(page: Page) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open synthetic helper', exact: true }).click();
  await expect(page.getByTestId('helper-phase')).toHaveText('ready');
  await syntheticDelivery(page, 'Deliver helper request');
  await syntheticDelivery(page, 'Deliver helper selection');
  await expect(page.getByTestId('helper-phase')).toHaveText('payout');
  await syntheticDelivery(page, 'Deliver helper preparation');
  await expect(page.getByTestId('helper-phase')).toHaveText('prepared');
  await syntheticDelivery(page, 'Deliver helper sign request');
  await expect(page.getByRole('dialog', { name: 'Relay a private payment?' })).toBeVisible();
  // An alert has no close control; the shell focuses the dialog itself.
  await expect(page.getByRole('dialog', { name: 'Relay a private payment?' }).locator('[data-modal-shell]')).toBeFocused();
  await markShell(page);
}

for (const reducedMotion of ['reduce', 'no-preference'] as const) test(`helper approval details reflow at narrow width without obscuring labels or values (${reducedMotion})`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion });
  await page.setViewportSize({ width: 320, height: 568 });
  await openHelperApproval(page);
  const approval = page.getByRole('dialog', { name: 'Relay a private payment?' });
  for (const reducedViewport of [false, true, false]) {
    await page.evaluate(reduced => {
      const viewport = window.visualViewport!;
      if (reduced) {
        Object.defineProperty(viewport, 'height', { configurable: true, value: 360 });
        Object.defineProperty(viewport, 'offsetTop', { configurable: true, value: 40 });
      } else {
        Reflect.deleteProperty(viewport, 'height');
        Reflect.deleteProperty(viewport, 'offsetTop');
      }
      viewport.dispatchEvent(new Event('resize'));
      viewport.dispatchEvent(new Event('scroll'));
    }, reducedViewport);
    await expect.poll(() => approval.evaluate((node, reduced) => {
      const overlay = node.getBoundingClientRect();
      const shell = node.querySelector<HTMLElement>('[data-modal-shell]')!.getBoundingClientRect();
      const style = getComputedStyle(node);
      const viewportMatches = reduced
        ? Math.abs(overlay.top - 40) <= 1 && Math.abs(overlay.height - 360) <= 1
        : Math.abs(overlay.top) <= 1 && Math.abs(overlay.height - innerHeight) <= 1;
      return viewportMatches && shell.top >= overlay.top + parseFloat(style.paddingTop) - 1 &&
        shell.bottom <= overlay.bottom - parseFloat(style.paddingBottom) + 1;
    }, reducedViewport)).toBe(true);
    await page.keyboard.press('Tab');
    await stableShell(page);
  }
  await expect.poll(() => approval.locator('dl').evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return node.scrollWidth <= node.clientWidth + 1 && bounds.left >= 0 && bounds.right <= innerWidth &&
      [...node.children].every(row => {
        const term = row.querySelector('dt')!.getBoundingClientRect();
        const value = row.querySelector('dd')!.getBoundingClientRect();
        return term.right <= value.left + 1 || term.bottom <= value.top + 1;
      });
  })).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('[data-modal-shell]').analyze();
  expect(accessibility.violations.map(violation => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length }))).toEqual([]);
  await approval.getByRole('button', { name: 'Reject', exact: true }).focus();
  await approval.getByRole('button', { name: 'Reject', exact: true }).press('Enter');
  await expect(approval).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow !== 'hidden' &&
    !document.querySelector('main')?.closest('[inert]'))).toBe(true);
});

test('helper accepts exact submit before signature acknowledgement and prevents duplicate submission', async ({ page }) => {
  await openHelperApproval(page);
  await page.getByRole('button', { name: 'Approve and sign', exact: true }).click();
  await expect(page.getByTestId('helper-signs')).toHaveText('1');
  await syntheticDelivery(page, 'Finish synthetic signing');
  await expect(page.getByTestId('helper-phase')).toHaveText('signature-delivered');
  await syntheticDelivery(page, 'Deliver changed helper submit');
  await expect(page.getByTestId('helper-rejects')).toHaveText('1');
  await expect(page.getByTestId('helper-submits')).toHaveText('0');
  await syntheticDelivery(page, 'Deliver duplicate helper submits');
  await expect(page.getByTestId('helper-submits')).toHaveText('1');
  await stableShell(page);
  await syntheticDelivery(page, 'Finish synthetic submission');
  await expect(page.getByRole('dialog')).toBeHidden();
  await syntheticDelivery(page, 'Acknowledge synthetic signature');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('helper duplicate approval clicks sign only once', async ({ page }) => {
  await openHelperApproval(page);
  await page.getByRole('button', { name: 'Approve and sign', exact: true }).evaluate(element => {
    (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click();
  });
  await expect(page.getByTestId('helper-signs')).toHaveText('1');
});

test('helper does not automatically resubmit after an uncertain RPC outcome', async ({ page }) => {
  await openHelperApproval(page);
  await page.getByRole('button', { name: 'Approve and sign', exact: true }).click();
  await syntheticDelivery(page, 'Finish synthetic signing');
  await expect(page.getByTestId('helper-phase')).toHaveText('signature-delivered');
  await syntheticDelivery(page, 'Deliver duplicate helper submits');
  await expect(page.getByTestId('helper-submits')).toHaveText('1');
  await syntheticDelivery(page, 'Fail synthetic submission');
  await expect(page.getByTestId('helper-rejects')).toHaveText('1');
  await syntheticDelivery(page, 'Deliver duplicate helper submits');
  await expect(page.getByTestId('helper-submits')).toHaveText('1');
  await syntheticDelivery(page, 'Acknowledge synthetic signature');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('lost signature acknowledgement preserves exact authorization and never invites another signature', async ({ page, browserName }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHelperApproval(page);
  const approve = page.getByRole('button', { name: 'Approve and sign', exact: true });
  await approve.focus(); await page.keyboard.press('Enter');
  await expect(page.getByTestId('helper-signs')).toHaveText('1');
  await syntheticDelivery(page, 'Finish synthetic signing');
  await expect(page.getByTestId('helper-phase')).toHaveText('signature-delivered');
  await syntheticDelivery(page, 'Lose signature acknowledgement');
  const alert = page.getByRole('dialog').getByRole('alert');
  await expect(alert).toContainText('was signed');
  await expect(alert).toContainText('may still be submitted');
  await expect(alert).not.toContainText('not signed');
  await expect(approve).toBeDisabled();
  await stableShell(page);
  // Scan the settled enabled state, not the prior disabled-opacity frame.
  await expect(page.getByRole('button', { name: 'Dismiss', exact: true })).toHaveCSS('opacity', '1');
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]')
    .disableRules(browserName === 'webkit' ? ['color-contrast'] : []).analyze();
  expect(axe.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await syntheticDelivery(page, 'Deliver duplicate helper submits');
  await expect(page.getByTestId('helper-submits')).toHaveText('1');
  await expect(page.getByTestId('helper-signs')).toHaveText('1');
});

test('helper account replacement cannot be undone by a late signature acknowledgement', async ({ page }) => {
  await openHelperApproval(page);
  await page.getByRole('button', { name: 'Approve and sign', exact: true }).click();
  await syntheticDelivery(page, 'Finish synthetic signing');
  await expect(page.getByTestId('helper-phase')).toHaveText('signature-delivered');
  await syntheticDelivery(page, 'Replace synthetic helper account');
  await expect(page.getByRole('dialog')).toBeHidden();
  await syntheticDelivery(page, 'Acknowledge synthetic signature');
  await syntheticDelivery(page, 'Deliver duplicate helper submits');
  await expect(page.getByTestId('helper-rejects')).toHaveText('2');
  await expect(page.getByTestId('helper-submits')).toHaveText('0');
});

test('live Nostr selection skips comparison without closing the selected session', async ({ page, browserName }) => {
  await markShell(page);
  await page.getByRole('tab', { name: 'Relay', exact: true }).click();
  await page.getByRole('button', { name: 'Find synthetic helpers' }).click();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  const first = page.getByRole('button', { name: /Choose peer 1/ });
  await expect(first).toBeEnabled();
  await first.evaluate(element => { (element as HTMLElement).dataset.syntheticPeer = 'first'; });
  await first.focus();
  await page.getByRole('button', { name: 'Deliver cheaper synthetic offer' }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(first).toHaveAttribute('data-synthetic-peer', 'first');
  await expect(first).toBeFocused();
  await expect(first).not.toContainText('Lowest fee');
  await expect(page.getByRole('button', { name: /Choose peer 2/ })).toContainText('Lowest fee');
  await page.getByRole('button', { name: 'Replace first synthetic quote' }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(first).toHaveAttribute('data-synthetic-peer', 'first');
  await expect(first).toBeFocused();
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]')
    .disableRules(browserName === 'webkit' ? ['color-contrast'] : []).analyze();
  expect(axe.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('relay-selections')).toHaveText('1');
  await expect(page.getByTestId('relay-collection-stopped')).toHaveText('true');
  await expect(page.getByTestId('relay-closed-at-selection')).toHaveText('false');
  await expect(page.getByTestId('relay-session-closed')).toHaveText('false');
  await expect(first).toBeDisabled();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(page.getByTestId('relay-selections')).toHaveText('1');
  await page.getByRole('button', { name: 'Cancel synthetic discovery' }).click();
  await expect(page.getByTestId('relay-session-closed')).toHaveText('true');
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(first).toBeHidden();
  await stableShell(page);
});

test('expired Nostr rows keep their slot while remaining helpers stay selectable', async ({ page }) => {
  await page.getByRole('tab', { name: 'Relay', exact: true }).click();
  await page.getByRole('button', { name: 'Find synthetic helpers' }).click();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await page.getByRole('button', { name: 'Deliver cheaper synthetic offer' }).click();
  const first = page.getByRole('button', { name: /Choose peer 1/ });
  const second = page.getByRole('button', { name: /Choose peer 2/ });
  await first.evaluate(element => { (element as HTMLElement).dataset.syntheticPeer = 'first'; });
  await second.evaluate(element => { (element as HTMLElement).dataset.syntheticPeer = 'second'; });
  await page.getByRole('button', { name: 'Expire first synthetic offer' }).click();
  await expect(first).toHaveAttribute('data-synthetic-peer', 'first');
  await expect(first).toBeDisabled();
  await expect(second).toHaveAttribute('data-synthetic-peer', 'second');
  await expect(second).toBeEnabled();
  await second.click();
  await expect(page.getByTestId('relay-selections')).toHaveText('1');
});

test('Nostr discovery replacement and account changes invalidate old choices', async ({ page }) => {
  await markShell(page);
  await page.getByRole('tab', { name: 'Relay', exact: true }).click();
  await page.getByRole('button', { name: 'Find synthetic helpers' }).click();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Find synthetic helpers' }).click();
  await expect(page.getByTestId('relay-requests')).toHaveText('2');
  await page.getByRole('button', { name: 'Deliver stale synthetic offer' }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeHidden();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Switch synthetic relay account' }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeHidden();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeHidden();
  await expect(page.getByTestId('relay-selections')).toHaveText('0');
  await stableShell(page);
  await page.getByRole('tab', { name: 'Recovery', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open privacy controls' })).toBeFocused();
});

test('cancelling Nostr discovery before session creation closes the late session without publishing', async ({ page }) => {
  await page.getByRole('tab', { name: 'Relay', exact: true }).click();
  await page.getByRole('button', { name: 'Delay synthetic session creation' }).click();
  await page.getByRole('button', { name: 'Find synthetic helpers' }).click();
  await page.getByRole('button', { name: 'Cancel synthetic discovery' }).click();
  await page.getByRole('button', { name: 'Finish synthetic session creation' }).click();
  await expect(page.getByTestId('relay-session-closed')).toHaveText('true');
  await expect(page.getByTestId('relay-requests')).toHaveText('0');
  await expect(page.getByRole('button', { name: /Choose peer/ })).toBeHidden();
});

test('the real chain controller accepts one live choice per step and ignores duplicate taps', async ({ page }) => {
  await page.getByRole('tab', { name: 'Relay', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare synthetic relay chain' }).click();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await page.getByRole('button', { name: /Choose peer 1/ }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeHidden();
  await page.getByRole('button', { name: 'Start approved synthetic chain' }).click();
  await expect(page.getByTestId('relay-requests')).toHaveText('2');
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Double choose first synthetic peer' }).click();
  await expect(page.getByTestId('relay-selections')).toHaveText('1');
  await expect(page.getByTestId('relay-error')).toHaveText('none');
  await page.getByRole('button', { name: 'Finish synthetic payout' }).click();
  await page.getByRole('button', { name: 'Advance synthetic chain step' }).click();
  await expect(page.getByTestId('relay-requests')).toHaveText('3');
  await page.getByRole('button', { name: 'Deliver stale synthetic offer' }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeHidden();
  await page.getByRole('button', { name: 'Deliver synthetic offer', exact: true }).click();
  await expect(page.getByRole('button', { name: /Choose peer 1/ })).toBeEnabled();
  await page.getByRole('button', { name: /Choose peer 1/ }).click();
  await expect(page.getByTestId('relay-selections')).toHaveText('2');
  await page.getByRole('button', { name: 'Cancel synthetic discovery' }).click();
  await expect(page.getByTestId('relay-session-closed')).toHaveText('true');
});

test('the bounded native socket exchanges only synthetic local messages and survives its setup deadline', async ({ page }) => {
  let connection: Parameters<Parameters<typeof page.routeWebSocket>[1]>[0] | undefined;
  let closed = false;
  await page.routeWebSocket('**/synthetic-nostr', socket => {
    connection = socket;
    socket.onMessage(message => {
      if (message === JSON.stringify(['REQ', 'synthetic-native', { kinds: [20004], limit: 1 }])) {
        socket.send(JSON.stringify(['EOSE', 'synthetic-native']));
      }
    });
    socket.onClose(() => { closed = true; });
  });
  await page.getByRole('tab', { name: 'Relay', exact: true }).click();
  await page.getByRole('button', { name: 'Open synthetic native socket' }).click();
  await expect(page.getByTestId('relay-native-socket')).toHaveText('exchanged');
  // Prove the CONNECTING deadline does not become an established-session TTL.
  await page.waitForTimeout(100);
  connection!.send(JSON.stringify(['EOSE', 'synthetic-after-deadline']));
  await expect(page.getByTestId('relay-native-socket')).toHaveText('after deadline');
  await page.getByRole('button', { name: 'Close synthetic native socket' }).click();
  await expect(page.getByTestId('relay-native-socket')).toHaveText('closed');
  await expect.poll(() => closed).toBe(true);
});

test('recovery requires separate consent, survives stale account completion, and keeps the shell', async ({ page, browserName }) => {
  await markShell(page);
  const toggle = page.getByRole('switch', { name: 'Recover outgoing payment details' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('writes')).toHaveText('0');
  await page.getByRole('button', { name: 'Keep recovery enabled' }).click();
  await expect(page.getByRole('button', { name: 'Omit future outgoing details' })).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]')
    .disableRules(browserName === 'webkit' ? ['color-contrast'] : []).analyze();
  expect(axe.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
  await page.getByRole('button', { name: 'Omit future outgoing details' }).click();
  await expect(toggle).toBeDisabled();
  await page.getByRole('button', { name: 'Switch synthetic account' }).click();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Finish pending preference' }).click();
  await expect(page.getByTestId('writes')).toHaveText('1');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await stableShell(page);
  await page.getByRole('button', { name: 'Switch synthetic account' }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open privacy controls' })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('each chain step has an enabled explicit picker and cancellation keeps the shell stable', async ({ page, browserName }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await markShell(page);
  const tabs = page.getByRole('tablist', { name: 'Privacy check panels' });
  for (let index = 0; index < 3; index += 1) {
    await tabs.getByRole('tab', { name: 'Chain', exact: true }).click();
    await tabs.getByRole('tab', { name: 'Recovery', exact: true }).click();
  }
  await tabs.getByRole('tab', { name: 'Chain', exact: true }).click();
  const choose = page.getByRole('button', { name: /Choose peer 1/ });
  await expect(choose).toBeEnabled();
  await expect(page.getByText('Your private fee cap')).toBeVisible();
  // Check settled contrast, not an intermediate color in the rapid-tab test.
  await tabs.evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
  });
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]')
    .disableRules(browserName === 'webkit' ? ['color-contrast'] : []).analyze();
  expect(axe.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
  await choose.focus();
  await page.keyboard.press('Enter');
  await expect(choose).toBeHidden();
  await page.getByRole('button', { name: 'Deliver canonical synthetic result' }).click();
  await expect(choose).toBeEnabled();
  await choose.click();
  await page.getByRole('button', { name: 'Cancel Chain' }).click();
  await expect(page.getByText('Chain stopped locally')).toBeVisible();
  await page.getByRole('button', { name: 'Review another chain' }).click();
  await expect(choose).toBeEnabled();
  await choose.focus();
  await stableShell(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open privacy controls' })).toBeFocused();
});

test('saving outgoing recovery returns keyboard focus to the surviving switch', async ({ page }) => {
  await markShell(page);
  const toggle = page.getByRole('switch', { name: 'Recover outgoing payment details' });
  await toggle.click();
  await page.getByRole('button', { name: 'Omit future outgoing details' }).focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeDisabled();
  // Resolve the synthetic save without moving the user's keyboard focus.
  await page.getByRole('button', { name: 'Finish pending preference' }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(toggle).toBeEnabled();
  await expect(toggle).toBeFocused();
  await stableShell(page);
});

test('proof sharing waits for exact explicit consent and durable reservation before disclosure', async ({ page, browserName }) => {
  await markShell(page);
  await page.getByRole('tab', { name: 'Proof', exact: true }).click();
  await page.getByRole('button', { name: 'Start synthetic proof review' }).click();
  const authorize = page.getByRole('button', { name: 'Authorize Proof Sharing' });
  await expect(authorize).toBeEnabled();
  await expect(page.getByTestId('proof-events')).toHaveText('none');
  await expect(page.getByText(/Sharing authorizes the exact payment above/)).toBeVisible();
  await expect(page.getByText('Balance After', { exact: true }).locator('..').getByText('0.99999 XLM', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change synthetic amount' }).click();
  await expect(authorize).toBeDisabled();
  await expect(page.getByTestId('proof-events')).toHaveText('none');
  await page.getByRole('button', { name: 'Change synthetic amount' }).click();
  await expect(authorize).toBeEnabled();
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]')
    .disableRules(browserName === 'webkit' ? ['color-contrast'] : []).analyze();
  expect(axe.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('proof-status')).toHaveText('cancelled');
  await expect(page.getByTestId('proof-events')).toHaveText('none');
  await page.getByRole('button', { name: 'Start synthetic proof review' }).click();
  await authorize.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('proof-status')).toHaveText('shared');
  await expect(page.getByTestId('proof-events')).toHaveText('reserved,shared');
  await page.getByRole('button', { name: 'Start synthetic proof review' }).focus();
  await stableShell(page);
});

test('failed preference writes preserve recovery and keyboard focus without stealing another control', async ({ page }) => {
  await markShell(page);
  const toggle = page.getByRole('switch', { name: 'Recover outgoing payment details' });
  const omit = page.getByRole('button', { name: 'Omit future outgoing details' });
  const reject = page.getByRole('button', { name: 'Reject pending preference' });
  await toggle.click();
  await omit.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeDisabled();
  await reject.evaluate(element => (element as HTMLButtonElement).click());
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('writes')).toHaveText('0');
  await expect(toggle).toBeFocused();
  await stableShell(page);
  await omit.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeDisabled();
  await reject.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeEnabled();
  await expect(reject).toBeFocused();
  await expect(page.getByTestId('writes')).toHaveText('0');
  await stableShell(page);
});
