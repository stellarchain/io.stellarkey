export class SecureContextRequiredError extends Error {
  constructor() {
    super("Secure wallet encryption requires HTTPS or localhost so Web Crypto is available.");
    this.name = "SecureContextRequiredError";
  }
}

export function requireWebCrypto(
  provider: Crypto | null = globalThis.crypto,
): Crypto {
  if (
    !provider?.subtle ||
    typeof provider.subtle.digest !== "function" ||
    typeof provider.getRandomValues !== "function"
  ) {
    throw new SecureContextRequiredError();
  }
  return provider;
}
