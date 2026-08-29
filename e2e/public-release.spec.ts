import { expect, test } from "@playwright/test";
import { installNetworkFixtures, installQuietEventSource } from "./fixtures";

const routes = [
  { path: "/", heading: "Your keys never leave this device.", title: "StellarKey: a Stellar wallet with a card machine in it" },
  { path: "/about", heading: "About StellarKey", title: "About StellarKey — StellarKey" },
  { path: "/privacy", heading: "Your data stays close", title: "Your data stays close — StellarKey" },
  { path: "/terms", heading: "You remain in control", title: "You remain in control — StellarKey" },
  { path: "/security", heading: "Protect the recovery path", title: "Protect the recovery path — StellarKey" },
  { path: "/support", heading: "Support without custody", title: "Support without custody — StellarKey" },
  { path: "/changelog", heading: "Changelog", title: "Changelog — StellarKey" },
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
    await expect(page.locator("[data-build-identity]")).toHaveText(
      /^v1\.1\.0 · (?:[0-9a-f]{7}|development)$/,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (route.path === "/") {
      const sharingAlt = await page.locator('meta[property="og:image:alt"]').getAttribute("content");
      expect(sharingAlt).not.toMatch(/[—–]/);
    }
  });
}

test("the wallet entry page shows the same release identity", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const response = await page.goto("/app", { waitUntil: "domcontentloaded" });

  expect(response?.status()).toBe(200);
  await expect(page.locator("[data-build-identity]")).toHaveText(
    /^v1\.1\.0 · (?:[0-9a-f]{7}|development)$/,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

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

test("the install manifest and Apple metadata expose complete mobile artwork", async ({ page, request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");

  const manifest = await response.json();
  expect(manifest).toMatchObject({
    id: "/app",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
  });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: "/icon-192.png", sizes: "192x192", purpose: "any" }),
    expect.objectContaining({ src: "/icon-512.png", sizes: "512x512", purpose: "any" }),
    expect.objectContaining({ src: "/icon-maskable-192.png", sizes: "192x192", purpose: "maskable" }),
    expect.objectContaining({ src: "/icon-maskable-512.png", sizes: "512x512", purpose: "maskable" }),
    expect.objectContaining({ src: "/icon-maskable-1024.png", sizes: "1024x1024", purpose: "maskable" }),
  ]));

  for (const path of manifest.icons.map(({ src }: { src: string }) => src)) {
    const icon = await request.get(path);
    expect(icon.status(), `${path} must be served`).toBe(200);
    expect(icon.headers()["content-type"]).toContain("image/png");
  }

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const appleSizes = await page.locator('link[rel="apple-touch-icon"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute("sizes")).sort(),
  );
  expect(appleSizes).toEqual(["152x152", "167x167", "180x180"]);
});

test("the landing page does not prefetch the wallet application before it is requested", async ({ page }) => {
  const requestedPaths: string[] = [];
  page.on("request", (request) => requestedPaths.push(new URL(request.url()).pathname));

  await page.goto("/", { waitUntil: "networkidle" });

  expect(requestedPaths.filter((path) => path === "/app" || path.startsWith("/app/"))).toEqual([]);
});

test("the changelog publishes the current release as semantic text", async ({ page }) => {
  await page.goto("/changelog", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { level: 2, name: "Unreleased" })).toBeVisible();
  await expect(page.getByText("No unreleased changes.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "1.1.0" })).toBeVisible();
  await expect(page.locator('time[datetime="2026-08-29"]')).toHaveText("29 August 2026");
  await expect(page.getByRole("link", { name: /source repository/i })).toHaveAttribute(
    "href",
    "https://github.com/stellarchain/io.stellarkey",
  );
  await expect(page.locator("article")).not.toContainText(/<script|<strong|<a /i);
});

test("the fee comparison is editable, sourced, and explicit about its assumptions", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const comparison = page.getByRole("region", { name: "Annual fee comparison" });
  const sales = comparison.getByRole("slider", { name: "Sales a day", exact: true });
  const ticket = comparison.getByRole("slider", { name: "Average ticket", exact: true });

  const setRange = async (input: typeof sales, value: string) => {
    await input.evaluate((element, nextValue) => {
      const range = element as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!valueSetter) throw new Error("Range inputs must expose a native value setter");
      valueSetter.call(range, nextValue);
      range.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  };
  await setRange(sales, "100");
  await setRange(ticket, "1000");

  await expect(comparison).toContainText("36,500 sales a year");
  await expect(comparison).toContainText("£365,000");
  for (const provider of ["Square", "PayPal Point of Sale", "SumUp", "Stripe Terminal"]) {
    await expect(comparison.getByRole("row", { name: new RegExp(provider) })).toBeVisible();
  }
  const stellarKeyRow = comparison.getByRole("row", { name: /StellarKey/ });
  await expect(stellarKeyRow).toContainText("StellarKey processing fee");
  await expect(stellarKeyRow).toContainText("£0.00");

  await expect(comparison).toContainText("Illustrative UK assumptions checked 29 August 2026");
  await expect(comparison).toContainText("365 trading days");
  await expect(comparison).toContainText("Provider fees can vary");
  await expect(comparison).toContainText("The sender pays Stellar network fees");
  await expect(comparison).toContainText("Conversion, spread, reserves, tax, and off-ramp fees are excluded");
  await expect(comparison.getByRole("link", { name: "Stellar fee documentation" })).toHaveAttribute(
    "href",
    "https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering",
  );
  await expect(comparison.getByText(/live network fee|current XLM rate|fixed network fee/i)).toHaveCount(0);
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
