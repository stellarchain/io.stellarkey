import { expect, test } from "@playwright/test";
import {
  importLiveWallet,
  installPrivateBalanceNetworkSupport,
  privateBalanceE2eEnabled,
  senderSecret,
} from "./helpers";

test.use({ serviceWorkers: "block" });
test.skip(!privateBalanceE2eEnabled, "Requires the isolated Private Balance testnet fixture runner.");

test("fails closed when the pinned manifest bytes are modified", async ({ context, page }) => {
  await installPrivateBalanceNetworkSupport(context);
  let tamperedRequests = 0;
  await context.route("**/protocol/private-balance/v1/manifest.json", async (route) => {
    tamperedRequests += 1;
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()} ` });
  });
  const observed: string[] = [];
  page.on("console", (message) => observed.push(message.text()));
  page.on("pageerror", (error) => observed.push(error.message));

  await importLiveWallet(page, senderSecret);
  await expect.poll(() => tamperedRequests).toBeGreaterThan(0);

  // If the destination still lists (the development fixture keeps the entry
  // visible), opting in must stop safely instead of configuring.
  const destination = page.getByRole("button", { name: /^Open private XLM\./ }).first();
  if (await destination.isVisible().catch(() => false)) {
    await destination.click();
    const dialog = page.getByRole("dialog", { name: "Private Payments", exact: true });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Turn On" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible({ timeout: 120_000 });
    await expect(dialog.getByText("Private Payments is on")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Open private XLM\. Ready\./ })).toHaveCount(0);
  }
  expect(observed.join("\n")).not.toContain(senderSecret);
});
