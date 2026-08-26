import { expect, test } from "@playwright/test";
import { installNetworkFixtures, installQuietEventSource } from "./fixtures";

test.beforeEach(async ({ context }) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
});

test("document security headers use fresh nonces without breaking LAN-safe viewport policy", async ({ page }) => {
  const first = await page.goto("/", { waitUntil: "domcontentloaded" });
  const firstPolicy = first?.headers()["content-security-policy"] ?? "";
  const second = await page.reload({ waitUntil: "domcontentloaded" });
  const secondPolicy = second?.headers()["content-security-policy"] ?? "";
  const firstNonce = /'nonce-([^']+)'/.exec(firstPolicy)?.[1];
  const secondNonce = /'nonce-([^']+)'/.exec(secondPolicy)?.[1];

  expect(firstNonce).toBeTruthy();
  expect(secondNonce).toBeTruthy();
  expect(secondNonce).not.toBe(firstNonce);
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
