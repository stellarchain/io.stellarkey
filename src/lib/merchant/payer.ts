import { MuxedAccount, StrKey } from "@stellar/stellar-sdk";

/**
 * Customer records are keyed by the underlying account. A muxed address is
 * still retained on the payment itself because it is the exact refund route.
 */
export function canonicalPayerAddress(value: string): string {
  const address = value.trim();
  if (StrKey.isValidEd25519PublicKey(address)) return address;
  if (StrKey.isValidMed25519PublicKey(address)) {
    return MuxedAccount.fromAddress(address, "0").baseAccount().accountId();
  }
  throw new Error("The customer address is not a valid Stellar payment address.");
}

/** Select a safe refund source from Horizon's optional muxed metadata. */
export function observedPayerAddress(from: string, fromMuxed?: string): string {
  const canonicalFrom = canonicalPayerAddress(from);
  if (!fromMuxed || !StrKey.isValidMed25519PublicKey(fromMuxed)) return from;
  try {
    return canonicalPayerAddress(fromMuxed) === canonicalFrom ? fromMuxed : from;
  } catch {
    return from;
  }
}

export function samePayerAccount(first: string, second: string): boolean {
  try {
    return canonicalPayerAddress(first) === canonicalPayerAddress(second);
  } catch {
    return false;
  }
}
