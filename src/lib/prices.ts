import type { AssetBalance } from "./types";

/**
 * Multi-asset USD pricing for known Stellar assets via CoinGecko,
 * with a 60s in-memory cache and graceful degradation to {} on failure.
 */
const COINGECKO_IDS: Record<string, string> = {
  USDC: "usd-coin",
  EURC: "euro-coin",
  AQUA: "aquarius",
  BTC: "bitcoin",
  ETH: "ethereum",
};

export type AssetPrices = Record<string, number>;

interface CacheEntry {
  prices: AssetPrices;
  at: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL = 60_000;

export async function fetchAssetPrices(codes: string[]): Promise<AssetPrices> {
  const wanted = [...new Set(codes.map((c) => c.trim().toUpperCase()))].filter(
    (c) => COINGECKO_IDS[c] !== undefined && c !== "",
  );
  if (wanted.length === 0) return {};

  if (cache && Date.now() - cache.at < CACHE_TTL) {
    const filtered: AssetPrices = {};
    for (const c of wanted) {
      const v = cache.prices[c];
      if (v !== undefined) filtered[c] = v;
    }
    return filtered;
  }

  try {
    const ids = wanted.map((c) => COINGECKO_IDS[c]).join(",");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
    );
    if (!res.ok) return cache?.prices ?? {};
    const json = (await res.json()) as Record<string, { usd?: number }>;
    const prices: AssetPrices = {};
    for (const c of wanted) {
      const v = json[COINGECKO_IDS[c]]?.usd;
      if (typeof v === "number") prices[c] = v;
    }
    cache = { prices, at: Date.now() };
    return prices;
  } catch {
    return cache?.prices ?? {};
  }
}

/**
 * Best-effort USD valuation of a set of balances:
 * native XLM × live price, plus any priced assets (USDC, BTC, ...).
 * Unpriced assets contribute 0 rather than blocking the total.
 */
export function estimatePortfolioUsd(
  balances: AssetBalance[],
  xlmUsd: number | null,
  assetPrices: AssetPrices,
): number {
  let total = 0;
  for (const b of balances) {
    const amount = parseFloat(b.balance);
    if (!Number.isFinite(amount)) continue;
    if (b.isNative) {
      total += amount * (xlmUsd ?? 0);
      continue;
    }
    const price = assetPrices[b.code.trim().toUpperCase()];
    if (typeof price === "number") total += amount * price;
  }
  return total;
}

/** Unit price for an asset code, or null when unknown */
export function getUnitPrice(
  code: string,
  isNative: boolean,
  xlmUsd: number | null,
  assetPrices: AssetPrices,
): number | null {
  if (isNative) return xlmUsd;
  const price = assetPrices[code.trim().toUpperCase()];
  return typeof price === "number" ? price : null;
}
