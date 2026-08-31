import { expect, test, type Page } from "@playwright/test";
import { MuxedAccount } from "@stellar/stellar-sdk";
import {
  importTestWallet,
  installNetworkFixtures,
  installQuietEventSource,
  testAccount,
  testPassword,
  testPayer,
  type HorizonPayment,
} from "./fixtures";

async function enterAmount(page: Page, keys: string[]): Promise<void> {
  for (const key of keys) {
    await page.getByRole("button", { name: key, exact: true }).first().click();
  }
  await page.getByRole("button", { name: "Add to ticket" }).click();
}

async function openAwaitingCharge(page: Page): Promise<{
  reference: string;
  routingId: string;
  destination: string;
  amount: string;
}> {
  await enterAmount(page, ["1", "00"]);
  await page.getByRole("button", { name: "Charge", exact: true }).click();
  await page.getByRole("dialog", { name: /Add a tip/ }).getByRole("button", { name: "No tip" }).click();
  const dialog = page.getByRole("dialog", { name: /^Charge/ });
  await expect(dialog.getByText("Watching for payment", { exact: true })).toBeVisible();
  const subtitle = (await dialog.getByText(/^Order \d+ · .+$/).textContent()) ?? "";
  const reference = subtitle.split(" · ").at(-1)?.trim() ?? "";
  const alt = (await dialog.locator('img[alt^="Payment request for "]').getAttribute("alt")) ?? "";
  const amount = /^Payment request for ([0-9.]+) XLM$/.exec(alt)?.[1] ?? "";
  const destinationTitle = await dialog
    .getByText("To", { exact: true })
    .locator("..")
    .getByRole("button")
    .getAttribute("title");
  const destination = destinationTitle?.split("\n", 1)[0]?.trim() ?? "";
  const routingId = destination ? MuxedAccount.fromAddress(destination, "0").id() : "";
  expect(reference).not.toBe("");
  expect(amount).not.toBe("");
  expect(routingId).not.toBe("");
  return { reference, routingId, destination, amount };
}

function paymentFor(
  route: { routingId: string; destination: string },
  amount: string,
): HorizonPayment {
  return {
    id: "webkit-payment-1001",
    type: "payment",
    transaction_hash: "b".repeat(64),
    transaction_successful: true,
    created_at: new Date().toISOString(),
    paging_token: String((BigInt(100_001) << BigInt(32)) + BigInt(1)),
    to: testAccount,
    to_muxed: route.destination,
    to_muxed_id: route.routingId,
    from: testPayer,
    asset_type: "native",
    amount,
    transaction: { successful: true },
  };
}

test("iPhone reload catches up and settles an awaiting merchant charge", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "webkit", "This is the focused iPhone WebKit settlement gate.");
  const incoming: HorizonPayment[] = [];
  await installQuietEventSource(context);
  await installNetworkFixtures(context, { incoming });
  await importTestWallet(page);

  await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Merchant Mode" }).click();
  const setup = page.getByRole("dialog", { name: /Set up Merchant Mode/ });
  await setup.getByLabel("Shop name").fill("WebKit Coffee");
  await setup.getByRole("button", { name: "Continue" }).click();
  await setup.getByRole("button", { name: "Settlement asset" }).click();
  await page.getByRole("option", { name: /XLM/ }).click();
  await setup.getByRole("switch", { name: "Accept USDC" }).click();
  await setup.getByRole("button", { name: "Continue" }).click();
  await setup.getByText("Step 3 of 4", { exact: false }).waitFor();
  await setup.getByRole("button", { name: "Continue" }).click();
  await setup.getByRole("textbox", { name: "Staff PIN", exact: true }).fill("2468");
  await setup.getByRole("textbox", { name: "Confirm staff PIN", exact: true }).fill("2468");
  await setup.getByRole("button", { name: "Open the till" }).click();
  await expect(setup).toBeHidden();

  await page.getByRole("button", { name: "Open shift", exact: true }).first().click();
  const opening = page.getByRole("dialog", { name: /Open shift/ });
  await expect(opening.getByLabel("Opening float")).toHaveValue("0");
  await opening.getByRole("button", { name: "Open shift", exact: true }).click();
  await expect(page.getByText(/Shift 1 · Front counter/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();

  const charge = await openAwaitingCharge(page);
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem("stellarkey.merchant-bootstrap.v1");
    return raw ? JSON.parse(raw) : null;
  })).toEqual({ version: 1, enabled: true, configured: true });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem("stellarkey.merchant-bootstrap.v1");
    return raw ? JSON.parse(raw) : null;
  })).toEqual({ version: 1, enabled: true, configured: true });
  await page.getByPlaceholder("Enter password").fill(testPassword);
  await page.getByRole("button", { name: "Unlock Vault" }).click();
  await expect(page.getByText("Your Assets", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "Merchant" }).click();
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await page.getByRole("button", { name: "Show the payment request for order #1001" }).click();
  const restoredCharge = page.getByRole("dialog", { name: /^Charge/ });
  await expect(restoredCharge.getByText("Watching for payment", { exact: true })).toBeVisible();

  incoming.push(paymentFor(charge, charge.amount));
  const paidCharge = page.getByRole("dialog", { name: "Paid", exact: true });
  await expect(paidCharge.getByText("Paid in full", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await paidCharge.getByRole("button", { name: "Close", exact: true }).click();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Enter password").fill(testPassword);
  await page.getByRole("button", { name: "Unlock Vault" }).click();
  await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "Merchant" }).click();
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await expect(page.getByText(/^Paid ·/).first()).toBeVisible();
});
