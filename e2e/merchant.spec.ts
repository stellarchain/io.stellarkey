import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MERCHANT_E2E_PORT ?? 3187);
const origin = `http://127.0.0.1:${port}`;
const account = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";
const secret = "SADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP54X";
const payer = "GD6ROJBYLKQMOW3E7N4M2YBPUHMZD7PL65VRHRMO24BOVSBV5H3BQRSL";
const usdcIssuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const password = "Correct-Horse-2026!";

type HorizonPayment = {
  id: string;
  type: "payment";
  transaction_hash: string;
  transaction_successful: true;
  created_at: string;
  paging_token: string;
  to: string;
  from: string;
  asset_type: "native";
  amount: string;
  transaction: { memo: string; memo_type: "text"; successful: true };
};

let server: ChildProcessWithoutNullStreams | null = null;
let serverLog = "";

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The process is still binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Merchant E2E server did not start.\n${serverLog}`);
}

test.before(async () => {
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)],
    { cwd: root, env: { ...process.env, NODE_ENV: "production" } },
  );
  server.stdout.on("data", (chunk) => {
    serverLog += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverLog += chunk.toString();
  });
  await waitForServer();
});

test.after(async () => {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 3_000))]);
});

function accountBody(publicKey: string) {
  return {
    id: publicKey,
    account_id: publicKey,
    sequence: "1000000000",
    subentry_count: 1,
    num_sponsoring: 0,
    num_sponsored: 0,
    thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
    signers: [{ key: publicKey, weight: 1, type: "ed25519_public_key" }],
    balances: [
      {
        asset_type: "native",
        balance: "1000.0000000",
        selling_liabilities: "0.0000000",
      },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: usdcIssuer,
        balance: "1000.0000000",
        selling_liabilities: "0.0000000",
        limit: "1000000.0000000",
      },
    ],
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installNetworkFixtures(
  context: BrowserContext,
  incoming: HorizonPayment[],
  acceptedTransactions: Set<string>,
) {
  await context.route("https://api.coingecko.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/exchange_rates")) {
      await json(route, {
        rates: {
          usd: { value: 1 },
          eur: { value: 0.92 },
          gbp: { value: 0.78 },
          jpy: { value: 150 },
          cad: { value: 1.35 },
          aud: { value: 1.5 },
          chf: { value: 0.88 },
        },
      });
      return;
    }
    await json(route, { stellar: { usd: 0.25 }, "usd-coin": { usd: 1 } });
  });

  await context.route("https://horizon-testnet.stellar.org/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (request.method() === "POST" && pathname === "/transactions") {
      const form = new URLSearchParams(request.postData() ?? "");
      const xdr = form.get("tx");
      assert.ok(xdr, "Horizon submission must contain an envelope");
      const transaction = TransactionBuilder.fromXdr(xdr, Networks.TESTNET);
      const hash = Buffer.from(transaction.hash()).toString("hex");
      acceptedTransactions.add(hash);
      await json(route, { hash, successful: true, ledger: 100_010 });
      return;
    }

    const transactionMatch = pathname.match(/^\/transactions\/([0-9a-f]{64})$/i);
    if (transactionMatch) {
      const hash = transactionMatch[1].toLowerCase();
      await json(
        route,
        acceptedTransactions.has(hash) ? { hash, successful: true, ledger: 100_010 } : {},
        acceptedTransactions.has(hash) ? 200 : 404,
      );
      return;
    }

    const paymentsMatch = pathname.match(/^\/accounts\/([^/]+)\/payments$/);
    if (paymentsMatch) {
      const cursor = url.searchParams.get("cursor");
      const records = incoming.filter(
        (payment) => cursor === null || BigInt(payment.paging_token) > BigInt(cursor),
      );
      await json(route, { _embedded: { records } });
      return;
    }

    const operationsMatch = pathname.match(/^\/accounts\/([^/]+)\/operations$/);
    if (operationsMatch) {
      await json(route, { _embedded: { records: [] } });
      return;
    }

    const accountMatch = pathname.match(/^\/accounts\/([^/]+)$/);
    if (accountMatch) {
      await json(route, accountBody(accountMatch[1]));
      return;
    }

    if (pathname === "/ledgers") {
      await json(route, {
        _embedded: { records: [{ base_reserve_in_stroops: "5000000", sequence: 100_000 }] },
      });
      return;
    }

    if (pathname === "/fee_stats") {
      await json(route, {
        fee_charged: { mode: "100", p50: "100", p90: "100", p95: "100" },
        max_fee: { mode: "100" },
      });
      return;
    }

    await json(route, { _embedded: { records: [] } });
  });
}

async function assertMobileSurface(page: Page, label: string) {
  const measurements = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
  }));
  assert.ok(
    measurements.scrollWidth <= measurements.clientWidth,
    `${label} overflows horizontally: ${measurements.scrollWidth} > ${measurements.clientWidth}`,
  );
  assert.match(measurements.viewport, /maximum-scale=1/);
  assert.match(measurements.viewport, /user-scalable=no/);
}

async function enterKeypadAmount(page: Page, keys: string[]) {
  for (const key of keys) {
    await page.getByRole("button", { name: key, exact: true }).first().click();
  }
  await page.getByRole("button", { name: "Add to ticket" }).click();
}

async function openOtherTender(page: Page) {
  await page.getByRole("button", { name: "More ticket actions" }).click();
  await page.getByRole("menuitem", { name: /Other tender/ }).click();
  return page.getByRole("dialog", { name: /Other tender/ });
}

async function raiseCryptoCharge(page: Page, keys: string[]) {
  await enterKeypadAmount(page, keys);
  await page.getByRole("button", { name: "Charge", exact: true }).click();
  const tip = page.getByRole("dialog", { name: /Add a tip/ });
  await tip.getByRole("button", { name: "No tip" }).click();
  const chargeDialog = page.getByRole("dialog", { name: /^Charge/ });
  await chargeDialog.getByText("Waiting for payment", { exact: true }).waitFor();
  const charge = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("wallet.merchant.v2") ?? "null");
    return store?.charges?.[0] ?? null;
  });
  assert.ok(charge, "raising a charge must persist it before displaying the QR");
  const quote = charge.quotes.find((candidate: { asset: { code: string } }) => candidate.asset.code === "XLM");
  assert.ok(quote, "test charge must expose its native quote");
  return { chargeDialog, charge, quote };
}

function incomingPayment(
  id: string,
  reference: string,
  amount: string,
  ledger: number,
): HorizonPayment {
  return {
    id,
    type: "payment",
    transaction_hash: id.padEnd(64, "a").slice(0, 64),
    transaction_successful: true,
    created_at: new Date().toISOString(),
    paging_token: String((BigInt(ledger) << BigInt(32)) + BigInt(1)),
    to: account,
    from: payer,
    asset_type: "native",
    amount,
    transaction: { memo: reference, memo_type: "text", successful: true },
  };
}

async function openStaffSettings(page: Page) {
  await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "Settings" }).click();
  await page.getByText("Staff & terminals", { exact: true }).click();
  await page.getByRole("heading", { name: "Staff & this device" }).waitFor();
}

async function returnToTill(page: Page) {
  await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "Merchant" }).click();
  const till = page.getByRole("button", { name: "Till", exact: true });
  if (await till.count()) await till.click();
  await page.getByText(/Shift 1 · Front counter/).waitFor();
}

test(
  "merchant journeys remain exact, persisted, operable, and mobile-safe",
  { timeout: 120_000 },
  async () => {
    const incoming: HorizonPayment[] = [];
    const acceptedTransactions = new Set<string>();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    let browser: Browser | null = null;
    let diagnosticPage: Page | null = null;

    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        acceptDownloads: true,
        permissions: ["clipboard-read", "clipboard-write"],
      });
      await context.addInitScript(() => {
        class QuietEventSource extends EventTarget {
          static readonly CONNECTING = 0;
          static readonly OPEN = 1;
          static readonly CLOSED = 2;
          readonly url: string;
          readonly withCredentials = false;
          readyState = QuietEventSource.OPEN;
          onopen: ((event: Event) => void) | null = null;
          onmessage: ((event: MessageEvent) => void) | null = null;
          onerror: ((event: Event) => void) | null = null;

          constructor(url: string | URL) {
            super();
            this.url = String(url);
          }

          close() {
            this.readyState = QuietEventSource.CLOSED;
          }
        }
        Object.defineProperty(window, "EventSource", { configurable: true, value: QuietEventSource });
      });
      await installNetworkFixtures(context, incoming, acceptedTransactions);

      const page = await context.newPage();
      diagnosticPage = page;
      page.setDefaultTimeout(10_000);
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));

      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: "domcontentloaded" });

      // First run: import a deterministic key and complete every merchant setup step.
      await page.getByRole("button", { name: "Import Existing Wallet" }).click();
      await page.getByPlaceholder("S... or apple banana cherry...").fill(secret);
      await page.getByPlaceholder("Enter password").fill(password);
      await page.getByPlaceholder("Repeat password").fill(password);
      await page.getByRole("button", { name: "Unlock & Import" }).click();
      await page.getByText("Total Portfolio", { exact: true }).waitFor();

      await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "Settings" }).click();
      await page.getByRole("switch", { name: "Merchant Mode" }).click();
      const setup = page.getByRole("dialog", { name: /Set up Merchant Mode/ });
      await setup.getByLabel("Shop name").fill("North Star Coffee");
      await setup.getByRole("button", { name: "Continue" }).click();
      await setup.getByText("Trustline held", { exact: true }).waitFor();
      await setup.getByRole("button", { name: "Continue" }).click();
      await setup.getByText("Step 3 of 4", { exact: false }).waitFor();
      await setup.getByRole("button", { name: "Continue" }).click();
      await setup.getByRole("textbox", { name: "Staff PIN", exact: true }).fill("2468");
      await setup.getByRole("textbox", { name: "Confirm staff PIN", exact: true }).fill("2468");
      await setup.getByRole("button", { name: "Open the till" }).click();
      await setup.waitFor({ state: "hidden" });
      await assertMobileSurface(page, "first merchant till");

      await page.getByRole("button", { name: "Open shift", exact: true }).click();
      const opening = page.getByRole("dialog", { name: /Open shift/ });
      await opening.getByLabel("Opening float").fill("100");
      await opening.getByRole("button", { name: "Open shift", exact: true }).click();
      await page.getByText(/Shift 1 · Front counter/).waitFor();
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();

      // Cash settlement is persisted with exact received and change values.
      await enterKeypadAmount(page, ["1", "00"]);
      const cashTender = await openOtherTender(page);
      await cashTender.getByRole("button", { name: /Exact/ }).click();
      await cashTender.getByRole("button", { name: "Take € 1.00 cash" }).click();
      await page.getByText("Order 1001 settled", { exact: true }).waitFor();

      // Reload locks the vault but does not lose the shift, till, or settled order.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByPlaceholder("Enter password").fill(password);
      await page.getByRole("button", { name: "Unlock Vault" }).click();
      await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "Merchant" }).click();
      await page.getByText(/Shift 1 · Front counter/).waitFor();
      await page.getByRole("button", { name: "Orders", exact: true }).click();
      await page.getByRole("button", { name: "Open the receipt for order #1001" }).waitFor();
      await assertMobileSurface(page, "reloaded orders");

      // Staff is a local till role. Add a server and switch with its real PIN.
      await openStaffSettings(page);
      await page.getByLabel("Staff member to switch to").click();
      await page.getByRole("option", { name: /Imported Account/ }).click();
      await page.getByLabel("Staff PIN").fill("2468");
      await page.getByRole("button", { name: "Switch", exact: true }).click();
      await page.getByRole("button", { name: "Add staff" }).click();
      const addStaff = page.getByRole("dialog", { name: /Add staff/ });
      await addStaff.getByLabel("Staff name").fill("Counter Server");
      await addStaff.getByLabel("New staff PIN", { exact: true }).fill("1357");
      await addStaff.getByLabel("Confirm new staff PIN").fill("1357");
      await addStaff.getByRole("button", { name: "Add staff", exact: true }).click();
      await addStaff.waitFor({ state: "hidden" });
      await page.getByLabel("Staff member to switch to").click();
      await page.getByRole("option", { name: /Counter Server/ }).click();
      await page.getByLabel("Staff PIN").fill("1357");
      await page.getByRole("button", { name: "Switch", exact: true }).click();
      await page.getByText("Counter Server", { exact: true }).first().waitFor();
      await returnToTill(page);

      // A real Horizon payment settles a high-value crypto order and creates a customer record.
      const crypto = await raiseCryptoCharge(page, ["3", "00", "0"]);
      incoming.push(incomingPayment("pay1002", crypto.charge.reference, crypto.quote.amount, 100_001));
      const paidCrypto = page.getByRole("dialog").filter({ hasText: "Paid in full" });
      await paidCrypto.getByText("Paid in full", { exact: true }).waitFor({ timeout: 12_000 });
      await paidCrypto.getByRole("button", { name: "Close", exact: true }).click();

      await page.getByRole("button", { name: "Customers", exact: true }).click();
      await page.getByRole("button", { name: "Open the card for Unnamed customer" }).click();
      const customer = page.getByRole("dialog", { name: "Unnamed customer" });
      await customer.getByLabel("Contact name").fill("Ada Customer");
      await customer.getByRole("button", { name: "Save contact" }).click();
      const namedCustomer = page.getByRole("dialog", { name: "Ada Customer" });
      await namedCustomer.getByRole("button", { name: "Start a card" }).click();
      await namedCustomer.getByLabel("Note").fill("Prefers the quiet table.");
      await namedCustomer.getByRole("button", { name: "Save note" }).click();
      await namedCustomer.getByText("Loyalty card", { exact: true }).waitFor();
      await namedCustomer.getByRole("button", { name: "Close", exact: true }).click();

      // The server's €20 ceiling turns the €30 refund into an approval request.
      await page.getByRole("button", { name: "Orders", exact: true }).click();
      await page.getByRole("button", { name: "Open the receipt for order #1002" }).click();
      const order = page.getByRole("dialog", { name: /Order #1002/ });
      await order.getByRole("button", { name: "Issue a refund" }).click();
      await order.getByRole("button", { name: "Refund € 30.00" }).click();
      await page.getByText("Sent € 30.00 for approval", { exact: true }).waitFor();
      await order.getByRole("button", { name: "Close", exact: true }).click();

      // Switch back to the owner; approval still signs through the unlocked vault.
      await openStaffSettings(page);
      await page.getByLabel("Staff member to switch to").click();
      await page.getByRole("option", { name: /Imported Account/ }).click();
      await page.getByLabel("Staff PIN").fill("2468");
      await page.getByRole("button", { name: "Switch", exact: true }).click();
      await page.getByRole("button", { name: "Approve" }).click();
      await page.getByText("Approved & confirmed", { exact: true }).waitFor({ timeout: 12_000 });
      await returnToTill(page);

      // Split settlement retains both the cash leg and the exact crypto remainder.
      await enterKeypadAmount(page, ["4", "00"]);
      const split = await openOtherTender(page);
      await split.getByRole("button", { name: "Split", exact: true }).click();
      await split.getByLabel("First part amount").fill("2.00");
      await split.getByRole("button", { name: "Record split" }).click();
      const splitCharge = page.getByRole("dialog", { name: /^Charge/ });
      await splitCharge.getByText("Waiting for payment", { exact: true }).waitFor();
      const splitState = await page.evaluate(() => {
        const store = JSON.parse(localStorage.getItem("wallet.merchant.v2") ?? "null");
        const charge = store?.charges?.[0];
        return {
          charge,
          quote: charge?.quotes?.find((candidate: { asset: { code: string } }) => candidate.asset.code === "XLM"),
        };
      });
      assert.ok(splitState.charge && splitState.quote);
      incoming.push(
        incomingPayment("pay1003", splitState.charge.reference, splitState.quote.amount, 100_002),
      );
      const paidSplit = page.getByRole("dialog").filter({ hasText: "Paid in full" });
      await paidSplit.getByText("Paid in full", { exact: true }).waitFor({ timeout: 12_000 });
      await paidSplit.getByRole("button", { name: "Close", exact: true }).click();

      // Invoice: draft, issue, and external payment are all real persisted transitions.
      await page.getByRole("button", { name: "Invoices", exact: true }).click();
      await page.getByRole("button", { name: "New invoice" }).first().click();
      const composer = page.getByRole("dialog", { name: /New invoice/ });
      await composer.getByLabel("Customer").fill("Praça Hotel");
      await composer.getByRole("button", { name: /Free-text line/ }).click();
      await composer.getByLabel("Line description").fill("Wholesale beans");
      await composer.getByLabel("Unit price").fill("42.00");
      await composer.getByRole("button", { name: "Save draft" }).click();
      const invoiceRow = page.getByRole("button", { name: /INV-.*Praça Hotel/ });
      await invoiceRow.click();
      const invoice = page.getByRole("dialog", { name: /INV-/ });
      await invoice.getByRole("button", { name: "Issue invoice" }).click();
      await invoice.getByRole("button", { name: "Record payment" }).click();
      await invoice.getByLabel(/Amount · EUR/).fill("42.00");
      await invoice.getByLabel("Evidence note").fill("Bank transfer checked");
      await invoice.getByRole("button", { name: "Record payment", exact: true }).last().click();
      await invoice.getByText("Paid", { exact: true }).first().waitFor();
      await invoice.getByRole("button", { name: "Close", exact: true }).click();

      // Counter code publishes an immutable, exact reusable request.
      await page.getByRole("button", { name: "Counter codes", exact: true }).click();
      await page.getByRole("button", { name: "New code" }).first().click();
      const code = page.getByRole("dialog", { name: /New counter code/ });
      await code.getByLabel("Title").fill("Retail shelf");
      await code.getByLabel("Shop price").fill("5.00");
      await code.getByRole("button", { name: "Publish code" }).click();
      await page.getByText("Retail shelf", { exact: true }).waitFor();

      // Export is a real browser download with a truthful, inspectable filename.
      await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "Settings" }).click();
      await page.getByText("Tax records", { exact: true }).click();
      await page.getByRole("heading", { name: "Tax records" }).waitFor();
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export", exact: true }).click();
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), /^merchant-.*\.csv$/);

      // The install handoff appears only after the browser says installation is available.
      await page.evaluate(() => {
        const promptEvent = new Event("beforeinstallprompt");
        Object.defineProperty(promptEvent, "prompt", {
          value: async () => {
            (window as Window & { __merchantInstallPrompted?: boolean }).__merchantInstallPrompted = true;
          },
        });
        window.dispatchEvent(promptEvent);
      });
      await page.getByRole("button", { name: "Back to Merchant settings" }).click();
      await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "Home" }).click();
      await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "Settings" }).click();
      await page.getByText("Install App", { exact: true }).click();
      assert.equal(
        await page.evaluate(
          () => (window as Window & { __merchantInstallPrompted?: boolean }).__merchantInstallPrompted,
        ),
        true,
      );

      // Offline and reconnect states reflect the browser, then clear without a reload.
      await returnToTill(page);
      await context.setOffline(true);
      await page.getByText("Offline — confirmation is paused", { exact: true }).waitFor();
      await context.setOffline(false);
      await page.getByText("Back online — reconciliation resumed", { exact: true }).waitFor();

      // A blind count closes the exact shift and emits the immutable Z report.
      await page.getByRole("button", { name: "Shift 1", exact: true }).click();
      const shift = page.getByRole("dialog", { name: /Shift 1/ });
      await shift.getByRole("button", { name: "Count drawer & close" }).click();
      const blindCount = page.getByRole("dialog", { name: "Blind cash count" });
      await blindCount.getByLabel("What is in the drawer").fill("103.00");
      await blindCount.getByRole("button", { name: "Commit count & issue Z" }).click();
      await page.getByRole("dialog", { name: "Z-report 1" }).getByText(/Z-1 issued · shift closed/).waitFor();
      await assertMobileSurface(page, "closed shift report");

      assert.deepEqual(pageErrors, [], `Unhandled page errors:\n${pageErrors.join("\n")}`);
      assert.deepEqual(consoleErrors, [], `Console errors:\n${consoleErrors.join("\n")}`);
    } catch (cause) {
      const body = await diagnosticPage?.locator("body").innerText().catch(() => "");
      const message = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
      throw new Error(
        `${message}\n\nVisible page:\n${body?.slice(0, 2_500) ?? ""}\n\nConsole:\n${consoleErrors.join("\n")}`,
      );
    } finally {
      await browser?.close();
    }
  },
);
