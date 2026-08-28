import { expect, test } from "@playwright/test";
import { installNetworkFixtures, installQuietEventSource } from "./fixtures";

const routes = [
  { path: "/", heading: "Own your keys. Own your money.", title: "StellarKey — Self-custodial Stellar wallet" },
  { path: "/about", heading: "About StellarKey", title: "About — StellarKey" },
  { path: "/privacy", heading: "Your data stays close", title: "Privacy — StellarKey" },
  { path: "/terms", heading: "You remain in control", title: "Terms — StellarKey" },
  { path: "/security", heading: "Protect the recovery path", title: "Security — StellarKey" },
  { path: "/support", heading: "Support without custody", title: "Support — StellarKey" },
] as const;

test.beforeEach(async ({ context }) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
});

for (const route of routes) {
  test(`${route.path} is a canonical, narrow-screen-safe public document`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(route.title);
    await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).not.toBeNull();
    expect(new URL(canonical!).origin).toBe("https://stellarkey.io");
    expect(new URL(canonical!).pathname).toBe(route.path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("security and support contacts are user-activated and absent from static markup", async ({ page }) => {
  for (const [path, buttonName] of [
    ["/security", "Email the security team"],
    ["/support", "Email support"],
  ] as const) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: buttonName })).toBeVisible();
    expect(await page.locator("body").innerHTML()).not.toMatch(/[\w.+-]+@stellarkey\.io/i);
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  }
});

test("the install manifest exposes any-purpose and safe-zone maskable artwork", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");

  const manifest = await response.json();
  expect(manifest).toMatchObject({
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
  });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: "/icon-512.png", sizes: "512x512", purpose: "any" }),
    expect.objectContaining({ src: "/icon-maskable-512.png", sizes: "512x512", purpose: "maskable" }),
  ]));

  const icon = await request.get("/icon-maskable-512.png");
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image/png");
});

test("unknown routes return a branded, non-indexable 404", async ({ page }) => {
  const response = await page.goto("/definitely-not-a-stellarkey-route", {
    waitUntil: "domcontentloaded",
  });

  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle("Page not found — StellarKey");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  expect(await page.locator('meta[name="robots"]').evaluateAll((nodes) =>
    nodes.some((node) => /noindex/i.test(node.getAttribute("content") ?? "")),
  )).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
