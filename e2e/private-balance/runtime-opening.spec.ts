import { expect, test } from "@playwright/test";
import {
  importLiveWallet,
  installPrivateBalanceNetworkSupport,
  openPrivateWithdraw,
  privateBalanceE2eEnabled,
  senderSecret,
  setupPrivateBalance,
} from "./helpers";

test.use({ serviceWorkers: "block" });
test.skip(!privateBalanceE2eEnabled, "Requires the isolated Private Balance testnet fixture runner.");
test.setTimeout(240_000);

test("opens a configured private withdrawal without an indefinite bootstrap", async ({ context, page }) => {
  await installPrivateBalanceNetworkSupport(context);
  await importLiveWallet(page, senderSecret);
  await setupPrivateBalance(page);

  const dialog = await openPrivateWithdraw(page);
  await expect(dialog.getByLabel("Amount", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText("Still opening", { exact: true })).toHaveCount(0);
});
