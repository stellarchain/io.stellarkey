export function buildStaticSecurityPolicy(scriptHashes: string[]): string {
  const scriptSources = [
    "'self'",
    ...scriptHashes.map((hash) => `'${hash}'`),
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
  return directives.join("; ");
}
