import { expect, test, type Page } from "@playwright/test";
import { APPLICATION_VERSION } from "../src/lib/brand";
import { importTestWallet, installNetworkFixtures, installQuietEventSource } from "./fixtures";

const routes = [
  { path: "/", heading: "Your keys never leave this device.", title: "StellarKey: a Stellar wallet with a card machine in it" },
  { path: "/about", heading: "About StellarKey", title: "About StellarKey — StellarKey" },
  { path: "/privacy", heading: "Your data stays close", title: "Your data stays close — StellarKey" },
  { path: "/terms", heading: "You remain in control", title: "You remain in control — StellarKey" },
  { path: "/security", heading: "Protect the recovery path", title: "Protect the recovery path — StellarKey" },
  { path: "/support", heading: "Support without custody", title: "Support without custody — StellarKey" },
  { path: "/private", heading: "Private payments, explained.", title: "Private Payments — StellarKey" },
  { path: "/changelog", heading: "Changelog", title: "Changelog — StellarKey" },
] as const;

test.beforeEach(async ({ context }) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
});

async function expectReleaseIdentity(page: Page, placement: "footer" | "viewport") {
  const identity = page.locator("[data-build-identity]");
  await expect(identity).toHaveCount(1);
  if (placement === "footer") {
    await expect(page.locator("footer").locator("[data-build-identity]")).toHaveCount(1);
    await identity.scrollIntoViewIfNeeded();
  }
  await expect(identity).toBeVisible();
  await expect(identity).toHaveText(
    new RegExp(`^v${APPLICATION_VERSION.replaceAll(".", "\\.")} · (?:[0-9a-f]{7}|development)$`),
  );
  if (placement === "viewport") {
    expect(
      await identity.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      }),
      "the release identity must be visible without scrolling",
    ).toBe(true);
  }
}

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
    await expectReleaseIdentity(page, "footer");
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
  await expectReleaseIdentity(page, "viewport");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("locked authentication keeps the release identity above the fold", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await importTestWallet(page);
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { level: 1, name: "StellarKey" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock Vault" })).toBeVisible();
  await expectReleaseIdentity(page, "viewport");
});

test("the skip link appears for keyboards but cannot overlay touch-first screens", async ({ page }, testInfo) => {
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  const skipLink = page.locator(".skip-link");

  await skipLink.evaluate((element) => (element as HTMLElement).focus());

  if (testInfo.project.name === "desktop-chromium") {
    await expect(skipLink).toBeVisible();
    await expect(skipLink).toBeFocused();
  } else {
    await expect(skipLink).toBeHidden();
    await expect(skipLink).not.toBeFocused();
  }
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
  const currentRelease = page.locator(`#release-${APPLICATION_VERSION.replaceAll(".", "-")}`);
  const unreleased = page.locator("#release-unreleased");

  await expect(page.getByRole("heading", { level: 2, name: "Unreleased" })).toBeVisible();
  const unreleasedCategories = unreleased.getByRole("heading", { level: 3 });
  for (const category of await unreleasedCategories.allTextContents()) {
    expect(category).toMatch(/^(Added|Changed|Deprecated|Removed|Fixed|Security)$/);
  }
  await expect(currentRelease.getByRole("heading", { level: 2, name: APPLICATION_VERSION })).toBeVisible();
  await expect(currentRelease.locator('time[datetime="2026-08-31"]')).toHaveText("31 August 2026");
  await expect(page.getByRole("link", { name: /source repository/i })).toHaveAttribute(
    "href",
    "https://github.com/stellarchain/io.stellarkey",
  );
  await expect(page.locator("article")).not.toContainText(/<script|<strong|<a /i);
});

test("the landing page tells the private payments story with its limits attached", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { level: 2, name: "Then it goes quiet." })).toBeVisible();
  const act = page.locator("#private");
  await expect(act).toContainText("preview on Stellar testnet");
  await expect(act).toContainText("public by design");
  await expect(act).toContainText("Privacy grows with more independent activity");
  await expect(act).toContainText("not a guarantee");
  await expect(
    page.locator("#private-how").getByRole("link", { name: "Read exactly how it works →" }),
  ).toHaveAttribute("href", "/private");

  const landing = await page.locator("main").innerText();
  expect(landing).not.toMatch(
    /anonymous|untraceable|100% confidential|metadata-free|secretly|guaranteed private|privacy score|anonymity score/i,
  );
});

test("unknown routes return a branded, non-indexable 404", async ({ page }) => {
  const response = await page.goto("/definitely-not-a-stellarkey-route", {
    waitUntil: "domcontentloaded",
  });

  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle("Page not found — StellarKey");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expectReleaseIdentity(page, "footer");
  expect(await page.locator('meta[name="robots"]').evaluateAll((nodes) =>
    nodes.some((node) => /noindex/i.test(node.getAttribute("content") ?? "")),
  )).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
