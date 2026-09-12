import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { importTestWallet, installNetworkFixtures, installQuietEventSource, testAccount, testPassword, testSecret } from "./fixtures";

test("balance and chart omit timestamps and reuse public price requests until the five-minute expiry", async ({ context, page, browserName }) => {
  const observedAt = 1_800_000_000_000;
  const calls = new Map<string, number>();
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
  await context.route("https://api.coingecko.com/**", async route => {
    const url = new URL(route.request().url());
    const key = url.pathname.endsWith("/market_chart") ? `chart:${url.searchParams.get("days")}`
      : url.pathname.endsWith("/exchange_rates") ? "fiat" : "spot";
    calls.set(key, (calls.get(key) ?? 0) + 1);
    await route.fallback();
  });
  await context.route("**/*", async route => {
    const host = new URL(route.request().url()).hostname;
    if (["127.0.0.1", "api.coingecko.com", "horizon-testnet.stellar.org", "soroban-testnet.stellar.org"].includes(host)) return route.fallback();
    await route.abort();
  });
  await page.clock.setFixedTime(observedAt);
  await importTestWallet(page);
  await expect(page.getByLabel("7D market price summary")).toBeVisible();
  await expect(page.getByText(/^Rate updated ·/)).toHaveCount(0);
  const chart = page.locator("section").filter({ has: page.getByText("XLM Market", { exact: true }) });
  await expect(chart.getByRole("button", { name: /refresh|retry/i })).toHaveCount(0);
  await expect.poll(() => Object.fromEntries(calls)).toEqual({ "chart:7": 1, fiat: 1, spot: 1 });

  await page.clock.setFixedTime(observedAt + 120_000);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Updating", { exact: true })).toBeHidden();
  expect(Object.fromEntries(calls)).toEqual({ "chart:7": 1, fiat: 1, spot: 1 });
  await chart.getByRole("button", { name: "1D", exact: true }).click();
  await expect(page.getByLabel("1D market price summary")).toBeVisible();
  await chart.getByRole("button", { name: "7D", exact: true }).click();
  await expect(page.getByLabel("7D market price summary")).toBeVisible();
  expect(Object.fromEntries(calls)).toEqual({ "chart:7": 1, "chart:1": 1, fiat: 1, spot: 1 });

  await page.clock.setFixedTime(observedAt + 300_000);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => Object.fromEntries(calls)).toEqual({ "chart:7": 2, "chart:1": 1, fiat: 2, spot: 2 });
  await expect(page.getByText("Updating", { exact: true })).toBeHidden();
  const range = chart.getByRole("button", { name: "1D", exact: true });
  await range.focus();
  await page.keyboard.press("Enter");
  await expect(range).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("1D market price summary")).toBeVisible();
  expect(calls.get("chart:1")).toBe(1);

  const results = await new AxeBuilder({ page })
    .include(".dashboard-home-balance-card")
    .include("section:has([data-market-range-selector])")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    // WebKit cannot reliably resolve contrast through the existing blurred surfaces.
    .disableRules(browserName === "webkit" ? ["color-contrast"] : [])
    .analyze();
  expect(results.violations.filter(v => v.impact === "critical" || v.impact === "serious")
    .map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))).toEqual([]);
});

test("Mainnet quote expiry at the tip action preserves the ticket and price retry restores checkout", async ({ context, page }) => {
  const observedAt = 1_800_000_000_000;
  let outage = false;
  const issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
  // This Mainnet UI scenario is entirely synthetic. No live transport or signing.
  await context.route("https://horizon.stellar.org/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const account = /^\/accounts\/[^/]+$/.test(pathname);
    const body = account ? {
      id: testAccount, account_id: testAccount, sequence: "1000000000",
      subentry_count: 1, num_sponsoring: 0, num_sponsored: 0,
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      signers: [{ key: testAccount, weight: 1, type: "ed25519_public_key" }],
      balances: [
        { asset_type: "native", balance: "1000.0000000", selling_liabilities: "0.0000000" },
        { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: issuer, balance: "1000.0000000", selling_liabilities: "0.0000000", limit: "1000000.0000000" },
      ],
    } : pathname === "/" ? {
      network_passphrase: "Public Global Stellar Network ; September 2015", history_latest_ledger: 100_000,
    } : pathname === "/fee_stats" ? {
      last_ledger_base_fee: "100", fee_charged: { min: "100", mode: "100", p90: "100", p99: "100" },
    } : { _embedded: { records: pathname === "/ledgers" ? [{ base_reserve_in_stroops: 5_000_000, sequence: 100_000 }] : [] } };
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await context.route("https://api.coingecko.com/**", async (route) => {
    if (!outage) return route.fallback();
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await context.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (["127.0.0.1", "api.coingecko.com", "horizon.stellar.org", "horizon-testnet.stellar.org"].includes(host)) return route.fallback();
    await route.abort();
  });
  await page.clock.setFixedTime(observedAt);
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("stellarkey.network.v1", "mainnet"); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import Existing Wallet" }).click();
  await page.getByPlaceholder("S... or apple banana cherry...").fill(testSecret);
  await page.getByPlaceholder("Enter password").fill(testPassword);
  await page.getByPlaceholder("Repeat password").fill(testPassword);
  await page.getByRole("button", { name: "Unlock & Import" }).click();
  await expect(page.getByText("Your Assets", { exact: true })).toBeVisible();
  // Use the mobile navigation shared with the existing merchant journey.
  await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Merchant Mode" }).click();
  const setup = page.getByRole("dialog", { name: /Set Up Merchant Mode/ });
  await setup.getByLabel("Shop Name").fill("Synthetic freshness shop");
  await setup.getByRole("button", { name: "Continue" }).click();
  await expect(setup.getByText("Trustline held", { exact: true })).toBeVisible();
  await setup.getByRole("button", { name: "Continue" }).click();
  await setup.getByRole("button", { name: "Continue" }).click();
  await setup.getByRole("textbox", { name: "Staff PIN", exact: true }).fill("2468");
  await setup.getByRole("textbox", { name: "Confirm staff PIN", exact: true }).fill("2468");
  await setup.getByRole("button", { name: "Open the Till" }).click();
  await expect(setup).toBeHidden();
  await page.getByRole("button", { name: "Open Shift", exact: true }).first().click();
  const shift = page.getByRole("dialog", { name: /Open Shift/ });
  await shift.getByLabel("Opening float").fill("0");
  await shift.getByRole("button", { name: "Open Shift", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "1", exact: true }).first().click();
  await page.getByRole("button", { name: "00", exact: true }).first().click();
  await page.getByRole("button", { name: "Add to Ticket" }).click();
  const charge = page.getByRole("button", { name: "Charge", exact: true });
  await expect(charge).toBeEnabled();
  await charge.click();
  const tip = page.getByRole("dialog", { name: /Add a tip/ });
  await expect(tip).toBeVisible();
  // Advancing Date only avoids triggering auto-lock or the periodic refresh:
  // the action must reject the samples even if availability was just rendered.
  await page.clock.setFixedTime(observedAt + 3600_000);
  outage = true;
  await tip.getByRole("button", { name: "No tip" }).click();
  await expect(page.getByRole("dialog", { name: /^Charge/ })).toBeHidden();
  await expect(page.getByText("No live price is available for the assets you accept, so an amount cannot be quoted.", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry Prices" })).toBeVisible();
  await page.getByRole("button", { name: "Retry Prices" }).click();
  await expect(page.getByRole("button", { name: "Retry Prices" })).toBeEnabled();
  await expect(charge).toBeDisabled();
  outage = false;
  await page.getByRole("button", { name: "Retry Prices" }).click();
  await expect(charge).toBeEnabled();
  await charge.click();
  await tip.getByRole("button", { name: "No tip" }).click();
  await expect(page.getByRole("dialog", { name: /^Charge/ })).toBeVisible();
});

test.use({ viewport: { width: 393, height: 852 } });
