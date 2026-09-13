/** Settings remains inside the merchant shell; every other wallet target exits it. */
export function merchantExitRequired({
  mode,
  targetIsMerchantView,
  targetIsSettings,
}: {
  mode: "wallet" | "merchant";
  targetIsMerchantView: boolean;
  targetIsSettings: boolean;
}): boolean {
  return mode === "merchant" && !targetIsMerchantView && !targetIsSettings;
}
