import { expect, test } from "@playwright/test";
import {
  importLiveWallet,
  installPrivateBalanceNetworkSupport,
  openPrivateReceive,
  privateBalanceE2eEnabled,
  recipientSecret,
  senderSecret,
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

test("keeps Send and its nested setup dialog mounted through consent completion", async ({
  context,
  page,
}) => {
  await installPrivateBalanceNetworkSupport(context);
  await importLiveWallet(page, senderSecret);

  await page.getByRole("main").getByRole("button", { name: "Send", exact: true }).first().click();
  const sendDialog = page.getByRole("dialog", { name: "Send Payment", exact: true });
  await sendDialog.getByRole("tablist", { name: "Send type" })
    .getByRole("tab", { name: "Private", exact: true }).click();
  await sendDialog.getByRole("button", { name: "Turn On Private Payments", exact: true }).click();

  const setupDialog = page.getByRole("dialog", { name: "Private Payments", exact: true });
  await expect(setupDialog).toBeVisible();
  await sendDialog.evaluate(node => node.setAttribute("data-e2e-overlay-identity", "send"));
  await setupDialog.evaluate(node => node.setAttribute("data-e2e-overlay-identity", "setup"));
  await setupDialog.getByRole("checkbox").check();
  await setupDialog.getByRole("button", { name: "Turn On", exact: true }).click();

  const success = setupDialog.getByText("Private Payments is on", { exact: true });
  const failure = setupDialog.getByRole("alert");
  await expect(success.or(failure).first()).toBeVisible({ timeout: 180_000 });
  if (await failure.isVisible().catch(() => false)) {
    throw new Error(`Private Payments setup failed: ${await failure.textContent()}`);
  }

  await expect(sendDialog).toHaveAttribute("data-e2e-overlay-identity", "send");
  await expect(setupDialog).toHaveAttribute("data-e2e-overlay-identity", "setup");
  await expect.poll(() => sendDialog.evaluate(node => (node as HTMLElement).inert)).toBe(true);
  await setupDialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(setupDialog).toBeHidden();
  await expect(sendDialog.getByText(/Preparing private/)).toHaveCount(0);
  await expect(sendDialog.getByLabel("Private recipient", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
});
