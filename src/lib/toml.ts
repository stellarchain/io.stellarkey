import { getJson } from "./api";

/**
 * Fetches token logo image URLs and issuer organization attestation
 * by resolving the issuer's home_domain via Horizon, then parsing
 * .well-known/stellar.toml.
 */

const LOGO_CACHE_KEY = "wallet.asset-logos.v1";
const ISSUER_CACHE_KEY = "wallet.issuer-details.v1";

export interface IssuerDetails {
  domain: string;
  orgName?: string;
  orgUrl?: string;
  orgDescription?: string;
  orgOfficialEmail?: string;
  logoUrl?: string;
}

interface GenericCache<T> {
  [key: string]: T;
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

export function getCachedAssetLogo(code: string, issuer: string): string | null {
  const cache = readCache<string>(LOGO_CACHE_KEY);
  return cache[`${code}:${issuer}`] ?? null;
}

/** Extract home_domain for an issuer account */
async function fetchIssuerDomain(issuer: string, horizonUrl: string): Promise<string | null> {
  const data = await getJson<{ home_domain?: string }>(
    `${horizonUrl}/accounts/${issuer}`,
  );
  return data?.home_domain ?? null;
}

/** Parse [[CURRENCIES]] block for asset */
function extractCurrencyInfo(toml: string, code: string): { logoUrl?: string } {
  const blocks = toml.split("[[CURRENCIES]]").slice(1);
  for (const block of blocks) {
    const codeMatch = block.match(/code\s*=\s*"([^"]+)"/);
    if (codeMatch && codeMatch[1].toUpperCase() === code.toUpperCase()) {
      const imgMatch = block.match(/image\s*=\s*"(https?:\/\/[^"]+)"/);
      return {
        logoUrl: imgMatch ? imgMatch[1] : undefined,
      };
    }
  }
  return {};
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
  const key = `${code}:${issuer}`;
  const cached = getCachedAssetLogo(code, issuer);
  if (cached !== null) return cached;

  try {
    const domain = await fetchIssuerDomain(issuer, horizonUrl);
    if (!domain) return null;

    const res = await fetch(`https://${domain}/.well-known/stellar.toml`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const toml = await res.text();
    const { logoUrl } = extractCurrencyInfo(toml, code);
    if (!logoUrl) return null;

    const cache = readCache<string>(LOGO_CACHE_KEY);
    cache[key] = logoUrl;
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
  const key = `${code}:${issuer}`;
  const cache = readCache<IssuerDetails>(ISSUER_CACHE_KEY);
  if (cache[key]) return cache[key];

  try {
    const domain = await fetchIssuerDomain(issuer, horizonUrl);
    if (!domain) return null;

    const res = await fetch(`https://${domain}/.well-known/stellar.toml`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { domain };
    const toml = await res.text();
    const currency = extractCurrencyInfo(toml, code);
    const org = extractOrgInfo(toml);

    const details: IssuerDetails = {
      domain,
      orgName: org.orgName,
      orgUrl: org.orgUrl,
      orgDescription: org.orgDescription,
      orgOfficialEmail: org.orgOfficialEmail,
      logoUrl: currency.logoUrl,
    };

    cache[key] = details;
    writeCache(ISSUER_CACHE_KEY, cache);
    return details;
  } catch {
    return null;
  }
}
