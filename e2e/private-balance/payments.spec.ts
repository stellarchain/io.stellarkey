import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  expectBalanceAfterRefresh,
  expectPrivateBalance,
  importLiveWallet,
  installPrivateBalanceNetworkSupport,
  openPrivateBalance,
  openPrivateAdd,
  openPrivateDetails,
  openPrivateReceive,
  openPrivateSend,
  openPrivateWithdraw,
  privateBalanceE2eEnabled,
  recipientSecret,
  senderSecret,
  setupPrivateBalance,
} from "./helpers";

test.skip(!privateBalanceE2eEnabled, "Requires the isolated Private Balance testnet fixture runner.");
test.setTimeout(900_000);

const PRIVATE_TEST_PASSWORD = "Private-MVP-2026!";

async function confirmPreparedAction(
  dialog: Locator,
  options: { confirm: string; success: string },
): Promise<void> {
  // The review renders instantly; the proof prepares underneath while the fee
  // row shows its skeleton, so the confirm button enables only when ready.
  const confirm = dialog.getByRole("button", {
    name: options.confirm,
    exact: true,
    disabled: false,
  });
  const failure = dialog.getByRole("alert");
  await expect(confirm.or(failure).first()).toBeVisible({ timeout: 300_000 });
  if (await failure.isVisible().catch(() => false)) {
    throw new Error(`Private action preparation failed: ${await failure.textContent()}`);
  }
  await confirm.click();
  await expect(dialog.getByRole("heading", { name: options.success })).toBeVisible({
    timeout: 600_000,
  });
  await dialog.getByRole("button", { name: "Done" }).click();
}

async function deposit(page: Page, region: Locator, amount: string): Promise<void> {
  void region;
  const dialog = await openPrivateAdd(page);
  await dialog.getByLabel("Amount", { exact: true }).fill(amount);
  await dialog.getByRole("button", { name: "Review Add Funds" }).click();
  await confirmPreparedAction(dialog, { confirm: "Confirm", success: "Deposit Sent" });
}

async function readPrivateAddress(page: Page, region: Locator): Promise<string> {
  void region;
  const dialog = await openPrivateReceive(page);
  const addressText = dialog.getByLabel("Private address").locator("[title]").first();
  await expect(addressText).toBeVisible();
  const address = await addressText.getAttribute("title") ?? "";
  expect(address).toMatch(/^tks1[023456789acdefghjklmnpqrstuvwxyz]{115}$/);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  return address;
}

test("completes payments, encrypted-backup restore, and seed-only recovery", async ({ browser }) => {
  const recipientContext = await browser.newContext({ serviceWorkers: "block" });
  const senderContext = await browser.newContext({ serviceWorkers: "block" });
  try {
    await Promise.all([
      installPrivateBalanceNetworkSupport(recipientContext),
      installPrivateBalanceNetworkSupport(senderContext),
    ]);
    const recipientPage = await recipientContext.newPage();
    const senderPage = await senderContext.newPage();

    await importLiveWallet(recipientPage, recipientSecret);
    const recipientRegion = await setupPrivateBalance(recipientPage);
    const recipientAddress = await readPrivateAddress(recipientPage, recipientRegion);

    await importLiveWallet(senderPage, senderSecret);
    const senderRegion = await setupPrivateBalance(senderPage);

    await deposit(senderPage, senderRegion, "2.0000000");
    await expectPrivateBalance(senderRegion, "2");
    await deposit(senderPage, senderRegion, "1.0000000");
    await expectPrivateBalance(senderRegion, "3");

    // Sending more than any single deposit folds the old consolidation rescue
    // into the send review itself: one approval covering every step.
    const send = await openPrivateSend(senderPage);
    await send.getByLabel("Private recipient").fill(recipientAddress);
    await send.getByLabel("Amount", { exact: true }).fill("2.5");
    await send.getByLabel("Private memo (optional)").fill("lifecycle");
    await send.getByRole("button", { name: "Review Private Send" }).click();
    await expect(send.getByRole("heading", { name: "Review Private Send" })).toBeVisible();
    await confirmPreparedAction(send, { confirm: "Confirm Send", success: "Sent Privately" });
    await expectPrivateBalance(senderRegion, "0.5");

    await expectBalanceAfterRefresh(recipientPage, recipientRegion, "2.5");

    let timedOutSubmissions = 0;
    await recipientContext.route("https://soroban-testnet.stellar.org/**", async (route) => {
      const request = route.request();
      let method: unknown;
      try {
        method = request.postDataJSON()?.method;
      } catch {
        method = undefined;
      }
      if (method === "sendTransaction" && timedOutSubmissions === 0) {
        timedOutSubmissions += 1;
        await route.abort("timedout");
        return;
      }
      await route.continue();
    });
    const ambiguousWithdrawal = await openPrivateWithdraw(recipientPage);
    await ambiguousWithdrawal.getByLabel("Amount", { exact: true }).fill("0.25");
    await ambiguousWithdrawal.getByRole("button", { name: "Review Withdrawal" }).click();
    const ambiguousConfirm = ambiguousWithdrawal.getByRole("button", {
      name: "Confirm",
      exact: true,
      disabled: false,
    });
    const ambiguousFailure = ambiguousWithdrawal.getByRole("alert");
    await expect(ambiguousConfirm.or(ambiguousFailure).first()).toBeVisible({ timeout: 300_000 });
    if (await ambiguousFailure.isVisible().catch(() => false)) {
      throw new Error(
        `Private action preparation failed: ${await ambiguousFailure.textContent()}`,
      );
    }
    await ambiguousConfirm.click();
    await expect(
      ambiguousWithdrawal.getByRole("heading", { name: /We couldn.t confirm this payment yet/ }),
    ).toBeVisible({ timeout: 180_000 });
    await expect(
      ambiguousWithdrawal.getByText(/Your money is safe — we.ll keep checking/),
    ).toBeVisible();
    await ambiguousWithdrawal.getByRole("button", { name: "Done" }).click();
    expect(timedOutSubmissions).toBe(1);

    await recipientPage.getByRole("button", { name: "Lock Wallet" }).click();
    await recipientPage.getByPlaceholder("Enter password").fill(PRIVATE_TEST_PASSWORD);
    await recipientPage.getByRole("button", { name: "Unlock Vault" }).click();
    await expect(recipientPage.getByText("Your Assets", { exact: true })).toBeVisible({ timeout: 30_000 });
    await openPrivateBalance(recipientPage);
    // The unresolved withdrawal survives the relock in the merged wallet feed.
    await recipientPage.getByRole("button", { name: /^Activity/ }).first().click();
    const activity = recipientPage.getByRole("main");
    const pendingWithdrawal = activity.getByRole("button", {
      name: /Private withdrawal.*Confirming.*0\.25 XLM/,
    });
    await expect(pendingWithdrawal).toBeVisible({
      timeout: 60_000,
    });
    await recipientPage.getByRole("button", { name: "Home", exact: true }).first().click();

    const withdrawal = await openPrivateWithdraw(senderPage);
    await withdrawal.getByLabel("Amount", { exact: true }).fill("0.25");
    await withdrawal.getByRole("button", { name: "Review Withdrawal" }).click();
    await confirmPreparedAction(withdrawal, { confirm: "Confirm", success: "Withdrawal Sent" });
    await expectPrivateBalance(senderRegion, "0.25");

    await senderPage.getByRole("button", { name: "Lock Wallet" }).click();
    await expect(senderPage.getByPlaceholder("Enter password")).toBeVisible();
    await senderPage.getByPlaceholder("Enter password").fill(PRIVATE_TEST_PASSWORD);
    await senderPage.getByRole("button", { name: "Unlock Vault" }).click();
    await expect(senderPage.getByText("Your Assets", { exact: true })).toBeVisible({ timeout: 30_000 });
    const unlockedRegion = await openPrivateBalance(senderPage);
    await expectPrivateBalance(unlockedRegion, "0.25");

    await senderPage.getByRole("button", { name: "Settings", exact: true }).first().click();
    await senderPage.getByRole("button", { name: /Backup & Recovery/ }).click();
    const backup = senderPage.getByRole("dialog", { name: /Backup & Recovery/ });
    await backup.getByRole("button", { name: "Back Up Wallet" }).click();
    await senderPage.getByRole("button", { name: /Encrypted Backup File/ }).click();
    await senderPage.getByPlaceholder("Wallet Password").fill(PRIVATE_TEST_PASSWORD);
    await senderPage.getByRole("button", { name: "Verify & Continue" }).click();
    const backupDownload = senderPage.waitForEvent("download");
    await senderPage.getByRole("button", { name: "Download Encrypted Backup" }).click();
    const backupPath = await (await backupDownload).path();
    expect(backupPath).not.toBeNull();
    const backupJson = await readFile(backupPath as string);
    await senderPage.getByRole("button", { name: "Done" }).click();

    await senderPage.getByRole("button", { name: "Reset Wallet" }).click();
    const reset = senderPage.getByRole("dialog", { name: "Erase & Reset Wallet?" });
    await reset.getByRole("button", { name: "Erase Everything" }).click();
    await expect(senderPage.getByRole("heading", { name: "Own your keys. Own your money." })).toBeVisible();
    await senderPage.locator('input[type="file"]').setInputFiles({
      name: "wallet-backup.json",
      mimeType: "application/json",
      buffer: backupJson,
    });
    await senderPage.getByPlaceholder("Enter password").fill(PRIVATE_TEST_PASSWORD);
    await senderPage.getByRole("button", { name: "Decrypt & Restore" }).click();
    await expect(senderPage.getByRole("button", { name: "Unlock Vault" })).toBeVisible();
    await senderPage.getByPlaceholder("Enter password").fill(PRIVATE_TEST_PASSWORD);
    await senderPage.getByRole("button", { name: "Unlock Vault" }).click();
    await expect(senderPage.getByText("Your Assets", { exact: true })).toBeVisible({ timeout: 30_000 });
    const restoredRegion = await openPrivateBalance(senderPage);
    await expectPrivateBalance(restoredRegion, "0.25");

    const details = await openPrivateDetails(senderPage, restoredRegion);
    await details.getByRole("button", { name: "Advanced privacy" }).click();
    const protocol = senderPage.getByRole("dialog", { name: "Advanced privacy", exact: true });
    await expect(protocol.getByRole("heading", { name: "Advanced privacy" })).toBeVisible();
    await protocol.getByRole("button", { name: "Remove private data from this device" }).click();
    await protocol.getByLabel("Type REMOVE PRIVATE BALANCE to confirm").fill("REMOVE PRIVATE BALANCE");
    await protocol.getByRole("button", { name: "Remove from this device" }).click();
    await expect(protocol).toBeHidden();
    const asset = senderPage.getByRole("dialog", { name: "XLM", exact: true });
    await expect(asset).toBeHidden();
    await expect(
      restoredRegion.getByRole("button", { name: /^Open private XLM\. Not set up\./ }),
    ).toBeVisible({ timeout: 30_000 });
    const recoveredRegion = await setupPrivateBalance(senderPage);
    await expectPrivateBalance(recoveredRegion, "0.25");
  } finally {
    await Promise.all([recipientContext.close(), senderContext.close()]);
  }
});
