import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  importLiveWallet,
  installPrivateBalanceNetworkSupport,
  openPrivateBalance,
  privateBalanceE2eEnabled,
  senderSecret,
} from "./helpers";

test.use({ serviceWorkers: "block" });
test.skip(!privateBalanceE2eEnabled, "Requires the isolated Private Balance testnet fixture runner.");

test("keeps the critical setup dialog operable and accessible", async ({ context, page }) => {
  await installPrivateBalanceNetworkSupport(context);
  await importLiveWallet(page, senderSecret);
  const region = await openPrivateBalance(page);
  await region.getByRole("button", { name: /^Open private XLM\./ }).click();
  const dialog = page.getByRole("dialog", { name: "Private Payments", exact: true });
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  // One screen: consent checkbox and Turn On live together — no wizard steps.
  await expect(dialog.getByRole("checkbox")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Turn On" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  const learnMore = dialog.getByRole("button", { name: "Learn more" });
  await learnMore.click();
  await expect(learnMore).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.getByText(/^One-time download:/)).toBeVisible();
  await expect(dialog.getByText(/rebuild your private balance from Stellar/)).toBeVisible();

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["meta-viewport"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(blocking).toEqual([]);
});
