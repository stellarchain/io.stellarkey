import type { NetworkKey } from "./stellar";
import type { AssetBalance } from "./types";
import type { FiatCurrency } from "./format";
import { lookupKnownAsset } from "./assets";
import { withAbortDeadline } from "./wallet-refresh";

export interface PricedAssetIdentity {
  code: string;
  issuer: string | null;
  network: NetworkKey;
}

export type AssetPrices = Record<string, number>;

export interface MarketSample {
  value: number | null;
  observedAt: number | null;
  status: "fresh" | "stale" | "unavailable" | "fixed";
}
export type MarketSamples = Record<string, MarketSample>;
export const MARKET_MAX_AGE_MS = 5 * 60_000;
export const USD_REFERENCE: MarketSample = { value: 1, observedAt: null, status: "fixed" };
export const UNAVAILABLE_MARKET_SAMPLE: MarketSample = { value: null, observedAt: null, status: "unavailable" };

export function isMarketObservationFresh(observedAt: number | null | undefined, now = Date.now(), maxAge = MARKET_MAX_AGE_MS): boolean {
  return typeof observedAt === "number" && Number.isFinite(observedAt) && now >= observedAt && now - observedAt < maxAge;
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function currentSample(sample: MarketSample, now = Date.now()): MarketSample {
  return sample.status === "fresh" && !isMarketObservationFresh(sample.observedAt, now)
    ? { ...sample, status: "stale" }
    : sample;
}

/** Numeric projections are for display only; quote construction requires samples. */
export function marketValues(samples: MarketSamples): AssetPrices {
  return Object.fromEntries(Object.entries(samples).flatMap(([key, sample]) => positive(sample.value) ? [[key, sample.value]] : []));
}

export function marketDataLabel(samples: Array<MarketSample | null | undefined>, now = Date.now()): string {
  if (samples.some((sample) => !sample || sample.value === null)) return "Rate unavailable";
  const live = samples.filter((sample): sample is MarketSample => !!sample && sample.status !== "fixed");
  if (live.length === 0) return "Fixed reference rate";
  const observedAt = Math.min(...live.map((sample) => sample.observedAt ?? 0));
  const status = live.some((sample) => currentSample(sample, now).status !== "fresh") ? "Stale rate" : "Rate updated";
  return `${status} · ${new Date(observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, ${new Date(observedAt).toLocaleDateString()}`;
}

/** Called again at each quote action; a render or a cache read grants no freshness. */
export function quoteCurrencyPerUnit(
  asset: PricedAssetIdentity,
  currency: FiatCurrency,
  assetSamples: MarketSamples,
  nativeSample: MarketSample | null,
  fiatSamples: MarketSamples,
  now = Date.now(),
): number | null {
  if (asset.network !== "mainnet") return null;
  const price = !asset.issuer && asset.code.toUpperCase() === "XLM"
    ? nativeSample
    : assetSamples[assetPriceKey(asset.network, asset.code, asset.issuer)];
  const fx = currency === "USD" ? USD_REFERENCE : fiatSamples[currency];
  if (!price || price.status !== "fresh" || !positive(price.value) || !isMarketObservationFresh(price.observedAt, now)) return null;
  if (!fx || !positive(fx.value) || (currency !== "USD" && (fx.status !== "fresh" || !isMarketObservationFresh(fx.observedAt, now)))) return null;
  const value = price.value * fx.value;
  return positive(value) ? value : null;
}

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

const CACHE_TTL = 60_000;
const MARKET_REQUEST_TIMEOUT_MS = 8_000;

export type FiatRates = Partial<Record<FiatCurrency, number>> & { USD: 1 };

const FIAT_CODES: FiatCurrency[] = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"];
type SampleCache = { samples: MarketSamples; request: number; observedBy: Record<string, number> };
const assetCache: SampleCache = { samples: {}, request: 0, observedBy: {} };
const fiatCache: SampleCache = { samples: {}, request: 0, observedBy: {} };
const nativeCache: SampleCache = { samples: {}, request: 0, observedBy: {} };

async function fetchSamples(
  cache: SampleCache,
  keys: string[],
  url: string,
  parse: (json: unknown) => AssetPrices,
  signal?: AbortSignal,
): Promise<MarketSamples> {
  const read = () => Object.fromEntries(keys.map((key) => [key, currentSample(cache.samples[key] ?? UNAVAILABLE_MARKET_SAMPLE)]));
  if (keys.length === 0) return {};
  if (keys.every((key) => cache.samples[key]?.status === "fresh" && isMarketObservationFresh(cache.samples[key].observedAt, Date.now(), CACHE_TTL))) return read();
  const request = ++cache.request;
  try {
    const values = await withAbortDeadline(async (requestSignal) => {
      const response = await fetch(url, { signal: requestSignal });
      if (!response.ok) throw new Error("Market data unavailable");
      const values = parse(await response.json());
      if (requestSignal.aborted) throw new Error("Market request cancelled");
      return values;
    }, { timeoutMs: MARKET_REQUEST_TIMEOUT_MS, label: "Market data", signal });
    if (!signal?.aborted) {
      const observedAt = Date.now();
      for (const key of keys) {
        // Independent consumers may finish while a later request is still
        // pending. Only an actual newer observation supersedes this result.
        if (request < (cache.observedBy[key] ?? 0)) continue;
        cache.samples[key] = positive(values[key])
          ? { value: values[key], observedAt, status: "fresh" }
          : retainedSample(cache.samples[key]);
        if (positive(values[key])) cache.observedBy[key] = request;
      }
    }
  } catch {
    if (!signal?.aborted) {
      for (const key of keys) {
        if (request >= (cache.observedBy[key] ?? 0)) cache.samples[key] = retainedSample(cache.samples[key]);
      }
    }
  }
  return read();
}

function retainedSample(sample?: MarketSample): MarketSample {
  return sample?.value != null ? { ...sample, status: "stale" } : UNAVAILABLE_MARKET_SAMPLE;
}

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
      const rate = value / usd;
      if (positive(rate)) rates[code] = rate;
    }
  }
  return rates;
}

export async function fetchFiatRates(signal?: AbortSignal): Promise<FiatRates> {
  return { ...marketValues(await fetchFiatRateSamples(signal)), USD: 1 };
}

export async function fetchFiatRateSamples(signal?: AbortSignal): Promise<MarketSamples> {
  const samples = await fetchSamples(fiatCache, FIAT_CODES.filter((code) => code !== "USD"),
    "https://api.coingecko.com/api/v3/exchange_rates",
    (json) => parseFiatRates((json as { rates?: Record<string, { value?: unknown }> })?.rates ?? {}), signal);
  return { ...samples, USD: USD_REFERENCE };
}

export async function fetchNativePrice(signal?: AbortSignal): Promise<MarketSample> {
  const samples = await fetchSamples(nativeCache, ["XLM"],
    "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
    (json) => ({ XLM: (json as { stellar?: { usd?: number } })?.stellar?.usd ?? 0 }), signal);
  return samples.XLM;
}

export async function fetchAssetPriceSamples(assets: PricedAssetIdentity[], signal?: AbortSignal): Promise<MarketSamples> {
  const wanted = [...new Set(
    assets.map((asset) => assetPriceKey(asset.network, asset.code, asset.issuer)),
  )].filter((key) => COINGECKO_IDS[key] !== undefined);
  const ids = [...new Set(wanted.map((key) => COINGECKO_IDS[key]))];
  return fetchSamples(assetCache, wanted,
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`,
    (json) => Object.fromEntries(wanted.map((key) => [key, (json as Record<string, { usd?: number }>)?.[COINGECKO_IDS[key]]?.usd ?? 0])), signal);
}

export async function fetchAssetPrices(assets: PricedAssetIdentity[]): Promise<AssetPrices> {
  return marketValues(await fetchAssetPriceSamples(assets));
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

/**
 * Price used by the wallet preview. Mainnet remains market-priced; testnet
 * mirrors production UX with live XLM and a $1 reference only for the exact
 * known Circle USDC issuer. Lookalike asset codes remain unpriced.
 */
export function getRepresentativeUnitPrice(
  code: string,
  issuer: string | null | undefined,
  network: NetworkKey,
  isNative: boolean,
  xlmUsd: number | null,
  assetPrices: AssetPrices,
): number | null {
  if (network === "mainnet") {
    return getUnitPrice(code, issuer, network, isNative, xlmUsd, assetPrices);
  }
  if (isNative) return xlmUsd;
  return lookupKnownAsset(code, issuer, network)?.code === "USDC" ? 1 : null;
}
