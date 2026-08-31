import { expect, test } from "@playwright/test";
import {
  importLiveWallet,
  installPrivateBalanceNetworkSupport,
  openPrivateReceive,
  privateBalanceE2eEnabled,
  recipientSecret,
  setupPrivateBalance,
} from "./helpers";

test.use({ serviceWorkers: "block" });
test.skip(!privateBalanceE2eEnabled, "Requires the isolated Private Balance testnet fixture runner.");
test.setTimeout(240_000);

test("sets up a fresh profile and renders its private receive address", async ({ context, page }) => {
  await installPrivateBalanceNetworkSupport(context);
  await importLiveWallet(page, recipientSecret);
  const region = await setupPrivateBalance(page);

  // Receive only needs the durable private address — no sync gating.
  await expect(region.getByRole("button", { name: /^Open private XLM\. Ready\./ })).toBeVisible();
  const dialog = await openPrivateReceive(page);
  await expect(dialog.getByAltText(/receive address QR code$/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(dialog.getByRole("button", { name: "Copy Address" })).toBeVisible();
  await dialog.getByRole("button", { name: "About this address" }).click();
  await expect(dialog.getByText("Testnet", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Protocol V1", { exact: true })).toBeVisible();
  // The same open modal switches back to the public address without closing.
  const tabs = dialog.getByRole("tablist", { name: "Receive address type" });
  await tabs.getByRole("tab", { name: "Public", exact: true }).click();
  await expect(dialog.getByAltText("Address QR code")).toBeVisible({ timeout: 30_000 });
  await tabs.getByRole("tab", { name: "Private", exact: true }).click();
  await expect(dialog.getByAltText(/receive address QR code$/)).toBeVisible({
    timeout: 30_000,
  });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
});
