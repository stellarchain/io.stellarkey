import { expect, test } from "@playwright/test";
import {
  importTestWallet,
  installNetworkFixtures,
  installQuietEventSource,
} from "./fixtures";

test.beforeEach(async ({ context }) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
});

test("modal makes the wallet inert, contains focus, and restores its trigger", async ({ page }) => {
  await test.step("Import synthetic wallet", async () => { await importTestWallet(page); });

  const trigger = page.getByRole("main").getByRole("button", { name: "Send", exact: true }).first();
  await test.step("Focus and activate opener", async () => { await trigger.focus(); await trigger.click(); });

  const dialog = page.getByRole("dialog", { name: "Send Payment", exact: true });
  const appSurface = page.locator("[data-app-surface]");
  await test.step("Check overlay contract", async () => { await expect(dialog).toBeVisible(); });
  await test.step("Check overlay contract", async () => { await expect(appSurface).toHaveCount(1); });
  await test.step("Check overlay contract", async () => { await expect.poll(() => appSurface.evaluate((node) => (node as HTMLElement).inert)).toBe(true); });
  await test.step("Check overlay contract", async () => { await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden"); });
  await test.step("Check overlay contract", async () => { await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true); });

  await test.step("Check overlay contract", async () => { await dialog.getByRole("button", { name: "Close", exact: true }).click(); });
  await test.step("Check overlay contract", async () => { await expect(dialog).toBeHidden(); });
  await test.step("Check overlay contract", async () => { await expect.poll(() => appSurface.evaluate((node) => (node as HTMLElement).inert)).toBe(false); });
  await test.step("Check overlay contract", async () => { await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe(""); });
  await test.step("Check overlay contract", async () => { await expect(trigger).toBeFocused(); });
});

test("nested private setup keeps only the top dialog interactive", async ({ page }) => {
  await importTestWallet(page);

  await page.getByRole("main").getByRole("button", { name: "Send", exact: true }).first().click();
  const sendDialog = page.getByRole("dialog", { name: "Send Payment", exact: true });
  const privateTab = sendDialog.getByRole("tablist", { name: "Send type" })
    .getByRole("tab", { name: "Private", exact: true });
  if (process.env.E2E_PRIVATE_UI_REQUIRED === "1") {
    await expect(privateTab).toBeVisible({ timeout: 30_000 });
  } else {
    test.skip(await privateTab.count() === 0, "Private Payments has no release-approved deployment.");
  }
  await privateTab.click();
  await sendDialog.getByRole("button", { name: "Turn On Private Payments", exact: true }).click();

  const setupDialog = page.getByRole("dialog", { name: "Private Payments", exact: true });
  await expect(setupDialog).toBeVisible();
  await expect.poll(() => sendDialog.evaluate((node) => (node as HTMLElement).inert)).toBe(true);
  await expect.poll(() => setupDialog.evaluate((node) => (node as HTMLElement).inert)).toBe(false);
  await expect.poll(() => page.locator("[data-app-surface]").evaluate(
    (node) => (node as HTMLElement).inert,
  )).toBe(true);

  await setupDialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(setupDialog).toBeHidden();
  await expect.poll(() => sendDialog.evaluate((node) => (node as HTMLElement).inert)).toBe(false);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await sendDialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sendDialog).toBeHidden();
  await expect.poll(() => page.locator("[data-app-surface]").evaluate(
    (node) => (node as HTMLElement).inert,
  )).toBe(false);
});
