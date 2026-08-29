import { expect, test } from "@playwright/test";
import { installNetworkFixtures, installQuietEventSource } from "./fixtures";

test.beforeEach(async ({ context }) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
});

test("document security policies use build-time hashes without weakening viewport policy", async ({ page }) => {
  const first = await page.goto("/", { waitUntil: "domcontentloaded" });
  const firstHeaderPolicy = first?.headers()["content-security-policy"] ?? "";
  const firstDocumentPolicy = await page
    .locator('meta[http-equiv="Content-Security-Policy"][data-stellarkey-csp]')
    .getAttribute("content") ?? "";
  const second = await page.reload({ waitUntil: "domcontentloaded" });
  const secondHeaderPolicy = second?.headers()["content-security-policy"] ?? "";
  const secondDocumentPolicy = await page
    .locator('meta[http-equiv="Content-Security-Policy"][data-stellarkey-csp]')
    .getAttribute("content") ?? "";
  expect(firstHeaderPolicy).toContain("frame-ancestors 'none'");
  expect(secondHeaderPolicy).toBe(firstHeaderPolicy);
  expect(firstHeaderPolicy.length).toBeLessThanOrEqual(2_000);
  expect(firstDocumentPolicy).toContain("'sha256-");
  expect(secondDocumentPolicy).toBe(firstDocumentPolicy);
  expect(firstDocumentPolicy).not.toContain("'nonce-");
  expect(firstDocumentPolicy).not.toContain("script-src 'self' 'unsafe-inline'");
  expect(firstDocumentPolicy).not.toContain("frame-ancestors");
  expect(first?.headers()["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
  await expect.poll(() => page.evaluate(() =>
    document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
  )).toContain("user-scalable=no");
});

test("installed shell cold-launches offline without caching wallet or network data", async ({ context, page }) => {
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
      });
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  await context.setOffline(true);
  const coldPage = await context.newPage();
  await coldPage.goto("/app", { waitUntil: "domcontentloaded" });
  await expect(coldPage.getByRole("heading", { name: "Own your keys. Own your money." })).toBeVisible();
  expect(await coldPage.evaluate(() => localStorage.length)).toBe(0);
  await context.setOffline(false);
});

test("the first worker install does not show a false update prompt", async ({ page }) => {
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect(page.getByRole("status").filter({ hasText: "Update ready" })).toHaveCount(0);
});

test("an empty iOS Home Screen launch explains the local-storage handoff and leads with restore", async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
  });
  const page = await context.newPage();
  await page.goto("/app", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Restore your encrypted backup first", { exact: true })).toBeVisible();
  await expect(page.getByText(/Home Screen app has its own local storage/)).toBeVisible();
  const paths = page.locator("label, button").filter({ hasText: /Restore From Backup|Create New Wallet/ });
  await expect(paths.first()).toContainText("Restore From Backup");
});
