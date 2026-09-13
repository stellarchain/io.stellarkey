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

test("account mark retains its requested size in the desktop sidebar", async ({ page }) => {
  await importTestWallet(page);

  const sidebar = page.locator("aside");
  await expect(sidebar).toBeVisible();
  const accountMark = sidebar.locator("span.grid.grid-cols-5").first();
  await expect(accountMark).toBeVisible();
  await expect(accountMark.locator(":scope > span")).toHaveCount(25);
  const box = await accountMark.boundingBox();
  expect(box?.width).toBe(24);
  expect(box?.height).toBe(24);
});
