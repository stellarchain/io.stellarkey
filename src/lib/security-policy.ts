export interface SecurityPolicyOptions {
  nonce: string;
  development: boolean;
  secureRequest: boolean;
}

const TRUSTWORTHY_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function createCspNonce(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function isPotentiallyTrustworthyUrl(url: URL): boolean {
  if (url.protocol === "https:" || url.protocol === "wss:") return true;
  return url.protocol === "http:" && TRUSTWORTHY_HTTP_HOSTS.has(url.hostname.toLowerCase());
}

export function getExternalRequestUrl(
  internalUrl: URL,
  hostHeader: string | null,
  forwardedProtocolHeader: string | null,
): URL {
  const forwardedProtocol = forwardedProtocolHeader?.split(",")[0]?.trim().toLowerCase();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? `${forwardedProtocol}:`
    : internalUrl.protocol;
  const host = hostHeader?.trim() || internalUrl.host;

  try {
    return new URL(`${protocol}//${host}`);
  } catch {
    return internalUrl;
  }
}

export function buildSecurityPolicy({
  nonce,
  development,
  secureRequest,
}: SecurityPolicyOptions): string {
  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(development ? ["'unsafe-eval'"] : []),
  ];
  const connectSources = [
    "'self'",
    "https://horizon.stellar.org",
    "https://horizon-testnet.stellar.org",
    "https://soroban-testnet.stellar.org",
    "https://friendbot.stellar.org",
    "https://api.coingecko.com",
    "https://connect.trezor.io",
    "https://*.trezor.io",
    "wss://*.trezor.io",
    // Stellar home domains are issuer-controlled and cannot be enumerated ahead of time.
    "https:",
    ...(development ? ["http:", "ws:", "wss:"] : []),
  ];
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "frame-src 'self' https://connect.trezor.io",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (secureRequest && !development) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
