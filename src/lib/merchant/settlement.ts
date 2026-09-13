import { StrKey } from "@stellar/stellar-sdk";
import type { NetworkKey } from "../stellar";
import { assetKey, sameAsset } from "./charge";
import { fromStroops, toStroops } from "./money";
import type {
  AcceptedAsset,
  MerchantStore,
  Minor,
  SettlementRule,
  StellarAmount,
} from "./types";

const STROOPS_PER_UNIT = BigInt(10_000_000);
const PRICE_SCALE = BigInt(1_000_000);

export interface SettlementHolding {
  asset: AcceptedAsset;
  /** Spendable balance after liabilities, native reserve, and fee headroom. */
  available: StellarAmount;
  /** Book-currency minor units per asset unit, scaled by 1e6. */
  unitPriceMinorE6: number | null;
}

interface SettlementContext {
  contextId: string;
  network: NetworkKey;
  sourceAccount: string;
  createdFrom: "merchant-settlement-rule";
}

export interface SettlementSwapIntent extends SettlementContext {
  kind: "swap";
  rule: "auto-convert";
  sourceAsset: AcceptedAsset;
  destinationAsset: AcceptedAsset;
  amount: StellarAmount;
  maxSlippageBps: number;
}

export interface SettlementSweepIntent extends SettlementContext {
  kind: "send";
  rule: "treasury-sweep";
  asset: AcceptedAsset;
  amount: StellarAmount;
  /** Approximate book value selected by the rule; the reviewed asset amount is exact. */
  amountMinor: Minor;
  destination: string;
  thresholdMinor: Minor;
  retainedFloatMinor: Minor;
}

export interface SettlementHandoffs {
  swaps: SettlementSwapIntent[];
  sweep: SettlementSweepIntent | null;
  blocked: string[];
}

export interface SettlementInputs {
  network: NetworkKey;
  sourceAccount: string | null;
  holdings: SettlementHolding[];
  /** Device-local hour, 0–23. */
  localHour: number;
}

function checkedRule(rule: SettlementRule): SettlementRule {
  if (!Number.isInteger(rule.maxSlippageBps) || rule.maxSlippageBps < 1 || rule.maxSlippageBps > 1_000) {
    throw new Error("Maximum slippage must be between 0.01% and 10%.");
  }
  if (
    rule.sweepAboveMinor !== null &&
    (!Number.isSafeInteger(rule.sweepAboveMinor) || rule.sweepAboveMinor < 0)
  ) {
    throw new Error("The sweep threshold must be a non-negative amount.");
  }
  if (!Number.isSafeInteger(rule.retainedFloatMinor) || rule.retainedFloatMinor < 0) {
    throw new Error("The retained float must be a non-negative amount.");
  }
  if (
    rule.sweepDestination !== null &&
    !StrKey.isValidEd25519PublicKey(rule.sweepDestination)
  ) {
    throw new Error("The treasury must be a valid Stellar public address.");
  }
  if (
    rule.sweepPromptHour !== null &&
    (!Number.isInteger(rule.sweepPromptHour) || rule.sweepPromptHour < 0 || rule.sweepPromptHour > 23)
  ) {
    throw new Error("The settlement prompt hour must be between 0 and 23.");
  }
  return rule;
}

export function updateSettlementRule(
  store: MerchantStore,
  patch: Partial<SettlementRule>,
): MerchantStore {
  const rule = checkedRule({ ...store.settlementRule, ...patch });
  return { ...store, settlementRule: rule };
}

function availableStroops(holding: SettlementHolding): bigint | null {
  try {
    const stroops = toStroops(holding.available);
    return stroops > BigInt(0) ? stroops : null;
  } catch {
    return null;
  }
}

function holdingValueMinor(holding: SettlementHolding, stroops: bigint): Minor | null {
  const price = holding.unitPriceMinorE6;
  if (!Number.isSafeInteger(price) || price === null || price <= 0) return null;
  const minor = (stroops * BigInt(price)) / (STROOPS_PER_UNIT * PRICE_SCALE);
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

function intentContext(
  kind: "auto-convert" | "treasury-sweep",
  input: SettlementInputs,
  asset: AcceptedAsset,
  amount: StellarAmount,
): SettlementContext {
  return {
    contextId: `${kind}:${input.network}:${input.sourceAccount}:${assetKey(asset)}:${amount}`,
    network: input.network,
    sourceAccount: input.sourceAccount ?? "",
    createdFrom: "merchant-settlement-rule",
  };
}

export function deriveSettlementHandoffs(
  store: MerchantStore,
  input: SettlementInputs,
): SettlementHandoffs {
  checkedRule(store.settlementRule);
  const blocked: string[] = [];
  const swaps: SettlementSwapIntent[] = [];
  const receiving = store.settings.receivingPublicKey;
  if (!receiving || input.sourceAccount !== receiving) {
    return {
      swaps,
      sweep: null,
      blocked: ["Switch to the configured receiving account before preparing settlement."],
    };
  }
  if (!Number.isInteger(input.localHour) || input.localHour < 0 || input.localHour > 23) {
    return { swaps, sweep: null, blocked: ["The device settlement hour is invalid."] };
  }

  const accepted = store.settings.acceptedAssets;
  if (store.settlementRule.autoConvert) {
    for (const holding of input.holdings) {
      if (
        sameAsset(holding.asset, store.settings.settlementAsset) ||
        !accepted.some((asset) => sameAsset(asset, holding.asset))
      ) {
        continue;
      }
      const stroops = availableStroops(holding);
      if (stroops === null) continue;
      if (holdingValueMinor(holding, stroops) === null) {
        blocked.push(`${holding.asset.code} needs a current price before conversion can be prepared.`);
        continue;
      }
      const amount = fromStroops(stroops);
      swaps.push({
        ...intentContext("auto-convert", input, holding.asset, amount),
        kind: "swap",
        rule: "auto-convert",
        sourceAsset: holding.asset,
        destinationAsset: store.settings.settlementAsset,
        amount,
        maxSlippageBps: store.settlementRule.maxSlippageBps,
      });
    }
  }

  const rule = store.settlementRule;
  if (
    rule.sweepAboveMinor === null ||
    rule.sweepDestination === null ||
    rule.sweepPromptHour === null
  ) {
    return { swaps, sweep: null, blocked };
  }
  if (rule.sweepDestination === receiving) {
    blocked.push("The treasury destination is the receiving account, so there is nothing to sweep.");
    return { swaps, sweep: null, blocked };
  }
  if (input.localHour < rule.sweepPromptHour) {
    return { swaps, sweep: null, blocked };
  }
  const holding = input.holdings.find((candidate) =>
    sameAsset(candidate.asset, store.settings.settlementAsset),
  );
  const stroops = holding ? availableStroops(holding) : null;
  if (!holding || stroops === null) {
    blocked.push(`No spendable ${store.settings.settlementAsset.code} is available to sweep.`);
    return { swaps, sweep: null, blocked };
  }
  const valueMinor = holdingValueMinor(holding, stroops);
  if (valueMinor === null) {
    blocked.push(`${holding.asset.code} needs a current price before a sweep can be prepared.`);
    return { swaps, sweep: null, blocked };
  }
  const keepMinor = Math.max(rule.sweepAboveMinor, rule.retainedFloatMinor);
  const dueMinor = valueMinor - keepMinor;
  if (dueMinor <= 0) {
    blocked.push(`The settlement balance has not crossed the ${keepMinor} minor-unit threshold.`);
    return { swaps, sweep: null, blocked };
  }
  const dueStroops = (stroops * BigInt(dueMinor)) / BigInt(valueMinor);
  if (dueStroops <= BigInt(0)) {
    blocked.push("The amount above the settlement threshold is too small to send.");
    return { swaps, sweep: null, blocked };
  }
  const amount = fromStroops(dueStroops);
  const actualAmountMinor = holdingValueMinor(holding, dueStroops) ?? dueMinor;
  return {
    swaps,
    sweep: {
      ...intentContext("treasury-sweep", input, holding.asset, amount),
      kind: "send",
      rule: "treasury-sweep",
      asset: holding.asset,
      amount,
      amountMinor: actualAmountMinor,
      destination: rule.sweepDestination,
      thresholdMinor: rule.sweepAboveMinor,
      retainedFloatMinor: rule.retainedFloatMinor,
    },
    blocked,
  };
}
