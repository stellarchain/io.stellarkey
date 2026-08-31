import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  importLiveWallet,
  installPrivateBalanceNetworkSupport,
  openPrivateReceive,
  privateBalanceE2eEnabled,
  senderSecret,
  setupPrivateBalance,
} from "./helpers";

test.use({ serviceWorkers: "block" });
test.skip(!privateBalanceE2eEnabled, "Requires the isolated Private Balance testnet fixture runner.");
test.setTimeout(300_000);

test("keeps setup and private receive operable across supported browsers", async ({ context, page }) => {
  const release = await page.request.get("/app");
  expect(release.headers()["permissions-policy"]).toContain("camera=()");

  await installPrivateBalanceNetworkSupport(context);
  await importLiveWallet(page, senderSecret);
  const region = await setupPrivateBalance(page);
  await expect(region.getByRole("button", { name: /^Open private XLM\. Ready\./ })).toBeVisible({
    timeout: 180_000,
  });

  const pageWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client);
  const regionBox = await region.boundingBox();
  expect(regionBox).not.toBeNull();
  expect((regionBox?.x ?? 0) + (regionBox?.width ?? 0)).toBeLessThanOrEqual(pageWidth.client + 1);

  const dialog = await openPrivateReceive(page);
  await expect(dialog.getByRole("img", { name: /receive address QR code$/ })).toBeVisible({
    timeout: 30_000,
  });
  const copy = dialog.getByRole("button", { name: "Copy Address" });
  await expect(copy).toBeVisible();
  const copyBox = await copy.boundingBox();
  expect(copyBox).not.toBeNull();
  expect(copyBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await copy.click();
  await expect(page.locator("video, input[accept*='image']")).toHaveCount(0);

  const dialogWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dialogWidth.scroll).toBeLessThanOrEqual(dialogWidth.client);
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["meta-viewport"])
    .analyze();
  expect(results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  )).toEqual([]);
});
