import { expect, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";
import { installQuietEventSource } from "../fixtures";

export const privateBalanceE2eEnabled = Boolean(
  process.env.PRIVATE_BALANCE_E2E_SENDER_SECRET &&
    process.env.PRIVATE_BALANCE_E2E_RECIPIENT_SECRET &&
    process.env.PRIVATE_BALANCE_E2E_POOL_ID &&
    process.env.PRIVATE_BALANCE_E2E_MANIFEST_SHA256,
);

export const senderSecret = process.env.PRIVATE_BALANCE_E2E_SENDER_SECRET ?? "";
export const recipientSecret = process.env.PRIVATE_BALANCE_E2E_RECIPIENT_SECRET ?? "";

const PRIVATE_TEST_PASSWORD = "Private-MVP-2026!";

async function json(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export async function installPrivateBalanceNetworkSupport(
  context: BrowserContext,
): Promise<void> {
  await installQuietEventSource(context);
  await context.route("https://api.coingecko.com/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/exchange_rates")) {
      await json(route, { rates: { usd: { value: 1 } } });
      return;
    }
    if (pathname.endsWith("/market_chart")) {
      await json(route, { prices: [[Date.now(), 0.25]] });
      return;
    }
    await json(route, { stellar: { usd: 0.25 }, "usd-coin": { usd: 1 } });
  });
}

export async function importLiveWallet(page: Page, secret: string): Promise<void> {
  if (!secret) throw new Error("Private Balance E2E secret is unavailable.");
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import Existing Wallet" }).click();
  await page.getByPlaceholder("S... or apple banana cherry...").fill(secret);
  await page.getByPlaceholder("Enter password").fill(PRIVATE_TEST_PASSWORD);
  await page.getByPlaceholder("Repeat password").fill(PRIVATE_TEST_PASSWORD);
  await page.getByRole("button", { name: "Unlock & Import" }).click();
  await expect(page.getByText("Your Assets", { exact: true })).toBeVisible({ timeout: 30_000 });
}

/** The integrated home section is the durable Private Payments destination. */
export async function openPrivateBalance(page: Page): Promise<Locator> {
  const region = page.getByRole("region", { name: "Your Private Assets", exact: true });
  await expect(region).toBeVisible({ timeout: 30_000 });
  await expect(region.getByRole("button", { name: /^Open private XLM\./ })).toBeVisible({
    timeout: 30_000,
  });
  return region;
}

/** Reads the verified XLM value from the integrated private-asset row. */
export async function expectPrivateBalance(region: Locator, amount: string): Promise<void> {
  const canonicalAmount = Number(amount).toFixed(7);
  await expect(
    region.getByRole("button", {
      name: new RegExp(`^Open private XLM\\. Ready\\. ${canonicalAmount.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")} XLM$`),
    }),
  ).toBeVisible({ timeout: 180_000 });
}

/**
 * Drives the one-screen setup: hero + disclosure + single consent checkbox +
 * "Turn On", then the live five-step stepper, then the success moment.
 */
export async function setupPrivateBalance(page: Page): Promise<Locator> {
  const region = await openPrivateBalance(page);
  await region.getByRole("button", { name: /^Open private XLM\./ }).click();
  const dialog = page.getByRole("dialog", { name: "Private Payments", exact: true });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Turn On" }).click();
  await expect(dialog.getByText("Private Payments is on")).toBeVisible({ timeout: 180_000 });
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect(region.getByRole("button", { name: /^Open private XLM\. Ready\./ })).toBeVisible({
    timeout: 180_000,
  });
  return region;
}

export async function openPrivateDetails(page: Page, region: Locator): Promise<Locator> {
  await region.getByRole("button", { name: /^Open private XLM\. Ready\./ }).click();
  const asset = page.getByRole("dialog", { name: "XLM", exact: true });
  await expect(asset).toBeVisible();
  await asset.getByRole("button", { name: "Private Payments settings" }).click();
  const details = page.getByRole("dialog", { name: "Private Payments details", exact: true });
  await expect(details).toBeVisible();
  return details;
}

export async function closePrivateDetails(page: Page, details: Locator): Promise<void> {
  await details.getByRole("button", { name: "Close", exact: true }).click();
  await expect(details).toBeHidden();
  const asset = page.getByRole("dialog", { name: "XLM", exact: true });
  await asset.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(asset).toBeHidden();
}

function homeAction(page: Page, name: "Send" | "Receive" | "Add" | "Withdraw"): Locator {
  return page.getByRole("main").getByRole("button", { name, exact: true }).first();
}

export async function openPrivateAdd(page: Page): Promise<Locator> {
  await homeAction(page, "Add").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Add Assets", exact: true })).toBeVisible();
  await dialog.getByRole("tablist", { name: "Where to add funds" })
    .getByRole("tab", { name: "Private", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Review Add Funds", exact: true })).toBeVisible();
  return dialog;
}

export async function openPrivateSend(page: Page): Promise<Locator> {
  await homeAction(page, "Send").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Send Payment", exact: true })).toBeVisible();
  await dialog.getByRole("tablist", { name: "Send type" })
    .getByRole("tab", { name: "Private", exact: true }).click();
  await expect(dialog.getByLabel("Recipient Address", { exact: true })).toBeVisible();
  return dialog;
}

export async function openPrivateReceive(page: Page): Promise<Locator> {
  await homeAction(page, "Receive").click();
  const dialog = page.getByRole("dialog", { name: "Receive Funds", exact: true });
  await dialog.getByRole("tablist", { name: "Receive address type" })
    .getByRole("tab", { name: "Private", exact: true }).click();
  await expect(dialog.getByAltText(/receive address QR code$/)).toBeVisible({
    timeout: 30_000,
  });
  return dialog;
}

export async function openPrivateWithdraw(page: Page): Promise<Locator> {
  const action = homeAction(page, "Withdraw");
  await expect(action).toBeVisible({ timeout: 180_000 });
  await action.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Withdraw Funds", exact: true })).toBeVisible({
    timeout: 180_000,
  });
  return dialog;
}

/**
 * Runs the Details → Refresh affordance (the card itself stays silent when
 * healthy — the explicit sync button is gone).
 */
export async function refreshPrivateBalance(page: Page, region: Locator): Promise<void> {
  const details = await openPrivateDetails(page, region);
  const refreshRow = details.getByRole("button", { name: "Check for new private activity" });
  await expect(refreshRow).toBeEnabled({ timeout: 120_000 });
  await refreshRow.click();
  await expect(refreshRow).toContainText("Refresh", { timeout: 180_000 });
  await closePrivateDetails(page, details);
}

/** Refreshes until the verified balance reads `amount` (incoming payments). */
export async function expectBalanceAfterRefresh(
  page: Page,
  region: Locator,
  amount: string,
): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await refreshPrivateBalance(page, region);
    try {
      await expectPrivateBalance(region, amount);
      return;
    } catch {
      // The network may not have caught up yet — refresh once more.
    }
  }
  await expectPrivateBalance(region, amount);
}
