import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
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
      const name =
        html.getAttribute("aria-label") ??
        html.textContent?.replace(/\s+/g, " ").trim().slice(0, 80) ??
        element.tagName.toLowerCase();
      return `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).split(/\s+/).slice(0, 3).join(".")}` : ""} “${name}”`;
    };

    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > innerHeight) continue;
      const style = getComputedStyle(element);
      if (style.position === "fixed" || style.position === "sticky") {
        if (rect.left < -1 || rect.right > viewportWidth + 1) escaped.push(describe(element));
      }
      const allowsHorizontalScroll =
        element.dataset.mobileScroll === "true" ||
        style.overflowX === "auto" ||
        style.overflowX === "scroll";
      const intentionallyTruncated = style.textOverflow === "ellipsis";
      if (
        !allowsHorizontalScroll &&
        !intentionallyTruncated &&
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
  await page.getByRole("button", { name, exact: true }).click();
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

test("critical wallet and merchant screens remain operable and accessible", async ({ page, browserName }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Own your keys. Own your money." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import Existing Wallet" })).toBeVisible();
  await expectAccessibleSurface(page, "onboarding", browserName);

  await importTestWallet(page);
  await expect(page.getByText("Your Assets", { exact: true })).toBeVisible();
  await expectAccessibleSurface(page, "dashboard", browserName);

  await clickLockWallet(page);
  await expect(page.getByRole("heading", { name: "Wallet", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Enter password")).toBeVisible();
  await expectAccessibleSurface(page, "lock screen", browserName);
  await page.getByPlaceholder("Enter password").fill(testPassword);
  await page.getByRole("button", { name: "Unlock Vault" }).click();

  await page.getByRole("button", { name: "Send", exact: true }).click();
  const send = page.getByRole("dialog", { name: "Send Payment" });
  await send.getByPlaceholder("0.00").fill("1");
  await send.getByPlaceholder("G... or user*domain.com").fill(testPayer);
  await send.getByRole("button", { name: "Review Transfer" }).click();
  const review = page.getByRole("dialog", { name: "Review Transfer" });
  await expect(review).toBeVisible();
  await expectAccessibleSurface(page, "send review", browserName);
  await review.getByRole("button", { name: "Back", exact: true }).click();
  await send.getByRole("button", { name: "Close" }).click();

  await clickPrimaryNavigation(page, "Settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  for (const category of ["Recovery", "Device Security", "Signing Security", "Privacy & Feedback"]) {
    await expect(page.getByRole("heading", { name: category, exact: true })).toBeVisible();
  }
  await expect(page.getByText("Security & Backup", { exact: true })).toHaveCount(0);
  await expectAccessibleSurface(page, "settings", browserName);

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
  await expectAccessibleSurface(page, "merchant till", browserName);
});

test("the largest valid native balance remains inside the iPhone dashboard", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "webkit", "This is the focused iPhone WebKit containment gate.");
  await context.unrouteAll({ behavior: "wait" });
  await installQuietEventSource(context);
  await installNetworkFixtures(context, { nativeBalance: "922337203685.4775807" });
  await page.setViewportSize({ width: 320, height: 693 });

  await importTestWallet(page);
  await expect(page.getByText("922,337,203,685.4775807", { exact: true })).toBeVisible();
  await expectMobileContainment(page, "dashboard with a maximum Stellar balance");
});
