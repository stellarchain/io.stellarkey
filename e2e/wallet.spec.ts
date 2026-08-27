import { expect, test } from "@playwright/test";
import {
  importTestWallet,
  installNetworkFixtures,
  installQuietEventSource,
  observePageFailures,
  testPassword,
  testPayer,
} from "./fixtures";

test.beforeEach(async ({ context }) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
});

test("onboarding exposes recovery and hardware paths without runtime errors", async ({ page }) => {
  const failures = observePageFailures(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Own your keys. Own your money." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Trezor" })).toBeVisible();
  await expect(page.getByText("Restore From Backup", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Connect Trezor" }).click();
  await expect(page.getByText("Connect your Trezor", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect with Trezor Connect" })).toBeVisible();

  expect(failures.pageErrors).toEqual([]);
  expect(failures.consoleErrors).toEqual([]);
});

test("corrupt vault data enters explicit recovery without overwriting the payload", async ({ page }) => {
  const corrupt = "{corrupt-wallet-record";
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate((raw) => localStorage.setItem("polaris.vault.v1", raw), corrupt);
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Wallet data needs recovery" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export recovery data" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("polaris.vault.v1")))
    .toBe(corrupt);
});

test("network settings verify, persist, and reset direct endpoints", async ({ page }) => {
  await importTestWallet(page);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button").filter({
    has: page.getByText("Network", { exact: true }),
  }).click();
  await expect(page.getByRole("heading", { name: "Network" })).toBeVisible();

  await page.getByRole("button", { name: "Test & Save Horizon" }).click();
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem("wallet.endpoint.horizon.testnet.v1"),
  )).toBe("https://horizon-testnet.stellar.org");

  await page.getByRole("button", { name: "Test & Save RPC" }).click();
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem("wallet.endpoint.rpc.testnet.v1"),
  )).toBe("https://soroban-testnet.stellar.org");

  await page.getByRole("button", { name: "Reset to Defaults" }).click();
  await expect.poll(() => page.evaluate(() => ({
    horizon: localStorage.getItem("wallet.endpoint.horizon.testnet.v1"),
    rpc: localStorage.getItem("wallet.endpoint.rpc.testnet.v1"),
  }))).toEqual({ horizon: null, rpc: null });
});

test("unlock, send review, swap review, and watch-only safety stay operable", async ({ page }) => {
  const failures = observePageFailures(page);
  await importTestWallet(page);

  await page.evaluate(() => {
    localStorage.setItem("wallet.passkey-prf.v1", JSON.stringify({
      version: 1,
      credentialId: "AQ",
      prfSalt: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      wrappedMasterKey: { iv: "local-test-iv", ciphertext: "local-test-ciphertext" },
      createdAt: new Date().toISOString(),
    }));
  });

  await page.getByRole("button", { name: "Lock Wallet" }).click();
  await expect(page.getByRole("button", { name: "Unlock with Face ID / Touch ID" })).toBeVisible();
  await expect(page.getByPlaceholder("Enter password")).toBeVisible();
  await page.getByPlaceholder("Enter password").fill(testPassword);
  await page.getByRole("button", { name: "Unlock Vault" }).click();
  await expect(page.getByText("Your Assets", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Send", exact: true }).click();
  const send = page.getByRole("dialog", { name: "Send Payment" });
  await send.getByPlaceholder("0.00").fill("1");
  await send.getByPlaceholder("G... or user*domain.com").fill(testPayer);
  await send.getByRole("button", { name: "Review Transfer" }).click();
  await expect(page.getByRole("dialog", { name: "Review Transfer" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("dialog", { name: "Send Payment" }).getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "DEX Swap", exact: true }).click();
  const payAmount = page.getByLabel("You pay amount");
  const receiveAmount = page.getByLabel("You receive amount");
  await payAmount.fill("1");
  await expect(receiveAmount).toHaveValue("0.25");
  await receiveAmount.fill("2");
  await expect(payAmount).toHaveValue("8");
  await expect(page.getByRole("button", { name: "Review Swap" })).toBeEnabled();
  await page.getByRole("button", { name: "Review Swap" }).click();
  await expect(page.getByText("Review Swap Details & Routing", { exact: true })).toBeVisible();
  await expect(page.getByText("Maximum paid", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Confirm Swap" }).click();
  await expect(page.getByRole("heading", { name: "Swap complete" })).toBeVisible();
  await expect(page.getByText("Transaction hash", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "View activity", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Swap again", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Swap again", exact: true }).click();
  await expect(page.getByLabel("You pay amount")).toHaveValue("");
  await expect(page.getByLabel("You receive amount")).toHaveValue("");

  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Add Account" });
  await add.getByRole("button", { name: "Watch", exact: true }).click();
  await add.getByPlaceholder("G...").fill(testPayer);
  await add.getByRole("button", { name: "Track Address" }).click();
  await expect(add).toBeHidden();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();

  const width = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
  expect(failures.pageErrors).toEqual([]);
  expect(failures.consoleErrors).toEqual([]);
});
