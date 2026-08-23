import {
  Asset,
  FeeBumpTransaction,
  TransactionBuilder,
  extractBaseAddress,
  type Transaction,
} from "@stellar/stellar-sdk";
import { SendError } from "./api";
import { NETWORKS, type NetworkKey } from "./stellar";
import { stroopsToAmount } from "./stellar-domain";

export type ReviewRisk = "none" | "warn" | "danger";

/** Shared presentation for exact security-review values: fully visible and safely wrapable. */
export const EXACT_REVIEW_VALUE_CLASS =
  "min-w-0 flex-1 whitespace-pre-wrap break-all [overflow-wrap:anywhere]";

export interface ReviewedEnvelopeBinding {
  xdr: string;
  network: NetworkKey;
}

/** Return only the immutable envelope that is still bound to the visible review. */
export function reviewedEnvelopeForSigning(
  binding: ReviewedEnvelopeBinding | null,
  currentXdr: string,
  currentNetwork: NetworkKey,
): string | null {
  if (!binding) return null;
  if (binding.network !== currentNetwork || binding.xdr !== currentXdr.trim()) return null;
  return binding.xdr;
}

export interface ReviewLine {
  label: string;
  value: string;
  kind?: "text" | "mono" | "address";
}

export interface ReviewedOperation {
  type: string;
  source: string;
  title: string;
  lines: ReviewLine[];
  risk: ReviewRisk;
  signable: boolean;
  blockingReason?: string;
}

export interface TransactionReview {
  transaction: Transaction;
  network: NetworkKey;
  networkLabel: string;
  source: string;
  feeXlm: string;
  sequence: string;
  memo: { type: string; value?: string };
  memoText?: string;
  timeBounds?: { minTime: string; maxTime: string | null };
  expiresAt?: number;
  operations: ReviewedOperation[];
  operationCount: number;
  effectiveSources: string[];
  signable: boolean;
  blockingReasons: string[];
  hasDangerOps: boolean;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function valueToString(value: unknown): string {
  if (value instanceof Uint8Array) return bytesToHex(value);
  return String(value);
}

export function assetIdentity(asset: Asset): string {
  if (asset.isNative()) return "XLM (native)";
  return `${asset.getCode()}:${asset.getIssuer()}`;
}

export function formatStroopFeeXlm(stroops: string): string {
  if (!/^\d+$/.test(stroops)) throw new SendError("Transaction fee is not a valid stroop amount.");
  return stroopsToAmount(BigInt(stroops));
}

function sourceLine(source: string): ReviewLine {
  return { label: "Operation source", value: source, kind: "address" };
}

function reviewed(
  op: Transaction["operations"][number],
  txSource: string,
  details: Omit<ReviewedOperation, "type" | "source" | "lines"> & { lines: ReviewLine[] },
): ReviewedOperation {
  const source = op.source ?? txSource;
  return {
    type: op.type,
    source,
    ...details,
    lines: [sourceLine(source), ...details.lines],
  };
}

function unsupported(
  op: Transaction["operations"][number],
  txSource: string,
  reason?: string,
): ReviewedOperation {
  return reviewed(op, txSource, {
    signable: false,
    risk: "danger",
    title: `Unsupported operation — ${op.type}`,
    blockingReason: reason
      ? `Unsupported operation: ${op.type}. ${reason}`
      : `Unsupported operation: ${op.type}.`,
    lines: [
      {
        label: "Blocked",
        value: reason ?? "This wallet cannot fully decode and verify every effect of this operation.",
      },
    ],
  });
}

function signerDescription(signer: NonNullable<Extract<
  Transaction["operations"][number],
  { type: "setOptions" }
>["signer"]>): string {
  if ("ed25519PublicKey" in signer && signer.ed25519PublicKey) {
    return `Ed25519 ${signer.ed25519PublicKey}`;
  }
  if ("sha256Hash" in signer && signer.sha256Hash) {
    return `Hash-X ${valueToString(signer.sha256Hash)}`;
  }
  if ("preAuthTx" in signer && signer.preAuthTx) {
    return `Pre-authorized transaction ${valueToString(signer.preAuthTx)}`;
  }
  if ("ed25519SignedPayload" in signer && signer.ed25519SignedPayload) {
    return `Signed payload ${signer.ed25519SignedPayload}`;
  }
  return "Unknown signer type";
}

/**
 * Decode only operation families whose complete classic effects this wallet
 * can present. Anything else is deliberately non-signable.
 */
function reviewOperation(
  op: Transaction["operations"][number],
  txSource: string,
): ReviewedOperation {
  switch (op.type) {
    case "payment":
      return reviewed(op, txSource, {
        signable: true,
        risk: "none",
        title: `Payment of ${op.amount} ${assetIdentity(op.asset)}`,
        lines: [
          { label: "Asset", value: assetIdentity(op.asset), kind: "mono" },
          { label: "Amount", value: op.amount, kind: "mono" },
          { label: "Destination", value: op.destination, kind: "address" },
        ],
      });
    case "createAccount":
      return reviewed(op, txSource, {
        signable: true,
        risk: "none",
        title: "Create and fund account",
        lines: [
          { label: "Destination", value: op.destination, kind: "address" },
          { label: "Starting balance", value: `${op.startingBalance} XLM`, kind: "mono" },
        ],
      });
    case "pathPaymentStrictSend":
      return reviewed(op, txSource, {
        signable: true,
        risk: "none",
        title: "Path payment (strict send)",
        lines: [
          { label: "Send asset", value: assetIdentity(op.sendAsset), kind: "mono" },
          { label: "Send amount", value: op.sendAmount, kind: "mono" },
          { label: "Destination asset", value: assetIdentity(op.destAsset), kind: "mono" },
          { label: "Minimum destination amount", value: op.destMin, kind: "mono" },
          { label: "Destination", value: op.destination, kind: "address" },
          {
            label: "Path",
            value: op.path.length === 0 ? "Direct" : op.path.map(assetIdentity).join(" → "),
            kind: "mono",
          },
        ],
      });
    case "pathPaymentStrictReceive":
      return reviewed(op, txSource, {
        signable: true,
        risk: "none",
        title: "Path payment (strict receive)",
        lines: [
          { label: "Send asset", value: assetIdentity(op.sendAsset), kind: "mono" },
          { label: "Maximum send amount", value: op.sendMax, kind: "mono" },
          { label: "Destination asset", value: assetIdentity(op.destAsset), kind: "mono" },
          { label: "Destination amount", value: op.destAmount, kind: "mono" },
          { label: "Destination", value: op.destination, kind: "address" },
          {
            label: "Path",
            value: op.path.length === 0 ? "Direct" : op.path.map(assetIdentity).join(" → "),
            kind: "mono",
          },
        ],
      });
    case "changeTrust":
      if (!(op.line instanceof Asset)) {
        return unsupported(op, txSource, "Liquidity-pool trustlines are not supported by this signer.");
      }
      return reviewed(op, txSource, {
        signable: true,
        risk: "none",
        title: Number(op.limit) === 0 ? "Remove trustline" : "Change trustline",
        lines: [
          { label: "Asset", value: assetIdentity(op.line), kind: "mono" },
          { label: "Limit", value: op.limit, kind: "mono" },
        ],
      });
    case "manageSellOffer":
    case "createPassiveSellOffer":
      return reviewed(op, txSource, {
        signable: true,
        risk: "none",
        title: op.type === "manageSellOffer" ? "Manage sell offer" : "Create passive sell offer",
        lines: [
          { label: "Selling asset", value: assetIdentity(op.selling), kind: "mono" },
          { label: "Buying asset", value: assetIdentity(op.buying), kind: "mono" },
          { label: "Sell amount", value: op.amount, kind: "mono" },
          { label: "Price", value: op.price, kind: "mono" },
          ...(op.type === "manageSellOffer"
            ? [{ label: "Offer ID", value: op.offerId, kind: "mono" as const }]
            : []),
        ],
      });
    case "manageBuyOffer":
      return reviewed(op, txSource, {
        signable: true,
        risk: "none",
        title: "Manage buy offer",
        lines: [
          { label: "Buying asset", value: assetIdentity(op.buying), kind: "mono" },
          { label: "Selling asset", value: assetIdentity(op.selling), kind: "mono" },
          { label: "Buy amount", value: op.buyAmount, kind: "mono" },
          { label: "Price", value: op.price, kind: "mono" },
          { label: "Offer ID", value: op.offerId, kind: "mono" },
        ],
      });
    case "accountMerge":
      return reviewed(op, txSource, {
        signable: true,
        risk: "danger",
        title: "Close source account and merge all XLM",
        lines: [
          { label: "Destination", value: op.destination, kind: "address" },
          { label: "Effect", value: "Permanently deletes the operation source account" },
        ],
      });
    case "setOptions": {
      const lines: ReviewLine[] = [];
      if (op.inflationDest !== undefined) {
        lines.push({ label: "Inflation destination", value: op.inflationDest, kind: "address" });
      }
      if (op.clearFlags !== undefined) {
        lines.push({ label: "Clear account flags", value: String(op.clearFlags), kind: "mono" });
      }
      if (op.setFlags !== undefined) {
        lines.push({ label: "Set account flags", value: String(op.setFlags), kind: "mono" });
      }
      if (op.masterWeight !== undefined) {
        lines.push({ label: "Master-key weight", value: String(op.masterWeight), kind: "mono" });
      }
      if (op.lowThreshold !== undefined) {
        lines.push({ label: "Low threshold", value: String(op.lowThreshold), kind: "mono" });
      }
      if (op.medThreshold !== undefined) {
        lines.push({ label: "Medium threshold", value: String(op.medThreshold), kind: "mono" });
      }
      if (op.highThreshold !== undefined) {
        lines.push({ label: "High threshold", value: String(op.highThreshold), kind: "mono" });
      }
      if (op.homeDomain !== undefined) lines.push({ label: "Home domain", value: op.homeDomain });
      if (op.signer) {
        lines.push({ label: "Signer", value: signerDescription(op.signer), kind: "mono" });
        lines.push({ label: "Signer weight", value: String(op.signer.weight ?? 0), kind: "mono" });
      }
      const hasSignedPayloadSigner = Boolean(
        op.signer &&
        "ed25519SignedPayload" in op.signer &&
        op.signer.ed25519SignedPayload,
      );
      return reviewed(op, txSource, {
        signable: !hasSignedPayloadSigner,
        risk: "danger",
        title: "Change account options, signers, or thresholds",
        lines,
        blockingReason: hasSignedPayloadSigner
          ? "Signed-payload signer mutations are not supported by Trezor."
          : undefined,
      });
    }
    case "allowTrust": {
      const hardwareSupported = op.authorize === 0 || op.authorize === 1;
      const issuer = extractBaseAddress(op.source ?? txSource);
      return reviewed(op, txSource, {
        signable: hardwareSupported,
        risk: "warn",
        title: "Change trustline authorization",
        lines: [
          { label: "Trustor", value: op.trustor, kind: "address" },
          { label: "Asset", value: `${op.assetCode}:${issuer}`, kind: "mono" },
          { label: "Authorization", value: String(op.authorize ?? false), kind: "mono" },
        ],
        blockingReason: hardwareSupported
          ? undefined
          : "Authorized-to-maintain-liabilities allowTrust operations are not supported by Trezor.",
      });
    }
    case "setTrustLineFlags":
      return reviewed(op, txSource, {
        signable: false,
        risk: "warn",
        title: "Set trustline flags",
        lines: [
          { label: "Trustor", value: op.trustor, kind: "address" },
          { label: "Asset", value: assetIdentity(op.asset), kind: "mono" },
          {
            label: "Authorized",
            value: op.flags.authorized === undefined ? "Unchanged" : String(op.flags.authorized),
            kind: "mono",
          },
          {
            label: "Maintain liabilities",
            value: op.flags.authorizedToMaintainLiabilities === undefined
              ? "Unchanged"
              : String(op.flags.authorizedToMaintainLiabilities),
            kind: "mono",
          },
          {
            label: "Clawback enabled",
            value: op.flags.clawbackEnabled === undefined
              ? "Unchanged"
              : String(op.flags.clawbackEnabled),
            kind: "mono",
          },
        ],
      });
    case "claimClaimableBalance":
      return reviewed(op, txSource, {
        signable: true,
        risk: "none",
        title: "Claim claimable balance",
        lines: [{ label: "Balance ID", value: op.balanceId, kind: "mono" }],
      });
    case "clawback":
      return reviewed(op, txSource, {
        signable: false,
        risk: "danger",
        title: "Claw back funds",
        lines: [
          { label: "Asset", value: assetIdentity(op.asset), kind: "mono" },
          { label: "From", value: op.from, kind: "address" },
          { label: "Amount", value: op.amount, kind: "mono" },
        ],
      });
    case "clawbackClaimableBalance":
      return reviewed(op, txSource, {
        signable: false,
        risk: "danger",
        title: "Claw back claimable balance",
        lines: [{ label: "Balance ID", value: op.balanceId, kind: "mono" }],
      });
    case "manageData":
      return reviewed(op, txSource, {
        signable: true,
        risk: "warn",
        title: op.value === undefined ? "Delete account data" : "Set account data",
        lines: [
          { label: "Name", value: op.name, kind: "mono" },
          {
            label: "Value",
            value: op.value === undefined ? "Delete entry" : bytesToHex(op.value),
            kind: "mono",
          },
        ],
      });
    case "bumpSequence":
      return reviewed(op, txSource, {
        signable: true,
        risk: "warn",
        title: "Bump account sequence",
        lines: [{ label: "New minimum sequence", value: op.bumpTo, kind: "mono" }],
      });
    case "inflation":
      return unsupported(op, txSource, "The inflation operation is deprecated and no longer executable.");
    case "invokeHostFunction":
    case "extendFootprintTtl":
    case "restoreFootprint":
      return unsupported(
        op,
        txSource,
        "Soroban calls and ledger footprints require RPC simulation and authorization-tree review.",
      );
    default:
      return unsupported(op, txSource);
  }
}

function memoDetails(tx: Transaction): {
  memo: TransactionReview["memo"];
  memoText?: string;
  blockingReason?: string;
} {
  const type = tx.memo.type;
  if (type === "none") return { memo: { type } };
  const raw = tx.memo.value;
  if (type === "text" && raw instanceof Uint8Array) {
    try {
      const value = new TextDecoder("utf-8", { fatal: true }).decode(raw);
      return { memo: { type, value }, memoText: `${type}: ${value}` };
    } catch {
      const value = bytesToHex(raw);
      return {
        memo: { type, value },
        memoText: `${type} bytes: ${value}`,
        blockingReason: "Text memo bytes are not valid UTF-8 and cannot be displayed by Trezor.",
      };
    }
  }
  const value = raw instanceof Uint8Array ? bytesToHex(raw) : String(raw ?? "");
  return {
    memo: { type, value },
    memoText: `${type}: ${value}`,
  };
}

function hasSorobanData(tx: Transaction): boolean {
  const envelope = tx.toEnvelope();
  if (envelope.type !== "envelopeTypeTx") return false;
  return envelope.v1.tx.ext.type === "sorobanData";
}

/** Decode an imported envelope under an explicitly selected network. */
export function reviewTransactionEnvelope(
  xdr: string,
  network: NetworkKey,
  nowSeconds = Math.floor(Date.now() / 1000),
): TransactionReview {
  const cfg = NETWORKS[network];
  let decoded: Transaction | FeeBumpTransaction;
  try {
    decoded = TransactionBuilder.fromXdr(xdr.trim(), cfg.networkPassphrase);
  } catch {
    throw new SendError("That doesn't look like a valid transaction envelope (base64 XDR).");
  }
  if (decoded instanceof FeeBumpTransaction) {
    throw new SendError("Fee-bump envelopes are not supported — share the inner transaction envelope.");
  }

  const tx = decoded;
  const operations = tx.operations.map((operation) => reviewOperation(operation, tx.source));
  const blockingReasons = operations
    .filter((operation) => !operation.signable)
    .map((operation) => operation.blockingReason ?? `Unsupported operation: ${operation.type}.`);
  if (operations.length === 0) {
    blockingReasons.push("A transaction must contain at least one operation.");
  }
  if (!tx.timeBounds) {
    blockingReasons.push("Time bounds are required because Trezor cannot sign an unbounded envelope.");
  }

  const minTime = tx.timeBounds?.minTime ?? "0";
  const rawMaxTime = tx.timeBounds?.maxTime ?? "0";
  const minTimeValue = BigInt(minTime);
  const maxTimeValue = BigInt(rawMaxTime);
  const maxTime = maxTimeValue > BigInt(0) ? rawMaxTime : null;
  const now = BigInt(nowSeconds);
  if (minTimeValue > now) blockingReasons.push("This transaction is not valid yet.");
  if (maxTimeValue > BigInt(0) && maxTimeValue <= now) blockingReasons.push("This transaction has expired.");
  if (
    minTimeValue > BigInt(Number.MAX_SAFE_INTEGER) ||
    maxTimeValue > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    blockingReasons.push(
      "Time bounds exceed what Trezor Connect can represent exactly.",
    );
  }
  if (tx.ledgerBounds) {
    blockingReasons.push("Ledger bounds preconditions are not supported by this signer.");
  }
  if (tx.minAccountSequence !== undefined) {
    blockingReasons.push("Minimum account sequence preconditions are not supported by this signer.");
  }
  if (tx.minAccountSequenceAge !== undefined) {
    blockingReasons.push("Minimum account sequence age preconditions are not supported by this signer.");
  }
  if (tx.minAccountSequenceLedgerGap !== undefined) {
    blockingReasons.push("Minimum account sequence ledger gap preconditions are not supported by this signer.");
  }
  if (hasSorobanData(tx)) {
    blockingReasons.push("Soroban transaction data and ledger footprints are not supported by this signer.");
  }
  if ((tx.extraSigners?.length ?? 0) > 0) {
    blockingReasons.push("Extra signer preconditions are not supported by this signer.");
  }

  const { memo, memoText, blockingReason: memoBlockingReason } = memoDetails(tx);
  if (memoBlockingReason) blockingReasons.push(memoBlockingReason);
  const effectiveSources = [...new Set(
    [tx.source, ...operations.map((operation) => operation.source)].map(extractBaseAddress),
  )];
  return {
    transaction: tx,
    network,
    networkLabel: cfg.label,
    source: tx.source,
    feeXlm: formatStroopFeeXlm(tx.fee),
    sequence: tx.sequence,
    memo,
    memoText,
    timeBounds: tx.timeBounds ? { minTime, maxTime } : undefined,
    expiresAt: maxTimeValue > BigInt(0) && maxTimeValue <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(maxTimeValue)
      : undefined,
    operations,
    operationCount: operations.length,
    effectiveSources,
    signable: blockingReasons.length === 0,
    blockingReasons,
    hasDangerOps: operations.some((operation) => operation.risk === "danger"),
  };
}

export function assertReviewCanBeSigned(
  review: TransactionReview,
  networkConfirmed: boolean,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (!networkConfirmed) {
    throw new SendError(`Confirm ${review.networkLabel} before signing this imported envelope.`);
  }
  if (!review.signable) throw new SendError(review.blockingReasons.join(" "));
  assertReviewTimeValid(review, nowSeconds);
}

export function assertReviewTimeValid(
  review: TransactionReview,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (review.timeBounds && BigInt(review.timeBounds.minTime) > BigInt(nowSeconds)) {
    throw new SendError("This transaction is not valid yet.");
  }
  if (
    review.timeBounds?.maxTime !== null &&
    review.timeBounds?.maxTime !== undefined &&
    BigInt(review.timeBounds.maxTime) <= BigInt(nowSeconds)
  ) {
    throw new SendError("This transaction has expired.");
  }
}
