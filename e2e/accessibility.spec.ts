import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { BRAND_NAME } from "../src/lib/brand";
import {
  importTestWallet,
  installNetworkFixtures,
  installQuietEventSource,
  testPassword,
  testPayer,
} from "./fixtures";

test.beforeEach(async ({ context }) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
});

async function expectAccessibleSurface(
  page: Page,
  label: string,
  browserName: string,
): Promise<void> {
  const { clientWidth, scrollWidth, viewport } = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
  }));
  if (clientWidth < 768) await expectMobileContainment(page, label);
  expect(scrollWidth, `${label} must not overflow horizontally`).toBeLessThanOrEqual(clientWidth);
  expect(viewport).not.toContain("maximum-scale=1");
  expect(viewport).not.toContain("user-scalable=no");
  // An auto-dismissal can begin after settleMotion snapshots active animations.
  // Page audits wait for notification expiry; the component gate separately
  // audits visible resting toasts in both themes and tests their full lifecycle.
  await expect(page.locator('.app-safe-toast > div')).toHaveCount(0);
  const disabledRules: string[] = [];
  if (browserName === "webkit") {
    // axe/WebKit resolves transparent blurred backgrounds as opaque light
    // layers. Chromium remains the authoritative automated contrast gate.
    disabledRules.push("color-contrast");
  }
  await settleMotion(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .disableRules(disabledRules)
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(blocking.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(node => ({
    tag: node.html.match(/^<([a-z]+)/)?.[1],
    classes: node.html.match(/class="([^"]*)"/)?.[1],
    contrast: node.any.filter(check => check.id === 'color-contrast').map(check => ({
      foreground: check.data?.fgColor, background: check.data?.bgColor, ratio: check.data?.contrastRatio,
    })),
    targetSize: node.any.filter(check => check.id === 'target-size').map(check => ({
      width: check.data?.width, height: check.data?.height, minimum: check.data?.minSize, reason: check.data?.messageKey,
      overlapping: check.relatedNodes?.map(related => ({ tag: related.html.match(/^<([a-z]+)/)?.[1], classes: related.html.match(/class="([^"]*)"/)?.[1] })),
    })),
  })) })), `${label} has blocking accessibility violations`).toEqual([]);
}

/** Overlays crossfade in; scan the resting surface, not a translucent frame. */
async function settleMotion(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

async function expectMobileContainment(page: Page, label: string): Promise<void> {
  const measure = () => page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const escaped: string[] = [];
    const describe = (element: Element) => {
      const html = element as HTMLElement;
      const rect = html.getBoundingClientRect();
      // Structural diagnostics only: never serialize wallet text into failures.
      const caption = ['Amount', 'Memo (Optional)', 'Recipient Address or Federation'].find(value => element.querySelector('label')?.textContent === value) ?? '';
      return `${element.tagName.toLowerCase()}.${String(element.className).split(/\s+/).slice(0, 4).join('.')} ${caption} [${Math.round(rect.left)}…${Math.round(rect.right)}; ${html.clientWidth}/${html.scrollWidth}]`;
    };

    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      if (element.classList.contains("sr-only")) continue;
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if ((rect.bottom < 0 || rect.top > innerHeight) && !element.closest('[data-modal-shell]')) continue;
      const style = getComputedStyle(element);
      if (style.pointerEvents === "none" && !element.textContent?.trim()) continue;
      const allowsHorizontalScroll =
        element.dataset.mobileScroll === "true" ||
        style.overflowX === "auto" ||
        style.overflowX === "scroll";
      let ancestor = element.parentElement;
      let insideIntentionalOverflow = false;
      while (ancestor) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (
          ancestor.dataset.mobileScroll === "true" ||
          ancestor.dataset.mobileOverflow === "true" ||
          ancestorStyle.overflowX === "auto" ||
          ancestorStyle.overflowX === "scroll"
        ) {
          insideIntentionalOverflow = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (
        !allowsHorizontalScroll &&
        !insideIntentionalOverflow &&
        element.dataset.mobileOverflow !== "true" &&
        (rect.left < -1 || rect.right > viewportWidth + 1)
      ) {
        escaped.push(describe(element));
      }
      const intentionallyTruncated =
        style.textOverflow === "ellipsis" ||
        element.dataset.mobileTruncate === "true" ||
        element.dataset.mobileOverflow === "true";
      const containsIntentionalOverflow = element.querySelector(
        '[data-mobile-scroll="true"], [data-mobile-truncate="true"], [data-mobile-overflow="true"]',
      );
      if (
        !allowsHorizontalScroll &&
        !intentionallyTruncated &&
        !containsIntentionalOverflow &&
        element.clientWidth > 0 &&
        element.scrollWidth > element.clientWidth + 1
      ) {
        escaped.push(describe(element));
      }
    }
    return [...new Set(escaped)].slice(0, 12);
  });

  await expect.poll(measure, { message: `${label} must not clip or escape mobile content` }).toEqual([]);
}

async function clickPrimaryNavigation(page: Page, name: string): Promise<void> {
  const tabs = page.getByRole("navigation", { name: "Tabs" });
  if (await tabs.isVisible().catch(() => false)) {
    await tabs.getByRole("button", { name, exact: true }).click();
    return;
  }
  await page.getByRole("button", { name: name === "Swap" ? "DEX Swap" : name, exact: true }).click();
}

async function clickLockWallet(page: Page): Promise<void> {
  const direct = page.getByRole("button", { name: "Lock Wallet" });
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
    return;
  }
  await page.getByRole("button", { name: /Open account menu for/ }).click();
  await page.getByRole("menuitem", { name: "Lock Wallet" }).click();
}

async function clickMerchantSection(page: Page, name: string): Promise<void> {
  const mobileNav = page.getByRole("navigation", { name: "Merchant sections" });
  if (await mobileNav.isVisible().catch(() => false)) {
    if (name === "Counter codes") {
      await page.getByRole("button", { name, exact: true }).click();
      return;
    }
    await mobileNav.getByRole("button", { name, exact: true }).click();
    return;
  }
  await page.getByRole("button", { name: name === "Till" ? "Point of Sale" : name, exact: true }).click();
}

async function visitSettingsSubpage(
  page: Page,
  rowName: RegExp,
  heading: string,
  browserName: string,
): Promise<void> {
  await page.getByRole("button", { name: rowName }).click();
  const destination = page.getByRole("heading", { name: heading, exact: true });
  await expect(destination).toBeVisible();
  await expect(destination).toBeInViewport({ ratio: 1 });
  await expect(destination).toBeFocused();
  await expect.poll(() => destination.evaluate(element => {
    const chromeBottom = Math.max(0, ...[...document.querySelectorAll<HTMLElement>('.app-scroll-sticky-top, .app-mobile-sticky-header')]
      .filter(header => header.getBoundingClientRect().height > 0)
      .map(header => header.getBoundingClientRect().bottom));
    return element.getBoundingClientRect().top >= chromeBottom;
  })).toBe(true);
  await expectAccessibleSurface(page, `${heading} settings`, browserName);
  if (heading === 'Network') {
    const draft = page.getByRole('textbox', { name: 'Stellar RPC endpoint' });
    // A real edit begins with the field visible. Check the controlled update
    // independently of Chromium's native keyboard-caret reveal scrolling.
    await draft.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await draft.click();
    await draft.fill('https://rpc.synthetic.invalid');
    await expect(draft).toBeInViewport({ ratio: 1 });
    const scrollPosition = () => page.evaluate(() => [window.scrollY, document.querySelector<HTMLElement>('[data-app-scroll-owner]')?.scrollTop ?? 0]);
    const beforeEdit = await scrollPosition();
    await draft.fill('https://rpc.synthetic.invalidx');
    await expect(draft).toHaveValue('https://rpc.synthetic.invalidx');
    await expect(draft).toBeFocused();
    await expect.poll(scrollPosition).toEqual(beforeEdit);
  }
  await page.getByRole("button", { name: "Back to Settings" }).click();
  await expect(page.getByRole("heading", { name: "Recovery", exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Wallet settings', exact: true })).toBeFocused();
}

async function prepareImportedWallet(
  page: Page,
  browserName: string,
  auditEntrySurfaces = false,
): Promise<void> {
  if ((page.viewportSize()?.width ?? 1024) < 768) {
    await page.setViewportSize({ width: 320, height: 693 });
  }
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });

  if (auditEntrySurfaces) {
    await expect(page.getByRole("heading", { name: "Own your keys. Own your money." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import Existing Wallet" })).toBeVisible();
    await expectAccessibleSurface(page, "onboarding", browserName);
  }

  await importTestWallet(page);
  await expect(page.getByText("Your Assets", { exact: true })).toBeVisible();
  if (auditEntrySurfaces) await expectAccessibleSurface(page, "dashboard", browserName);
}

async function openWalletSettings(page: Page): Promise<void> {
  await clickPrimaryNavigation(page, "Settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

async function enableMerchantMode(page: Page): Promise<void> {
  await openWalletSettings(page);
  await page.getByRole("switch", { name: "Merchant Mode" }).click();
  const setup = page.getByRole("dialog", { name: /Set Up Merchant Mode/ });
  await setup.getByLabel("Shop Name").fill("Accessibility Coffee");
  await setup.getByRole("button", { name: "Continue" }).click();
  await setup.getByRole("button", { name: "Settlement Asset" }).click();
  await page.getByRole("option", { name: /XLM/ }).click();
  await setup.getByRole("switch", { name: "Accept USDC" }).click();
  await expect(setup.getByText("Native — no trustline, no reserve", { exact: true })).toBeVisible();
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect(setup.getByText("Step 3 of 4", { exact: false })).toBeVisible();
  await setup.getByRole("button", { name: "Continue" }).click();
  await setup.getByRole("textbox", { name: "Staff PIN", exact: true }).fill("2468");
  await setup.getByRole("textbox", { name: "Confirm staff PIN", exact: true }).fill("2468");
  await setup.getByRole("button", { name: "Open the Till" }).click();
  await expect(setup).toBeHidden();
  await expect(page.getByText("Till locked · no open shift", { exact: true })).toBeVisible();
}

async function openMerchantSettings(page: Page): Promise<void> {
  const merchantSettingsButton = page.getByRole("button", {
    name: "Merchant settings",
    exact: true,
  });
  if (await merchantSettingsButton.isVisible().catch(() => false)) {
    await merchantSettingsButton.click();
  } else {
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  }
  await expect(page.getByRole("heading", { name: "Merchant settings", exact: true })).toBeVisible();
}

test("ambient backgrounds never widen the narrowest iPhone viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "iphone-webkit", "WebKit mobile regression");
  await page.setViewportSize({ width: 320, height: 693 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/security", { waitUntil: "domcontentloaded" });

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, "ambient backgrounds must not create horizontal page overflow").toBe(
    dimensions.clientWidth,
  );

  const supportedRelease = page
    .getByRole("heading", { name: "Supported release", exact: true })
    .locator("..")
    .locator("p")
    .filter({ hasText: "commit" });
  const releaseText = await supportedRelease.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(releaseText.scrollWidth, "the verification hash must wrap without clipping").toBeLessThanOrEqual(
    releaseText.clientWidth,
  );
});

test("every trust-center document is navigable and accessible", async ({ page, browserName }) => {
  if ((page.viewportSize()?.width ?? 1024) < 768) {
    await page.setViewportSize({ width: 320, height: 693 });
  }

  for (const path of ["/about", "/privacy", "/terms", "/security", "/support", "/changelog"] as const) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator('[aria-label="At a glance"]')).toBeVisible();
    const contents = page.getByRole("navigation", { name: "On this page" });
    await expect(contents).toBeVisible();

    const sections = page.locator("article section[id]");
    const minimumSections = path === "/changelog" ? 2 : 7;
    expect(await sections.count(), `${path} must remain a substantive long-form document`).toBeGreaterThanOrEqual(minimumSections);
    const firstId = await sections.first().getAttribute("id");
    expect(await contents.locator("a").first().getAttribute("href")).toBe(`#${firstId}`);
    await expectAccessibleSurface(page, `${path} trust-center document`, browserName);
  }
});

test("critical wallet screens remain operable and accessible", async ({ page, browserName }) => {
  await prepareImportedWallet(page, browserName, true);

  for (const destination of ["Activity", "Swap", "Contacts"] as const) {
    await clickPrimaryNavigation(page, destination);
    await expect(
      page.getByRole("heading", {
        name: destination === "Swap" && (page.viewportSize()?.width ?? 0) >= 768
          ? "In-App DEX Swap"
          : destination,
        exact: true,
      }),
    ).toBeVisible();
    await expectAccessibleSurface(page, destination.toLowerCase(), browserName);
    if (destination === "Swap") {
      await page.getByRole("button", { name: "Slippage Settings" }).click();
      await expect(page.getByRole("group", { name: "Slippage presets" })).toBeVisible();
      await expectAccessibleSurface(page, "swap slippage settings", browserName);
      await page.getByRole("button", { name: "Slippage Settings" }).click();
    }
  }
  await clickPrimaryNavigation(page, "Home");

  await page.getByRole("button", { name: "Receive", exact: true }).click();
  const receive = page.getByRole("dialog", { name: "Receive Funds" });
  await expect(receive).toBeVisible();
  await expectAccessibleSurface(page, "receive sheet", browserName);
  await receive.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: /Stellar Lumens/ }).first().click();
  const asset = page.getByRole("dialog", { name: /^XLM/ });
  await expect(asset).toBeVisible();
  await expectAccessibleSurface(page, "asset detail sheet", browserName);
  await asset.getByRole("button", { name: "Close", exact: true }).first().click();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  const addAssets = page.getByRole("dialog", { name: "Add Assets" });
  await expect(addAssets).toBeVisible();
  await expectAccessibleSurface(page, "add assets sheet", browserName);
  await addAssets.getByRole("button", { name: "Close" }).click();

  await page.locator("[data-mobile-asset-toolbar]").getByRole("button", { name: "Multi-Send" }).click();
  const multiSend = page.getByRole("dialog", { name: "Multi-Send Disperse" });
  await expect(multiSend).toBeVisible();
  await expectAccessibleSurface(page, "multi-send sheet", browserName);
  await multiSend.getByRole("button", { name: "Close" }).click();

  await clickLockWallet(page);
  await expect(page.getByRole("heading", { name: BRAND_NAME, exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Enter password")).toBeVisible();
  await expectAccessibleSurface(page, "lock screen", browserName);
  await page.getByPlaceholder("Enter password").fill(testPassword);
  await page.getByRole("button", { name: "Unlock Vault" }).click();

  await page.getByRole("button", { name: "Send", exact: true }).click();
  const send = page.getByRole("dialog", { name: "Send Payment" });
  await send.getByPlaceholder("0.00").fill("1");
  await send.getByRole("textbox", { name: "Recipient Address or Federation" }).fill(testPayer);
  const reviewTransfer = send.getByRole("button", { name: "Review Transfer" });
  await expect(reviewTransfer).toBeEnabled({ timeout: 30_000 });
  await reviewTransfer.click();
  const review = page.getByRole("dialog", { name: "Send Payment" });
  await expect(review.getByRole("button", { name: "Confirm Send", exact: true })).toBeVisible();
  await expectAccessibleSurface(page, "send review", browserName);
  await review.getByRole("button", { name: "Back", exact: true }).click();
  await send.getByRole("button", { name: "Close" }).click();
  // Typed amount and recipient: closing asks before discarding them.
  const discard = page.getByRole("dialog", { name: "Discard changes?", exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(send).toBeHidden();
});

test("wallet overlays reflow at 200-percent-equivalent and narrow widths without losing form state", async ({ page, browserName }) => {
  await importTestWallet(page);
  // 1280x900 at 200% browser zoom has a 640x450 CSS layout viewport.
  // This tests reflow, not a physical-device pinch gesture or screen reader.
  await page.setViewportSize({ width: 640, height: 450 });
  await page.getByRole("main").getByRole("button", { name: "Send", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Send Payment", exact: true });
  await dialog.getByLabel("Amount", { exact: true }).fill("1");
  const shell = await dialog.locator("[data-modal-shell]").elementHandle();
  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: 450 });
    await expectAccessibleSurface(page, "zoom-equivalent send", browserName);
    await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue("1");
    expect(await shell!.evaluate(node => node.isConnected)).toBe(true);
    await dialog.getByRole("button", { name: "Close", exact: true }).focus();
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  }
  const touchAction = await page.evaluate(() => getComputedStyle(document.body).touchAction);
  expect(touchAction === "manipulation" || touchAction.split(" ").includes("pinch-zoom")).toBe(true);
  await dialog.getByRole("button", { name: "Close", exact: true }).press("Escape");
  // The typed amount makes the form dirty, so Escape asks first.
  const discard = page.getByRole("dialog", { name: "Discard changes?", exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("critical wallet settings remain operable and accessible", async ({ page, browserName }) => {
  await prepareImportedWallet(page, browserName);
  await openWalletSettings(page);
  for (const category of ["Recovery", "Device Security", "Signing Security", "Privacy & Feedback"]) {
    await expect(page.getByRole("heading", { name: category, exact: true })).toBeVisible();
  }
  await expect(page.getByText("Security & Backup", { exact: true })).toHaveCount(0);
  await expectAccessibleSurface(page, "settings", browserName);

  await page.getByRole("button", { name: /Backup & Recovery/ }).click();
  const backup = page.getByRole("dialog", { name: "Backup & Recovery" });
  await expect(backup).toBeVisible();
  await expectAccessibleSurface(page, "backup and recovery sheet", browserName);
  await backup.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: /Multi-Sig Studio/ }).click();
  const multisig = page.getByRole("dialog", { name: "Multi-Sig Studio" });
  await expect(multisig).toBeVisible();
  await expectAccessibleSurface(page, "multi-signature sheet", browserName);
  await multisig.getByRole("button", { name: "Close" }).click();

  for (const [row, heading] of [
    [/Auto-Lock Timer/, "Auto-Lock Timer"],
    [/Hardware Wallets/, "Hardware Wallets"],
    [/Local XDR Signer/, "Local XDR Signer"],
    [/Primary Display Currency/, "Display Currency"],
    [/Network Testnet/, "Network"],
  ] as const) {
    await visitSettingsSubpage(page, row, heading, browserName);
  }

  await page.getByRole("button", { name: /Imported Account/ }).last().click();
  await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
  await expectAccessibleSurface(page, "accounts settings", browserName);
  await page.getByRole("button", { name: /Add Account/ }).click();
  const addAccount = page.getByRole("dialog", { name: "Add Account" });
  await expect(addAccount).toBeVisible();
  await expectAccessibleSurface(page, "add account sheet", browserName);
  await addAccount.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename Account" });
  await expect(rename).toBeVisible();
  await expectAccessibleSurface(page, "rename account sheet", browserName);
  await rename.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Back to Settings" }).click();

  await page.getByRole("button", { name: /Reset Wallet/ }).click();
  const reset = page.getByRole("dialog", { name: "Erase this wallet?" });
  await expect(reset).toBeVisible();
  await expectAccessibleSurface(page, "reset wallet alert", browserName);
  await reset.getByRole("button", { name: "Cancel" }).click();
});

test("critical merchant screens remain operable and accessible", async ({ page, browserName }) => {
  await prepareImportedWallet(page, browserName);
  await enableMerchantMode(page);
  await expectAccessibleSurface(page, "merchant till", browserName);

  const merchantNav = page.getByRole("navigation", { name: "Merchant sections" });
  for (const destination of ["Orders", "Catalogue", "Invoices", "Customers", "Insights"] as const) {
    await clickMerchantSection(page, destination);
    if (await merchantNav.isVisible().catch(() => false)) {
      await expect(
        merchantNav.getByRole("button", { name: destination, exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
    await expectAccessibleSurface(page, `merchant ${destination.toLowerCase()}`, browserName);
  }

  await clickMerchantSection(page, "Invoices");
  await clickMerchantSection(page, "Counter codes");
  await expectAccessibleSurface(page, "merchant counter codes", browserName);

  await clickMerchantSection(page, "Till");
  await page.getByRole("button", { name: "Open Shift", exact: true }).first().click();
  const shift = page.getByRole("dialog", { name: /Open Shift/ });
  await expect(shift).toBeVisible();
  await expectAccessibleSurface(page, "open shift sheet", browserName);
  await shift.getByRole("button", { name: "Close", exact: true }).click();

  await clickMerchantSection(page, "Catalogue");
  await page.getByRole("button", { name: "New Item", exact: true }).click();
  const item = page.getByRole("dialog", { name: "New Item" });
  await expect(item).toBeVisible();
  await expectAccessibleSurface(page, "new catalogue item sheet", browserName);
  await item.getByRole("button", { name: "Close", exact: true }).click();

  await clickMerchantSection(page, "Invoices");
  await page.getByRole("button", { name: "New Invoice", exact: true }).first().click();
  const invoice = page.getByRole("dialog", { name: "New Invoice" });
  await expect(invoice).toBeVisible();
  await expectAccessibleSurface(page, "new invoice sheet", browserName);
  await invoice.getByLabel("Customer").fill("Synthetic accessibility customer");
  await invoice.getByRole("button", { name: /Free-Text Line/ }).click();
  await invoice.getByLabel("Line description").fill("Synthetic service");
  await invoice.getByLabel("Unit price").fill("12.00");
  await invoice.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.locator("[data-modal-backdrop]")).toHaveCount(0);
  // WebKit's native field scrolling can leave the header partly outside the
  // viewport. Bring it back into view for the page-wide target-size audit.
  if (await merchantNav.isVisible()) {
    await page.getByRole("button", { name: "Open shift", exact: true }).scrollIntoViewIfNeeded();
  }
  await expectAccessibleSurface(page, "populated invoice list", browserName);
  for (const key of ["Enter", " "]) {
    await expect(page.locator("[data-modal-backdrop]")).toHaveCount(0);
    const editButton = page.getByRole("button", { name: /^Edit draft INV-/ });
    if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
      const bounds = await editButton.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    await editButton.focus();
    await expect(editButton).toBeFocused();
    await editButton.press(key);
    const editor = page.getByRole("dialog", { name: "Edit invoice" });
    await expect(editor).toBeVisible();
    await expectAccessibleSurface(page, "edit invoice sheet", browserName);
    await editor.getByRole("button", { name: "Close", exact: true }).click();
  }

  await clickMerchantSection(page, "Counter codes");
  await page.getByRole("button", { name: "New Code", exact: true }).first().click();
  const counterCode = page.getByRole("dialog", { name: "New Counter Code" });
  await expect(counterCode).toBeVisible();
  await expectAccessibleSurface(page, "new counter code sheet", browserName);
  await counterCode.getByRole("button", { name: "Close", exact: true }).click();
});

test("critical merchant settings remain operable and accessible", async ({ page, browserName }) => {
  await prepareImportedWallet(page, browserName);
  await enableMerchantMode(page);
  await openMerchantSettings(page);
  await expectAccessibleSurface(page, "merchant settings", browserName);

  for (const [row, title] of [
    [/^Business Details/, "Business Details"],
    [/^Payment Setup/, "Payment Setup"],
    [/^Accepted Assets/, "Accepted Assets"],
    [/^Settlement Rules/, "Settlement Rules"],
    [/^Tax Calculation/, "Tax"],
    [/^Tax Rates/, "Tax Rates"],
    [/^Tips/, "Tips"],
    [/^This Device/, "This Device"],
  ] as const) {
    await page.getByRole("button", { name: row }).click();
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await expectAccessibleSurface(page, `${title} merchant settings sheet`, browserName);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }

  for (const [row, heading] of [
    [/^Staff & Terminals/, "Staff & This Device"],
    [/^Tax Records/, "Tax Records"],
    [/^Peripherals/, "Peripherals"],
  ] as const) {
    await page.getByRole("button", { name: row }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expectAccessibleSurface(page, `${heading} merchant settings`, browserName);

    if (heading === "Staff & This Device") {
      for (const [action, title, close] of [
        [/^Operator Locking/, "Operator Locking", "Done"],
        [/Add Operator/, "Add Operator", "Done"],
        [/^Manage$/, "On This Shift", "Done"],
        [/^Add Staff$/, "Add Staff", "Close"],
      ] as const) {
        await page.getByRole("button", { name: action }).click();
        const dialog = page.getByRole("dialog", { name: title, exact: true });
        await expect(dialog).toBeVisible();
        await expectAccessibleSurface(page, `${title} merchant sheet`, browserName);
        await dialog.getByRole("button", { name: close, exact: true }).click();
      }
    }

    if (heading === "Tax Records") {
      for (const [action, title] of [
        [/^Reporting Period/, "Reporting Period"],
        [/^Tax Rates/, "Tax Rates"],
        [/^Export Report/, "Export Report"],
        [/^Encrypted Archive/, "Encrypted Archive"],
        [/^Retention/, "Retention"],
        [/^Export History/, "Export History"],
        [/^About Tax Records/, "About Tax Records"],
      ] as const) {
        await page.getByRole("button", { name: action }).click();
        const dialog = page.getByRole("dialog", { name: title, exact: true });
        await expect(dialog).toBeVisible();
        await expectAccessibleSurface(page, `${title} tax records sheet`, browserName);
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
      }
    }

    await page.getByRole("button", { name: "Back to Merchant settings" }).click();
  }

  await page.getByRole("button", { name: /^Turn Off Merchant Mode/ }).click();
  const turnOff = page.getByRole("dialog", { name: /Turn Off Merchant Mode/ });
  await expect(turnOff).toBeVisible();
  await expectAccessibleSurface(page, "turn off Merchant Mode sheet", browserName);
  await turnOff.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("the largest valid native balance remains inside the iPhone dashboard", async ({
  page,
  context,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "webkit" || testInfo.project.name !== "iphone-webkit",
    "This is the focused iPhone WebKit containment gate.",
  );
  await context.unrouteAll({ behavior: "wait" });
  await installQuietEventSource(context);
  await installNetworkFixtures(context, { nativeBalance: "922337203685.4775807" });
  await page.setViewportSize({ width: 320, height: 693 });

  await importTestWallet(page);
  await expect(page.locator(".balance-display-value")).toHaveText("922,337,203,685.4775807");
  for (const width of [320, 393]) {
    await page.setViewportSize({ width, height: width === 320 ? 693 : 852 });
    await expectMobileContainment(page, `${width}px dashboard with a maximum Stellar balance`);
  }
  await page.setViewportSize({ width: 320, height: 693 });
  await page.getByRole("button", { name: /Stellar Lumens/ }).first().click();
  await expectMobileContainment(page, "320px asset detail with a maximum Stellar balance");
});

test("the completed swap receipt remains usable at the narrowest iPhone width", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "webkit" || testInfo.project.name !== "iphone-webkit",
    "This is the focused iPhone WebKit swap receipt gate.",
  );
  await page.setViewportSize({ width: 320, height: 693 });
  await importTestWallet(page);
  await clickPrimaryNavigation(page, "Swap");

  await page.getByLabel("You receive amount").fill("2");
  await expect(page.getByLabel("You pay amount")).toHaveValue("8");
  await page.getByRole("button", { name: "Review Swap" }).click();
  await page.getByRole("button", { name: "Confirm Swap" }).click();
  await expect(page.getByRole("heading", { name: "Swap complete" })).toBeVisible();
  await expectAccessibleSurface(page, "completed swap receipt", browserName);
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "View Activity", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Swap Again", exact: true })).toBeVisible();
});
