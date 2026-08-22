import { getJson } from "./api";

/**
 * Fetches token logo image URLs by resolving the issuer's home_domain
 * via Horizon, then parsing .well-known/stellar.toml for [[CURRENCIES]]
 * image entries. Results cached in localStorage indefinitely (logos are
 * effectively immutable per code:issuer).
 */

const LOGO_CACHE_KEY = "wallet.asset-logos.v1";

interface LogoCache {
  [key: string]: string;
}

function readCache(): LogoCache {
  try {
    return JSON.parse(window.localStorage.getItem(LOGO_CACHE_KEY) ?? "{}") as LogoCache;
  } catch {
    return {};
  }
}

function writeCache(cache: LogoCache): void {
  try {
    window.localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(cache));
  } catch {
    void 0;
  }
}

export function getCachedAssetLogo(code: string, issuer: string): string | null {
  const cache = readCache();
  return cache[`${code}:${issuer}`] ?? null;
}

/** Extract home_domain for an issuer account */
async function fetchIssuerDomain(issuer: string, horizonUrl: string): Promise<string | null> {
  const data = await getJson<{ home_domain?: string }>(
    `${horizonUrl}/accounts/${issuer}`,
  );
  return data?.home_domain ?? null;
}

/** Minimal TOML scrape: find image = "…" near the block declaring our code */
function extractLogoFromToml(toml: string, code: string): string | null {
  // Split into currency blocks
  const blocks = toml.split("[[CURRENCIES]]").slice(1);
  for (const block of blocks) {
    const codeMatch = block.match(/code\s*=\s*"([^"]+)"/);
    if (codeMatch && codeMatch[1].toUpperCase() === code.toUpperCase()) {
      const imgMatch = block.match(/image\s*=\s*"(https?:\/\/[^"]+)"/);
      if (imgMatch) return imgMatch[1];
    }
  }
  return null;
}

/**
 * Resolve a token logo URL. Returns null when unknown/unreachable;
 * callers should fall back to their letter-avatar rendering.
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

    const res = await fetch(
      `https://${domain}/.well-known/stellar.toml`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const toml = await res.text();
    const logo = extractLogoFromToml(toml, code);
    if (!logo) return null;

    const cache = readCache();
    cache[key] = logo;
    writeCache(cache);
    return logo;
  } catch {
    return null;
  }
}
