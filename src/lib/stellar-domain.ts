import { Asset, Memo, type Memo as StellarSdkMemo } from "@stellar/stellar-sdk";

const STROOPS_PER_XLM = BigInt(10_000_000);
const MAX_STROOPS = BigInt("9223372036854775807");
const MAX_UINT64 = BigInt("18446744073709551615");

export type StellarMemoInput =
  | { type: "text"; value: string }
  | { type: "id"; value: string }
  | { type: "hash"; value: string }
  | { type: "return"; value: string };

export function amountToStroops(raw: string): bigint {
  const value = raw.trim();
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(value);
  if (!match) throw new Error("Amount must be a positive decimal with at most 7 decimal places.");
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(7, "0") || "0");
  const stroops = whole * STROOPS_PER_XLM + fraction;
  if (stroops > MAX_STROOPS) throw new Error("Amount exceeds Stellar's maximum value.");
  return stroops;
}

export function stroopsToAmount(stroops: bigint): string {
  if (stroops < BigInt(0)) throw new Error("Amount cannot be negative.");
  const whole = stroops / STROOPS_PER_XLM;
  const fraction = (stroops % STROOPS_PER_XLM).toString().padStart(7, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function normalizeStellarAmount(raw: string): string {
  return stroopsToAmount(amountToStroops(raw));
}

export function compareStellarAmounts(left: string, right: string): number {
  const a = amountToStroops(left);
  const b = amountToStroops(right);
  return a === b ? 0 : a > b ? 1 : -1;
}

export function sumStellarAmounts(amounts: string[]): string {
  return stroopsToAmount(amounts.reduce((sum, amount) => sum + amountToStroops(amount), BigInt(0)));
}

export function subtractStellarAmounts(amount: string, deductions: string[]): string {
  const remaining = deductions.reduce(
    (value, deduction) => value - amountToStroops(deduction),
    amountToStroops(amount),
  );
  return stroopsToAmount(remaining > BigInt(0) ? remaining : BigInt(0));
}

export function splitStellarAmount(amount: string, parts: number): string[] {
  if (!Number.isInteger(parts) || parts <= 0) throw new Error("Split count must be positive.");
  const total = amountToStroops(amount);
  const divisor = BigInt(parts);
  const each = total / divisor;
  const remainder = Number(total % divisor);
  return Array.from({ length: parts }, (_, index) =>
    stroopsToAmount(each + (index < remainder ? BigInt(1) : BigInt(0))),
  );
}

export function fractionOfStellarAmount(
  amount: string,
  numerator: number,
  denominator: number,
): string {
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new Error("Fraction numerator must be a non-negative integer.");
  }
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error("Fraction denominator must be a positive integer.");
  }
  return stroopsToAmount(
    (amountToStroops(amount) * BigInt(numerator)) / BigInt(denominator),
  );
}

export function toStellarAsset(code: string, issuer?: string | null): Asset {
  const normalizedCode = code.trim();
  const normalizedIssuer = issuer?.trim() || null;
  if (normalizedIssuer) return new Asset(normalizedCode, normalizedIssuer);
  if (normalizedCode.toUpperCase() !== "XLM" && normalizedCode.toLowerCase() !== "native") {
    throw new Error(`Issuer is required for ${normalizedCode || "this asset"}.`);
  }
  return Asset.native();
}

export function canonicalAssetKey(code: string, issuer?: string | null): string {
  const asset = toStellarAsset(code, issuer);
  if (asset.isNative()) return "native";
  return `${asset.getCode()}:${asset.getIssuer()}`;
}

export function buildStellarMemo(input?: StellarMemoInput | null): StellarSdkMemo | null {
  if (!input || input.value.trim() === "") return null;
  const value = input.value.trim();
  switch (input.type) {
    case "text":
      if (new TextEncoder().encode(value).length > 28) {
        throw new Error("Text memo must be 28 bytes or fewer.");
      }
      return Memo.text(value);
    case "id": {
      if (!/^\d+$/.test(value) || BigInt(value) > MAX_UINT64) {
        throw new Error("Memo ID must be an unsigned 64-bit integer.");
      }
      return Memo.id(value);
    }
    case "hash":
      if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error("Hash memo must be 32 bytes of hex.");
      return Memo.hash(value);
    case "return":
      if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error("Return memo must be 32 bytes of hex.");
      return Memo.return(value);
  }
}

export function calculateSpendableNative(params: {
  balance: string;
  baseReserveStroops: string;
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
  feeStroops: string;
}): string {
  const minimumBalance = amountToStroops(calculateMinimumBalance(params));
  const spendable = amountToStroops(params.balance) - minimumBalance - BigInt(params.feeStroops);
  return stroopsToAmount(spendable > BigInt(0) ? spendable : BigInt(0));
}

export function calculateMinimumBalance(params: {
  baseReserveStroops: string;
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
}): string {
  const reserveUnits = Math.max(
    0,
    2 + params.subentryCount + params.numSponsoring - params.numSponsored,
  );
  return stroopsToAmount(BigInt(params.baseReserveStroops) * BigInt(reserveUnits));
}

export function applySlippage(amount: string, percent: string | number): string {
  const percentText = String(percent).trim();
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(percentText);
  if (!match) throw new Error("Invalid slippage percentage.");
  const scale = BigInt(1_000_000);
  const tenThousandths = BigInt(match[1]) * BigInt(10_000) + BigInt((match[2] ?? "").padEnd(4, "0") || "0");
  if (tenThousandths > scale) throw new Error("Slippage cannot exceed 100%.");
  const kept = scale - tenThousandths;
  return stroopsToAmount((amountToStroops(amount) * kept) / scale);
}

export function applySlippageCeiling(amount: string, percent: string | number): string {
  const percentText = String(percent).trim();
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(percentText);
  if (!match) throw new Error("Invalid slippage percentage.");
  const scale = BigInt(1_000_000);
  const tenThousandths = BigInt(match[1]) * BigInt(10_000) + BigInt((match[2] ?? "").padEnd(4, "0") || "0");
  if (tenThousandths > scale) throw new Error("Slippage cannot exceed 100%.");
  const numerator = amountToStroops(amount) * (scale + tenThousandths);
  const adjusted = (numerator + scale - BigInt(1)) / scale;
  if (adjusted > MAX_STROOPS) throw new Error("Amount exceeds Stellar's maximum value.");
  return stroopsToAmount(adjusted);
}
