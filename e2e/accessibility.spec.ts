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
  await expect(page.getByText("Total Portfolio", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("status", { name: "Payment monitoring status" }))
    .toContainText("Foreground monitoring");
  await expectAccessibleSurface(page, "merchant till", browserName);
});
