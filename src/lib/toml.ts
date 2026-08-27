import { getJson } from "./api";

/**
 * Fetches token logo image URLs and issuer organization attestation
 * by resolving the issuer's home_domain via Horizon, then parsing
 * .well-known/stellar.toml.
 */

const LOGO_CACHE_KEY = "wallet.asset-logos.v1";
const ISSUER_CACHE_KEY = "wallet.issuer-details.v1";
const ASSET_METADATA_TTL_MS = 24 * 60 * 60 * 1000;
export const ASSET_METADATA_NEGATIVE_TTL_MS = 60 * 60 * 1000;

export interface IssuerDetails {
  domain: string;
  /** Whether stellar.toml declares this exact case-sensitive code + issuer pair. */
  assetDeclared: boolean;
  orgName?: string;
  orgUrl?: string;
  orgDescription?: string;
  orgOfficialEmail?: string;
  logoUrl?: string;
}

export interface BoundAssetMetadata {
  identity: string;
  logoUrl: string | null;
  issuerInfo: IssuerDetails | null;
}

export function selectCurrentAssetMetadata(
  currentIdentity: string | null,
  metadata: BoundAssetMetadata | null,
): BoundAssetMetadata | null {
  return currentIdentity !== null && metadata?.identity === currentIdentity ? metadata : null;
}

interface GenericCache<T> {
  [key: string]: T;
}

interface TimedCacheValue<T> {
  value: T;
  cachedAt: number;
}

function readCache<T>(key: string): GenericCache<T> {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "{}") as GenericCache<T>;
  } catch {
    return {};
  }
}

function writeCache<T>(key: string, cache: GenericCache<T>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    void 0;
  }
}

export function isAssetMetadataFresh(cachedAt: number, now = Date.now()): boolean {
  return (
    Number.isFinite(cachedAt) &&
    cachedAt <= now &&
    now - cachedAt < ASSET_METADATA_TTL_MS
  );
}

type CacheLookup<T> =
  | { hit: true; value: T }
  | { hit: false };

function readFreshCacheEntry<T>(
  storageKey: string,
  cacheKey: string,
): CacheLookup<T> {
  const cached = readCache<TimedCacheValue<T>>(storageKey)[cacheKey];
  if (!cached) return { hit: false };
  const ttl = cached.value === null
    ? ASSET_METADATA_NEGATIVE_TTL_MS
    : ASSET_METADATA_TTL_MS;
  const now = Date.now();
  return Number.isFinite(cached.cachedAt) && cached.cachedAt <= now && now - cached.cachedAt < ttl
    ? { hit: true, value: cached.value }
    : { hit: false };
}

function cacheMetadataValue<T>(storageKey: string, cacheKey: string, value: T): void {
  const cache = readCache<TimedCacheValue<T>>(storageKey);
  cache[cacheKey] = { value, cachedAt: Date.now() };
  writeCache(storageKey, cache);
}

export function assetMetadataCacheKey(
  code: string,
  issuer: string,
  horizonUrl: string,
): string {
  return `${horizonUrl.replace(/\/+$/, "")}|${code}:${issuer}`;
}

export function getCachedAssetLogo(
  code: string,
  issuer: string,
  horizonUrl: string,
): string | null {
  const cached = readFreshCacheEntry<string | null>(
    LOGO_CACHE_KEY,
    assetMetadataCacheKey(code, issuer, horizonUrl),
  );
  return cached.hit ? cached.value : null;
}

/** Extract home_domain for an issuer account */
async function fetchIssuerDomain(issuer: string, horizonUrl: string): Promise<string | null> {
  const data = await getJson<{ home_domain?: string }>(
    `${horizonUrl}/accounts/${issuer}`,
  );
  return data?.home_domain ?? null;
}

interface MetadataResolution {
  details: IssuerDetails | null;
  stable: boolean;
}

const metadataInFlight = new Map<string, Promise<MetadataResolution>>();

/** Parse the exact [[CURRENCIES]] declaration for one classic asset. */
export function extractCurrencyInfo(
  toml: string,
  code: string,
  issuer: string,
): { declared: boolean; logoUrl?: string } {
  const currencies: Array<Record<string, string>> = [];
  let current: Record<string, string> | null = null;

  for (const rawLine of toml.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    if (/^\[\[\s*CURRENCIES\s*\]\]$/.test(line)) {
      current = {};
      currencies.push(current);
      continue;
    }
    if (line.startsWith("[")) {
      current = null;
      continue;
    }
    if (!current) continue;

    const field = /^(code|issuer|image)\s*=\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)')\s*$/.exec(line);
    if (field) {
      const value = field[2] ?? field[3];
      if (value !== undefined) current[field[1]] = value;
    }
  }

  for (const currency of currencies) {
    if (currency.code === code && currency.issuer === issuer) {
      const logoUrl = /^https?:\/\//.test(currency.image ?? "")
        ? currency.image
        : undefined;
      return { declared: true, logoUrl };
    }
  }
  return { declared: false };
}

function stripTomlComment(line: string): string {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if ((character === '"' || character === "'") && (!quote || quote === character)) {
      quote = quote ? null : character;
      continue;
    }
    if (character === "#" && !quote) return line.slice(0, index);
  }
  return line;
}

/** Parse [DOCUMENTATION] block for organization info */
function extractOrgInfo(toml: string): {
  orgName?: string;
  orgUrl?: string;
  orgDescription?: string;
  orgOfficialEmail?: string;
} {
  const orgNameMatch = toml.match(/ORG_NAME\s*=\s*"([^"]+)"/i);
  const orgUrlMatch = toml.match(/ORG_URL\s*=\s*"([^"]+)"/i);
  const orgDescMatch = toml.match(/ORG_DESCRIPTION\s*=\s*"([^"]+)"/i);
  const orgEmailMatch = toml.match(/ORG_OFFICIAL_EMAIL\s*=\s*"([^"]+)"/i);

  return {
    orgName: orgNameMatch ? orgNameMatch[1] : undefined,
    orgUrl: orgUrlMatch ? orgUrlMatch[1] : undefined,
    orgDescription: orgDescMatch ? orgDescMatch[1] : undefined,
    orgOfficialEmail: orgEmailMatch ? orgEmailMatch[1] : undefined,
  };
}

/**
 * Resolve a token logo URL. Returns null when unknown/unreachable.
 */
export async function fetchAssetLogo(
  code: string,
  issuer: string,
  horizonUrl: string,
): Promise<string | null> {
  const key = assetMetadataCacheKey(code, issuer, horizonUrl);
  const cached = readFreshCacheEntry<string | null>(LOGO_CACHE_KEY, key);
  if (cached.hit) return cached.value;

  const resolution = await resolveAssetMetadata(code, issuer, horizonUrl);
  const logoUrl = resolution.details?.logoUrl ?? null;
  if (resolution.stable) cacheMetadataValue(LOGO_CACHE_KEY, key, logoUrl);
  return logoUrl;
}

/**
 * Resolve rich issuer details and organization attestation.
 */
export async function fetchIssuerDetails(
  code: string,
  issuer: string,
  horizonUrl: string,
): Promise<IssuerDetails | null> {
  return (await resolveAssetMetadata(code, issuer, horizonUrl)).details;
}

async function resolveAssetMetadata(
  code: string,
  issuer: string,
  horizonUrl: string,
): Promise<MetadataResolution> {
  const key = assetMetadataCacheKey(code, issuer, horizonUrl);
  const cached = readFreshCacheEntry<IssuerDetails | null>(ISSUER_CACHE_KEY, key);
  if (cached.hit) return { details: cached.value, stable: true };

  const pending = metadataInFlight.get(key);
  if (pending) return pending;

  const request = (async (): Promise<MetadataResolution> => {
    try {
      const domain = await fetchIssuerDomain(issuer, horizonUrl);
      if (!domain) {
        cacheMetadataValue(ISSUER_CACHE_KEY, key, null);
        cacheMetadataValue(LOGO_CACHE_KEY, key, null);
        return { details: null, stable: true };
      }

      const res = await fetch(`https://${domain}/.well-known/stellar.toml`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const stableNegative = res.status >= 400 && res.status < 500 &&
          res.status !== 408 && res.status !== 429;
        if (!stableNegative) throw new Error(`Temporary stellar.toml response ${res.status}.`);
        const details: IssuerDetails = { domain, assetDeclared: false };
        cacheMetadataValue(ISSUER_CACHE_KEY, key, details);
        cacheMetadataValue(LOGO_CACHE_KEY, key, null);
        return { details, stable: true };
      }
      const toml = await res.text();
      const currency = extractCurrencyInfo(toml, code, issuer);
      const org = extractOrgInfo(toml);

      const details: IssuerDetails = {
        domain,
        assetDeclared: currency.declared,
        orgName: org.orgName,
        orgUrl: org.orgUrl,
        orgDescription: org.orgDescription,
        orgOfficialEmail: org.orgOfficialEmail,
        logoUrl: currency.logoUrl,
      };

      cacheMetadataValue(ISSUER_CACHE_KEY, key, details);
      cacheMetadataValue(LOGO_CACHE_KEY, key, details.logoUrl ?? null);
      return { details, stable: true };
    } catch {
      return { details: null, stable: false };
    }
  })();
  metadataInFlight.set(key, request);

  try {
    return await request;
  } finally {
    if (metadataInFlight.get(key) === request) metadataInFlight.delete(key);
  }
}
