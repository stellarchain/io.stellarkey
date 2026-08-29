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
  expect(viewport).toContain("maximum-scale=1");
  expect(viewport).toContain("user-scalable=no");
  const disabledRules = ["meta-viewport"];
  if (browserName === "webkit") {
    // axe/WebKit resolves transparent blurred backgrounds as opaque light
    // layers. Chromium remains the authoritative automated contrast gate.
    disabledRules.push("color-contrast");
  }
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // Product requirement: native-feeling installed iOS UI intentionally disables zoom.
    .disableRules(disabledRules)
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(blocking, `${label} has blocking accessibility violations`).toEqual([]);
}

async function expectMobileContainment(page: Page, label: string): Promise<void> {
  const failures = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const escaped: string[] = [];
    const describe = (element: Element) => {
      const html = element as HTMLElement;
      const rect = html.getBoundingClientRect();
      const name =
        html.getAttribute("aria-label") ??
        html.textContent?.replace(/\s+/g, " ").trim().slice(0, 80) ??
        element.tagName.toLowerCase();
      return `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).split(/\s+/).slice(0, 3).join(".")}` : ""} [${Math.round(rect.left)}…${Math.round(rect.right)}; ${html.clientWidth}/${html.scrollWidth}] “${name}”`;
    };

    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      if (element.classList.contains("sr-only")) continue;
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > innerHeight) continue;
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

  expect(failures, `${label} must not clip or escape mobile content`).toEqual([]);
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
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expectAccessibleSurface(page, `${heading} settings`, browserName);
  await page.getByRole("button", { name: "Back to Settings" }).click();
  await expect(page.getByRole("heading", { name: "Recovery", exact: true })).toBeVisible();
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
  const setup = page.getByRole("dialog", { name: /Set up Merchant Mode/ });
  await setup.getByLabel("Shop name").fill("Accessibility Coffee");
  await setup.getByRole("button", { name: "Continue" }).click();
  await setup.getByRole("button", { name: "Settlement asset" }).click();
  await page.getByRole("option", { name: /XLM/ }).click();
  await setup.getByRole("switch", { name: "Accept USDC" }).click();
  await expect(setup.getByText("Native — no trustline, no reserve", { exact: true })).toBeVisible();
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect(setup.getByText("Step 3 of 4", { exact: false })).toBeVisible();
  await setup.getByRole("button", { name: "Continue" }).click();
  await setup.getByRole("textbox", { name: "Staff PIN", exact: true }).fill("2468");
  await setup.getByRole("textbox", { name: "Confirm staff PIN", exact: true }).fill("2468");
  await setup.getByRole("button", { name: "Open the till" }).click();
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

  await page.locator("[data-mobile-asset-toolbar]").getByRole("button", { name: "+ Add Asset" }).click();
  const addAsset = page.getByRole("dialog", { name: "Add Assets" });
  await expect(addAsset).toBeVisible();
  await expectAccessibleSurface(page, "add assets sheet", browserName);
  await addAsset.getByRole("button", { name: "Close" }).click();

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
  await send.getByPlaceholder("G... or user*domain.com").fill(testPayer);
  const reviewTransfer = send.getByRole("button", { name: "Review Transfer" });
  await expect(reviewTransfer).toBeEnabled({ timeout: 30_000 });
  await reviewTransfer.click();
  const review = page.getByRole("dialog", { name: "Review Transfer" });
  await expect(review).toBeVisible();
  await expectAccessibleSurface(page, "send review", browserName);
  await review.getByRole("button", { name: "Back", exact: true }).click();
  await send.getByRole("button", { name: "Close" }).click();
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

  await page.getByRole("button", { name: /G Imported Account/ }).last().click();
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
  const reset = page.getByRole("dialog", { name: /Erase & Reset Wallet/ });
  await expect(reset).toBeVisible();
  await expectAccessibleSurface(page, "reset wallet sheet", browserName);
  await reset.getByRole("button", { name: "Close" }).click();
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
  await page.getByRole("button", { name: "Open shift", exact: true }).first().click();
  const shift = page.getByRole("dialog", { name: /Open shift/ });
  await expect(shift).toBeVisible();
  await expectAccessibleSurface(page, "open shift sheet", browserName);
  await shift.getByRole("button", { name: "Close", exact: true }).click();

  await clickMerchantSection(page, "Catalogue");
  await page.getByRole("button", { name: "New item", exact: true }).click();
  const item = page.getByRole("dialog", { name: "New item" });
  await expect(item).toBeVisible();
  await expectAccessibleSurface(page, "new catalogue item sheet", browserName);
  await item.getByRole("button", { name: "Close", exact: true }).click();

  await clickMerchantSection(page, "Invoices");
  await page.getByRole("button", { name: "New invoice", exact: true }).first().click();
  const invoice = page.getByRole("dialog", { name: "New invoice" });
  await expect(invoice).toBeVisible();
  await expectAccessibleSurface(page, "new invoice sheet", browserName);
  await invoice.getByRole("button", { name: "Close", exact: true }).click();

  await clickMerchantSection(page, "Counter codes");
  await page.getByRole("button", { name: "New code", exact: true }).first().click();
  const counterCode = page.getByRole("dialog", { name: "New counter code" });
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
    [/^Business details/, "Business details"],
    [/^Payment setup/, "Payment setup"],
    [/^Accepted assets/, "Accepted assets"],
    [/^Settlement rules/, "Settlement rules"],
    [/^Tax Calculation/, "Tax"],
    [/^Tax rates/, "Tax rates"],
    [/^Tips/, "Tips"],
    [/^This device/, "This device"],
  ] as const) {
    await page.getByRole("button", { name: row }).click();
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await expectAccessibleSurface(page, `${title} merchant settings sheet`, browserName);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }

  for (const [row, heading] of [
    [/^Staff & terminals/, "Staff & this device"],
    [/^Tax records/, "Tax records"],
    [/^Peripherals/, "Peripherals"],
  ] as const) {
    await page.getByRole("button", { name: row }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expectAccessibleSurface(page, `${heading} merchant settings`, browserName);

    if (heading === "Staff & this device") {
      for (const [action, title, close] of [
        [/^Operator locking/, "Operator locking", "Done"],
        [/Add operator/, "Add operator", "Done"],
        [/^Manage$/, "On this shift", "Done"],
        [/^Add staff$/, "Add staff", "Close"],
      ] as const) {
        await page.getByRole("button", { name: action }).click();
        const dialog = page.getByRole("dialog", { name: title, exact: true });
        await expect(dialog).toBeVisible();
        await expectAccessibleSurface(page, `${title} merchant sheet`, browserName);
        await dialog.getByRole("button", { name: close, exact: true }).click();
      }
    }

    if (heading === "Tax records") {
      for (const [action, title] of [
        [/^Reporting period/, "Reporting period"],
        [/^Tax rates/, "Tax rates"],
        [/^Export report/, "Export report"],
        [/^Encrypted archive/, "Encrypted archive"],
        [/^Retention/, "Retention"],
        [/^Export history/, "Export history"],
        [/^About tax records/, "About tax records"],
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

  await page.getByRole("button", { name: /^Turn off Merchant Mode/ }).click();
  const turnOff = page.getByRole("dialog", { name: /Turn off Merchant Mode/ });
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
  await expect(page.getByRole("button", { name: "View activity", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Swap again", exact: true })).toBeVisible();
});
