import { Asset, StrKey, type Asset as StellarAsset } from "@stellar/stellar-sdk";
import type { PayUriPayload } from "./payuri";
import { subtractStellarAmounts, type StellarMemoInput } from "./stellar-domain";
import type { AssetBalance, NetworkKey } from "./types";
import { formatTrezorAddress } from "./address-display";

export interface SwapRequestIdentity {
  network: NetworkKey;
  sendAssetKey: string;
  destinationAssetKey: string;
  mode: SwapExecutionMode;
  exactAmount: string;
  slippage: string;
}

export type SwapExecutionMode = "strict-send" | "strict-receive";

interface BoundSwapQuoteBase {
  readonly requestKey: string;
  readonly sendAssetKey: string;
  readonly destinationAssetKey: string;
  readonly sendAmount: string;
  readonly slippage: string;
  readonly destinationAmount: string;
  readonly intermediates: readonly StellarAsset[];
}

export interface StrictSendBoundSwapQuote extends BoundSwapQuoteBase {
  readonly mode: "strict-send";
  readonly destinationMinimum: string;
}

export interface StrictReceiveBoundSwapQuote extends BoundSwapQuoteBase {
  readonly mode: "strict-receive";
  readonly sendMaximum: string;
}

export type BoundSwapQuote = StrictSendBoundSwapQuote | StrictReceiveBoundSwapQuote;

export interface SwapReceiptAssetIdentity {
  readonly key: string;
  readonly code: string;
  readonly issuer: string | null;
}

export function swapReceiptAssetIdentity(
  asset: Pick<AssetBalance, "code" | "issuer">,
): SwapReceiptAssetIdentity {
  return Object.freeze({
    key: asset.issuer ? `${asset.code}:${asset.issuer}` : "native",
    code: asset.code,
    issuer: asset.issuer,
  });
}

export function swapRequestKey(request: SwapRequestIdentity): string {
  return JSON.stringify([
    request.network,
    request.sendAssetKey,
    request.destinationAssetKey,
    request.mode,
    request.exactAmount,
    request.slippage,
  ]);
}

export function bindSwapQuote(quote: StrictSendBoundSwapQuote): StrictSendBoundSwapQuote;
export function bindSwapQuote(quote: StrictReceiveBoundSwapQuote): StrictReceiveBoundSwapQuote;
export function bindSwapQuote(quote: BoundSwapQuote): BoundSwapQuote {
  return Object.freeze({
    ...quote,
    intermediates: Object.freeze([...quote.intermediates]),
  });
}

export function isCurrentSwapQuote(
  quote: BoundSwapQuote | null,
  currentRequestKey: string | null,
): quote is BoundSwapQuote {
  return guardCurrentSwapQuote(quote, currentRequestKey) !== null;
}

/**
 * Returns a quote only when it is bound to the request currently visible in the form.
 * UI review and submission boundaries both call this guard directly.
 */
export function guardCurrentSwapQuote<T extends BoundSwapQuote>(
  quote: T | null,
  currentRequestKey: string | null,
): T | null {
  return quote !== null && currentRequestKey !== null && quote.requestKey === currentRequestKey
    ? quote
    : null;
}

export function resolveRequestedAsset(
  request: Pick<PayUriPayload, "assetCode" | "assetIssuer">,
  balances: readonly AssetBalance[],
): { assetKey: string | null; error: string | null } {
  const code = request.assetCode;
  const issuer = request.assetIssuer;
  if (issuer && !code) {
    return {
      assetKey: null,
      error: "This payment request includes an asset issuer but is missing its asset code.",
    };
  }
  const requestsNative = !code || (!issuer && (code === "XLM" || code === "native"));

  if (requestsNative) {
    const native = balances.find((balance) => balance.isNative);
    return native
      ? { assetKey: native.key, error: null }
      : { assetKey: null, error: "Native XLM balance is unavailable." };
  }

  if (!issuer) {
    return {
      assetKey: null,
      error: `The ${code} payment request is missing its asset issuer.`,
    };
  }

  const exact = balances.find(
    (balance) => !balance.isNative && balance.code === code && balance.issuer === issuer,
  );
  return exact
    ? { assetKey: exact.key, error: null }
    : {
        assetKey: null,
        error: `This wallet does not have the exact ${code} trustline requested by this payment.`,
      };
}

export interface DestinationMemoState {
  memo: string;
  memoType: StellarMemoInput["type"];
  federationBound: boolean;
}

export function normalizeFederationMemo(
  memo: string,
  memoType?: string,
): DestinationMemoState {
  const normalizedType = memoType?.trim().toLowerCase();
  if (
    normalizedType &&
    normalizedType !== "text" &&
    normalizedType !== "id" &&
    normalizedType !== "hash" &&
    normalizedType !== "return"
  ) {
    throw new Error(`Federation memo type ${memoType} is not supported.`);
  }
  const type = (normalizedType || "text") as StellarMemoInput["type"];
  return { memo, memoType: type, federationBound: true };
}

export function memoReviewPresentation(
  memo: string,
  memoType: StellarMemoInput["type"],
): { label: string; value: string } | null {
  const value = memo.trim();
  return value ? { label: `Memo (${memoType.toUpperCase()})`, value } : null;
}

export function clearFederationMemoForDestinationChange(
  state: DestinationMemoState,
): DestinationMemoState {
  return state.federationBound
    ? { memo: "", memoType: "text", federationBound: false }
    : state;
}

export function spendableAssetBalance(
  asset: AssetBalance,
  deductions: readonly string[] = [],
): string {
  return subtractStellarAmounts(asset.balance, [
    asset.sellingLiabilities || "0",
    ...deductions,
  ]);
}

export function activityAssetKey(
  activity: Pick<AssetBalance, "code" | "issuer"> | {
    assetCode: string | null;
    assetIssuer: string | null;
  },
): string | null {
  const code = "assetCode" in activity ? activity.assetCode : activity.code;
  const issuer = "assetIssuer" in activity ? activity.assetIssuer : activity.issuer;
  if (!code) return null;
  if (issuer) return `${code ?? "UNKNOWN"}:${issuer}`;
  return code !== "XLM" ? `${code}:unknown` : "native";
}

export interface ActivityAssetPresentation {
  code: string | null;
  issuer: string | null;
  issuerDisplay: string | null;
  identity: string | null;
  detailLabel: string | null;
  compactLabel: string | null;
  isNative: boolean;
}

export function activityAssetPresentation(activity: {
  assetCode: string | null;
  assetIssuer: string | null;
}): ActivityAssetPresentation {
  const code = activity.assetCode;
  const issuer = activity.assetIssuer;
  const identity = activityAssetKey(activity);
  const isNative = code === "XLM" && issuer === null;
  const issuerDisplay = issuer ? formatTrezorAddress(issuer) : null;
  return {
    code,
    issuer,
    issuerDisplay,
    identity,
    detailLabel: code ? (issuer ? `${code}:${issuer}` : code) : null,
    compactLabel: code ? (issuerDisplay ? `${code} · ${issuerDisplay}` : code) : null,
    isNative,
  };
}

export interface AssetDetailBalanceSummary {
  balance: string;
  sellingLiabilities: string;
  minimumBalance: string | null;
  spendable: string;
}

export function assetDetailBalanceSummary(
  asset: AssetBalance,
  minimumNativeBalance: string | null,
): AssetDetailBalanceSummary {
  const minimumBalance = asset.isNative ? minimumNativeBalance : null;
  return {
    balance: asset.balance,
    sellingLiabilities: asset.sellingLiabilities || "0",
    minimumBalance,
    spendable: spendableAssetBalance(
      asset,
      asset.isNative ? [minimumNativeBalance ?? asset.balance] : [],
    ),
  };
}

export function deriveSacContractId(asset: AssetBalance, networkPassphrase: string): string {
  const classicAsset = asset.isNative
    ? Asset.native()
    : new Asset(asset.code, asset.issuer ?? undefined);
  const contractId = classicAsset.contractId(networkPassphrase);
  if (!StrKey.isValidContract(contractId)) {
    throw new Error("Unable to derive a valid Stellar Asset Contract ID.");
  }
  return contractId;
}

export const MAX_TRUSTLINE_SELECTIONS = 100;

export interface TrustlineSelection {
  code: string;
  issuer: string;
}

export interface TrustlineSelectionUpdate {
  selected: TrustlineSelection[];
  error: string | null;
}

function trustlineSelectionKey(selection: TrustlineSelection): string {
  return `${selection.code.toUpperCase()}:${selection.issuer}`;
}

export function addTrustlineSelection(
  current: TrustlineSelection[],
  candidate: TrustlineSelection,
): TrustlineSelectionUpdate {
  const candidateKey = trustlineSelectionKey(candidate);
  if (current.some((selection) => trustlineSelectionKey(selection) === candidateKey)) {
    return { selected: current, error: `${candidate.code} is already queued.` };
  }
  if (current.length >= MAX_TRUSTLINE_SELECTIONS) {
    return {
      selected: current,
      error: "A Stellar transaction can contain at most 100 trustlines.",
    };
  }
  return { selected: [...current, candidate], error: null };
}

export function toggleTrustlineSelection(
  current: TrustlineSelection[],
  candidate: TrustlineSelection,
): TrustlineSelectionUpdate {
  const candidateKey = trustlineSelectionKey(candidate);
  if (current.some((selection) => trustlineSelectionKey(selection) === candidateKey)) {
    return {
      selected: current.filter((selection) => trustlineSelectionKey(selection) !== candidateKey),
      error: null,
    };
  }
  return addTrustlineSelection(current, candidate);
}
