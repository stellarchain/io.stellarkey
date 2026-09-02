import type { MerchantSettings } from "./types";

/** One invariant for every request type that can accept or render a payment. */
export function isCurrentReceivingDestination(
  settings: Pick<MerchantSettings, "receivingPublicKey">,
  destination: string | null,
): destination is string {
  return settings.receivingPublicKey !== null && destination === settings.receivingPublicKey;
}
