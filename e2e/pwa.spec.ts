import { expect, test } from "@playwright/test";
import { installNetworkFixtures, installQuietEventSource } from "./fixtures";

test.beforeEach(async ({ context }) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
});

test("document security headers use build-time hashes without weakening viewport policy", async ({ page }) => {
  const first = await page.goto("/", { waitUntil: "domcontentloaded" });
  const firstPolicy = first?.headers()["content-security-policy"] ?? "";
  const second = await page.reload({ waitUntil: "domcontentloaded" });
  const secondPolicy = second?.headers()["content-security-policy"] ?? "";
  expect(firstPolicy).toContain("'sha256-");
  expect(secondPolicy).toBe(firstPolicy);
  expect(firstPolicy).not.toContain("'nonce-");
  expect(firstPolicy).not.toContain("script-src 'self' 'unsafe-inline'");
  expect(first?.headers()["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
  await expect.poll(() => page.evaluate(() =>
    document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
  )).toContain("user-scalable=no");
});

test("installed shell cold-launches offline without caching wallet or network data", async ({ context, page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
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
  await coldPage.goto("/", { waitUntil: "domcontentloaded" });
  await expect(coldPage.getByRole("heading", { name: "Own your keys. Own your money." })).toBeVisible();
  expect(await coldPage.evaluate(() => localStorage.length)).toBe(0);
  await context.setOffline(false);
});

test("an empty iOS Home Screen launch explains the local-storage handoff and leads with restore", async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
  });
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Restore your encrypted backup first", { exact: true })).toBeVisible();
  await expect(page.getByText(/Home Screen app has its own local storage/)).toBeVisible();
  const paths = page.locator("label, button").filter({ hasText: /Restore From Backup|Create New Wallet/ });
  await expect(paths.first()).toContainText("Restore From Backup");
});
