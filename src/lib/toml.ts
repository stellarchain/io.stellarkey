import { getJson } from "./api";

/**
 * Fetches token logo image URLs and issuer organization attestation
 * by resolving the issuer's home_domain via Horizon, then parsing
 * .well-known/stellar.toml.
 */

const LOGO_CACHE_KEY = "wallet.asset-logos.v1";
const ISSUER_CACHE_KEY = "wallet.issuer-details.v1";
const ASSET_METADATA_TTL_MS = 24 * 60 * 60 * 1000;

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

function readFreshCacheValue<T>(
  storageKey: string,
  cacheKey: string,
): T | null {
  const cached = readCache<TimedCacheValue<T>>(storageKey)[cacheKey];
  return cached && isAssetMetadataFresh(cached.cachedAt) ? cached.value : null;
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
  return readFreshCacheValue<string>(
    LOGO_CACHE_KEY,
    assetMetadataCacheKey(code, issuer, horizonUrl),
  );
}

/** Extract home_domain for an issuer account */
async function fetchIssuerDomain(issuer: string, horizonUrl: string): Promise<string | null> {
  const data = await getJson<{ home_domain?: string }>(
    `${horizonUrl}/accounts/${issuer}`,
  );
  return data?.home_domain ?? null;
}

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
  const cached = getCachedAssetLogo(code, issuer, horizonUrl);
  if (cached !== null) return cached;

  try {
    const domain = await fetchIssuerDomain(issuer, horizonUrl);
    if (!domain) return null;

    const res = await fetch(`https://${domain}/.well-known/stellar.toml`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const toml = await res.text();
    const { logoUrl } = extractCurrencyInfo(toml, code, issuer);
    if (!logoUrl) return null;

    const cache = readCache<TimedCacheValue<string>>(LOGO_CACHE_KEY);
    cache[key] = { value: logoUrl, cachedAt: Date.now() };
    writeCache(LOGO_CACHE_KEY, cache);
    return logoUrl;
  } catch {
    return null;
  }
}

/**
 * Resolve rich issuer details and organization attestation.
 */
export async function fetchIssuerDetails(
  code: string,
  issuer: string,
  horizonUrl: string,
): Promise<IssuerDetails | null> {
  const key = assetMetadataCacheKey(code, issuer, horizonUrl);
  const cached = readFreshCacheValue<IssuerDetails>(ISSUER_CACHE_KEY, key);
  if (cached) return cached;

  try {
    const domain = await fetchIssuerDomain(issuer, horizonUrl);
    if (!domain) return null;

    const res = await fetch(`https://${domain}/.well-known/stellar.toml`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { domain, assetDeclared: false };
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

    const cache = readCache<TimedCacheValue<IssuerDetails>>(ISSUER_CACHE_KEY);
    cache[key] = { value: details, cachedAt: Date.now() };
    writeCache(ISSUER_CACHE_KEY, cache);
    return details;
  } catch {
    return null;
  }
}
