import type { NetworkKey } from "./stellar";
import type { AssetBalance } from "./types";
import type { FiatCurrency } from "./format";
import { withAbortDeadline } from "./wallet-refresh";

export interface PricedAssetIdentity {
  code: string;
  issuer: string | null;
  network: NetworkKey;
}

export type AssetPrices = Record<string, number>;

const MAINNET_USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

export function assetPriceKey(
  network: NetworkKey,
  code: string,
  issuer?: string | null,
): string {
  return `${network}:${code.trim().toUpperCase()}:${issuer?.trim() ?? "native"}`;
}

const COINGECKO_IDS: Record<string, string> = {
  [assetPriceKey("mainnet", "USDC", MAINNET_USDC_ISSUER)]: "usd-coin",
};

interface CacheEntry {
  prices: AssetPrices;
  at: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL = 60_000;
const MARKET_REQUEST_TIMEOUT_MS = 8_000;

export type FiatRates = Partial<Record<FiatCurrency, number>> & { USD: 1 };

const FIAT_CODES: FiatCurrency[] = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"];
let fiatCache: { rates: FiatRates; at: number } | null = null;

export function parseFiatRates(
  raw: Record<string, { value?: unknown }>,
): FiatRates {
  const usd = raw.usd?.value;
  const rates: FiatRates = { USD: 1 };
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return rates;
  for (const code of FIAT_CODES) {
    if (code === "USD") continue;
    const value = raw[code.toLowerCase()]?.value;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      rates[code] = value / usd;
    }
  }
  return rates;
}

export async function fetchFiatRates(signal?: AbortSignal): Promise<FiatRates> {
  if (fiatCache && Date.now() - fiatCache.at < CACHE_TTL) return fiatCache.rates;
  try {
    return await withAbortDeadline(async (signal) => {
      const response = await fetch("https://api.coingecko.com/api/v3/exchange_rates", { signal });
      if (!response.ok) return fiatCache?.rates ?? { USD: 1 };
      const json = (await response.json()) as { rates?: Record<string, { value?: unknown }> };
      const rates = parseFiatRates(json.rates ?? {});
      fiatCache = { rates, at: Date.now() };
      return rates;
    }, { timeoutMs: MARKET_REQUEST_TIMEOUT_MS, label: "Fiat rates", signal });
  } catch {
    return fiatCache?.rates ?? { USD: 1 };
  }
}

export async function fetchAssetPrices(assets: PricedAssetIdentity[]): Promise<AssetPrices> {
  const wanted = [...new Set(
    assets.map((asset) => assetPriceKey(asset.network, asset.code, asset.issuer)),
  )].filter((key) => COINGECKO_IDS[key] !== undefined);
  if (wanted.length === 0) return {};

  if (cache && Date.now() - cache.at < CACHE_TTL) {
    const filtered: AssetPrices = {};
    for (const key of wanted) {
      const price = cache.prices[key];
      if (price !== undefined) filtered[key] = price;
    }
    return filtered;
  }

  try {
    const ids = [...new Set(wanted.map((key) => COINGECKO_IDS[key]))];
    return await withAbortDeadline(async (signal) => {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`,
        { signal },
      );
      if (!response.ok) return cache?.prices ?? {};
      const json = (await response.json()) as Record<string, { usd?: number }>;
      const prices: AssetPrices = {};
      for (const key of wanted) {
        const price = json[COINGECKO_IDS[key]]?.usd;
        if (typeof price === "number" && Number.isFinite(price)) prices[key] = price;
      }
      cache = { prices, at: Date.now() };
      return prices;
    }, { timeoutMs: MARKET_REQUEST_TIMEOUT_MS, label: "Asset prices" });
  } catch {
    return cache?.prices ?? {};
  }
}

export function estimatePortfolioUsd(
  balances: AssetBalance[],
  xlmUsd: number | null,
  assetPrices: AssetPrices,
  network: NetworkKey,
): number {
  if (network !== "mainnet") return 0;
  let total = 0;
  for (const balance of balances) {
    const amount = Number(balance.balance);
    if (!Number.isFinite(amount)) continue;
    if (balance.isNative) {
      total += amount * (xlmUsd ?? 0);
      continue;
    }
    if (!balance.issuer) continue;
    const price = assetPrices[assetPriceKey(network, balance.code, balance.issuer)];
    if (typeof price === "number") total += amount * price;
  }
  return total;
}

export function getUnitPrice(
  code: string,
  issuer: string | null | undefined,
  network: NetworkKey,
  isNative: boolean,
  xlmUsd: number | null,
  assetPrices: AssetPrices,
): number | null {
  if (network !== "mainnet") return null;
  if (isNative) return xlmUsd;
  if (!issuer) return null;
  return assetPrices[assetPriceKey(network, code, issuer)] ?? null;
}
