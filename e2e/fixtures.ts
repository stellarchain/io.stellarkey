import { expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import { Networks, TransactionBuilder } from "@stellar/stellar-sdk";

export const testAccount = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";
export const testSecret = "SADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP54X";
export const testPayer = "GD6ROJBYLKQMOW3E7N4M2YBPUHMZD7PL65VRHRMO24BOVSBV5H3BQRSL";
export const testUsdcIssuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const testPassword = "Correct-Horse-2026!";

export interface HorizonPayment {
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
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function accountBody(publicKey: string, nativeBalance = "1000.0000000") {
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
        balance: nativeBalance,
        selling_liabilities: "0.0000000",
      },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: testUsdcIssuer,
        balance: "1000.0000000",
        selling_liabilities: "0.0000000",
        limit: "1000000.0000000",
      },
    ],
  };
}

export async function installQuietEventSource(context: BrowserContext): Promise<void> {
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
}

export async function installNetworkFixtures(
  context: BrowserContext,
  options: {
    incoming?: HorizonPayment[];
    acceptedTransactions?: Set<string>;
    nativeBalance?: string;
  } = {},
): Promise<void> {
  const incoming = options.incoming ?? [];
  const acceptedTransactions = options.acceptedTransactions ?? new Set<string>();

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
    if (url.pathname.endsWith("/market_chart")) {
      await json(route, { prices: [[1_700_000_000_000, 0.24], [1_700_086_400_000, 0.25]] });
      return;
    }
    await json(route, { stellar: { usd: 0.25 }, "usd-coin": { usd: 1 } });
  });

  await context.route("https://horizon-testnet.stellar.org/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === "/") {
      await json(route, {
        network_passphrase: Networks.TESTNET,
        history_latest_ledger: 100_000,
      });
      return;
    }

    if (request.method() === "POST" && pathname === "/transactions") {
      const xdr = new URLSearchParams(request.postData() ?? "").get("tx");
      if (!xdr) throw new Error("Horizon submission must contain an envelope.");
      const transaction = TransactionBuilder.fromXdr(xdr, Networks.TESTNET);
      const hash = Buffer.from(transaction.hash()).toString("hex");
      acceptedTransactions.add(hash);
      await json(route, { hash, successful: true, ledger: 100_010 });
      return;
    }

    const transactionMatch = pathname.match(/^\/transactions\/([0-9a-f]{64})$/i);
    if (transactionMatch) {
      const hash = transactionMatch[1].toLowerCase();
      const accepted = acceptedTransactions.has(hash);
      await json(route, accepted ? { hash, successful: true, ledger: 100_010 } : {}, accepted ? 200 : 404);
      return;
    }

    if (pathname === "/paths/strict-send") {
      await json(route, {
        _embedded: { records: [{ destination_amount: "0.2500000", path: [] }] },
      });
      return;
    }

    if (/^\/accounts\/[^/]+\/payments$/.test(pathname)) {
      const cursor = url.searchParams.get("cursor");
      const records = incoming.filter(
        (payment) => cursor === null || BigInt(payment.paging_token) > BigInt(cursor),
      );
      await json(route, { _embedded: { records } });
      return;
    }

    if (/^\/accounts\/[^/]+\/operations$/.test(pathname)) {
      await json(route, { _embedded: { records: [] } });
      return;
    }

    const accountMatch = pathname.match(/^\/accounts\/([^/]+)$/);
    if (accountMatch) {
      await json(route, accountBody(accountMatch[1], options.nativeBalance));
      return;
    }

    if (pathname === "/ledgers") {
      await json(route, {
        _embedded: { records: [{ base_reserve_in_stroops: 5_000_000, sequence: 100_000 }] },
      });
      return;
    }

    if (pathname === "/fee_stats") {
      await json(route, {
        last_ledger_base_fee: "100",
        fee_charged: { min: "100", mode: "100", p90: "100", p99: "100" },
      });
      return;
    }

    await json(route, { _embedded: { records: [] } });
  });

  await context.route("https://soroban-testnet.stellar.org/**", async (route) => {
    const request = route.request();
    const body = JSON.parse(request.postData() ?? "{}") as { id?: unknown; method?: unknown };
    if (request.method() === "POST" && body.method === "getNetwork") {
      await json(route, {
        jsonrpc: "2.0",
        id: body.id,
        result: { passphrase: Networks.TESTNET, protocolVersion: 25 },
      });
      return;
    }
    await json(route, { jsonrpc: "2.0", id: body.id, error: { message: "Unsupported test method" } }, 400);
  });
}

export async function importTestWallet(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import Existing Wallet" }).click();
  await page.getByPlaceholder("S... or apple banana cherry...").fill(testSecret);
  await page.getByPlaceholder("Enter password").fill(testPassword);
  await page.getByPlaceholder("Repeat password").fill(testPassword);
  await page.getByRole("button", { name: "Unlock & Import" }).click();
  await expect(page.getByText("Your Assets", { exact: true })).toBeVisible();
}

export function observePageFailures(page: Page): {
  consoleErrors: string[];
  pageErrors: string[];
} {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}
