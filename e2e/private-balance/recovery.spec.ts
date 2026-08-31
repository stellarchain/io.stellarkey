import { expect, test } from "@playwright/test";
import {
  importLiveWallet,
  installPrivateBalanceNetworkSupport,
  openPrivateDetails,
  openPrivateBalance,
  privateBalanceE2eEnabled,
  senderSecret,
  setupPrivateBalance,
} from "./helpers";

test.use({ serviceWorkers: "block" });
test.skip(!privateBalanceE2eEnabled, "Requires the isolated Private Balance testnet fixture runner.");
test.setTimeout(300_000);

test("runs a verified recovery scan directly through the selected RPC", async ({ context, page }) => {
  await installPrivateBalanceNetworkSupport(context);
  await importLiveWallet(page, senderSecret);
  const region = await setupPrivateBalance(page);

  const details = await openPrivateDetails(page, region);
  await details.getByRole("button", { name: "Restore or rescan safely" }).click();
  const recovery = page.getByRole("dialog", { name: "Recovery", exact: true });
  await expect(recovery).toBeVisible();

  const rpcRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).origin === "https://soroban-testnet.stellar.org",
    { timeout: 120_000 },
  );
  await recovery.getByRole("button", { name: "Check for New Activity" }).click();
  await rpcRequest;
  await expect(recovery.getByRole("button", { name: "Check for New Activity" })).toBeEnabled({
    timeout: 180_000,
  });
  await recovery.getByRole("button", { name: "Close", exact: true }).click();
  const asset = page.getByRole("dialog", { name: "XLM", exact: true });
  await asset.getByRole("button", { name: "Close", exact: true }).last().click();

  await expect(region.getByRole("button", { name: /^Open private XLM\. Ready\./ })).toBeVisible({
    timeout: 180_000,
  });
  await openPrivateDetails(page, region);
  await expect(
    page.getByRole("status", { name: "Private payments status: Up to date" }),
  ).toBeVisible({ timeout: 180_000 });
});

test("switches the selected RPC and verifies Private Payments through it", async ({ context, page }) => {
  const alternateRpc = "https://private-balance-rpc.test";
  let alternateRequests = 0;
  await installPrivateBalanceNetworkSupport(context);
  await context.route(`${alternateRpc}/**`, async (route) => {
    alternateRequests += 1;
    const response = await route.fetch({ url: "https://soroban-testnet.stellar.org" });
    await route.fulfill({ response });
  });
  await importLiveWallet(page, senderSecret);
  await setupPrivateBalance(page);

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button").filter({
    has: page.getByText("Network", { exact: true }),
  }).click();
  await page.getByLabel("Stellar RPC endpoint").fill(alternateRpc);
  await page.getByRole("button", { name: "Test & Save RPC" }).click();
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem("wallet.endpoint.rpc.testnet.v1"),
  )).toBe(alternateRpc);
  const requestsAfterSave = alternateRequests;
  expect(requestsAfterSave).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Home", exact: true }).first().click();
  const region = await openPrivateBalance(page);
  const details = await openPrivateDetails(page, region);
  await details.getByRole("button", { name: "Check for new private activity" }).click();
  await expect.poll(() => alternateRequests, { timeout: 180_000 }).toBeGreaterThan(requestsAfterSave);
  await expect(
    details.getByRole("status", { name: "Private payments status: Up to date" }),
  ).toBeVisible({ timeout: 180_000 });

  await details.getByRole("button", { name: "Advanced privacy" }).click();
  const protocol = page.getByRole("dialog", { name: "Advanced privacy", exact: true });
  await expect(protocol.getByRole("heading", { name: "Advanced privacy" })).toBeVisible();
  await expect(protocol.getByText(alternateRpc, { exact: true })).toBeVisible();
});
