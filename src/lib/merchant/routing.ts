import { Account, MuxedAccount, StrKey } from "@stellar/stellar-sdk";

export const MAX_MERCHANT_ROUTING_ID = "18446744073709551615";
const MAX_ROUTING_ID = BigInt(MAX_MERCHANT_ROUTING_ID);

export type MerchantPaymentTransport = "muxed" | "memo-id";

export interface MerchantPaymentDestination {
  destination: string;
  memo?: string;
  memoType?: "id";
}

/** A canonical, non-zero unsigned 64-bit integer represented in base 10. */
export function isMerchantRoutingId(value: string): boolean {
  if (!/^[1-9]\d*$/.test(value)) return false;
  try {
    return BigInt(value) <= MAX_ROUTING_ID;
  } catch {
    return false;
  }
}

/** Generate a cryptographically random routing identity without modulo bias. */
export function createMerchantRoutingId(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure randomness is unavailable for merchant routing.");
  }
  const bytes = new Uint8Array(8);
  while (true) {
    cryptoApi.getRandomValues(bytes);
    let value = BigInt(0);
    for (const byte of bytes) value = (value << BigInt(8)) | BigInt(byte);
    if (value !== BigInt(0)) return value.toString(10);
  }
}

export function muxedAddressForRouting(baseAddress: string, routingId: string): string {
  const base = baseAddress.trim();
  if (!StrKey.isValidEd25519PublicKey(base)) {
    throw new Error("The merchant receiving account is not a valid Stellar public key.");
  }
  if (!isMerchantRoutingId(routingId)) {
    throw new Error("The merchant routing ID is not a valid non-zero uint64 value.");
  }
  return new MuxedAccount(new Account(base, "0"), routingId).accountId();
}

export function routingFromMuxedAddress(address: string): {
  baseAddress: string;
  routingId: string;
} {
  const muxed = address.trim();
  if (!StrKey.isValidMed25519PublicKey(muxed)) {
    throw new Error("The destination is not a valid Stellar muxed address.");
  }
  const account = MuxedAccount.fromAddress(muxed, "0");
  return {
    baseAddress: account.baseAccount().accountId(),
    routingId: account.id(),
  };
}

export function merchantPaymentTransport(
  baseAddress: string,
  routingId: string,
  transport: MerchantPaymentTransport,
): MerchantPaymentDestination {
  if (transport === "muxed") {
    return { destination: muxedAddressForRouting(baseAddress, routingId) };
  }
  // Validate both inputs through the same encoder so the two transports can
  // never disagree about the underlying account or uint64 range.
  muxedAddressForRouting(baseAddress, routingId);
  return { destination: baseAddress.trim(), memo: routingId, memoType: "id" };
}
