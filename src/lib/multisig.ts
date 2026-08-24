/**
 * Multi-signature orchestration for Stellar accounts: threshold/signer
 * configuration via setOptions, partially-signed payment envelopes for
 * co-signing, and cosigner-envelope merging with weight-aware submission.
 *
 * Threshold model (Stellar): every operation needs a minimum signing weight
 * (low/med/high). Payments and most operations are medium; signer/threshold
 * changes and account merge are high.
 */
import {
  Keypair,
  Operation,
  TransactionBuilder,
  extractBaseAddress,
  type Transaction,
} from "@stellar/stellar-sdk";
import {
  type AccountSignerInfo,
  explainSubmitError,
  fetchAccountSignerInfo,
  getJson,
  loadRecommendedBaseFee,
  minimalAccount,
  resolveSource,
  submitSignedTx,
  SendError,
} from "./api";
import { getHorizonUrl, NETWORKS, type NetworkKey } from "./stellar";
import { normalizeAmount } from "./format";
import { isValidPublicAddress } from "./vault";
import { signHardwareTx, type HardwareSigner } from "./hardware";
import { buildStellarMemo, toStellarAsset, type StellarMemoInput } from "./stellar-domain";
import {
  assertReviewTimeValid,
  reviewTransactionEnvelope,
  type ReviewedOperation,
} from "./transaction-review";
import type { SubmissionPreparedCallback, SubmissionResult } from "./submission";

export interface MultisigSignerEntry {
  key: string;
  weight: number;
}

export interface MultisigConfig {
  /** Includes the account's own key (its weight becomes masterWeight). */
  signers: MultisigSignerEntry[];
  low: number;
  medium: number;
  high: number;
}

export interface MultisigConfigOutcome {
  /** Null means the envelope still needs additional signatures. */
  submission: SubmissionResult | null;
  xdr: string;
  collectedWeight: number;
  requiredWeight: number;
  signedKeys: string[];
}

/** Stellar AccountEntry stores at most 20 additional signers; the master key is separate. */
export const MAX_ADDITIONAL_ACCOUNT_SIGNERS = 20;

export function hasAdditionalSignerCapacity(additionalSignerCount: number): boolean {
  return Number.isInteger(additionalSignerCount) &&
    additionalSignerCount >= 0 &&
    additionalSignerCount < MAX_ADDITIONAL_ACCOUNT_SIGNERS;
}

export function totalWeight(signers: { weight: number }[]): number {
  return signers.reduce((sum, s) => sum + s.weight, 0);
}

/** Signing weight a transaction requires, derived from its operation types. */
export function thresholdLevelForOperation(
  op: Transaction["operations"][number],
): "low" | "medium" | "high" {
  if (op.type === "accountMerge") return "high";
  if (op.type === "setOptions") {
    return op.signer !== undefined ||
      op.masterWeight !== undefined ||
      op.lowThreshold !== undefined ||
      op.medThreshold !== undefined ||
      op.highThreshold !== undefined
      ? "high"
      : "medium";
  }
  if (
    op.type === "bumpSequence" ||
    op.type === "allowTrust" ||
    op.type === "setTrustLineFlags" ||
    op.type === "claimClaimableBalance"
  ) {
    return "low";
  }
  return "medium";
}

export function requiredWeightForTx(tx: Transaction, thresholds: {
  low_threshold: number;
  med_threshold: number;
  high_threshold: number;
}): number {
  return tx.operations.reduce((required, op) => {
    const level = thresholdLevelForOperation(op);
    const weight = level === "low"
      ? thresholds.low_threshold
      : level === "high"
        ? thresholds.high_threshold
        : thresholds.med_threshold;
    return Math.max(required, weight);
  }, thresholds.low_threshold);
}

/** Apply a full signer/threshold configuration to an account (setOptions). */
export async function applyMultisigConfig(params: {
  network: NetworkKey;
  accountPublicKey: string;
  config: MultisigConfig;
  secretKey?: string;
  hardwareSigner?: HardwareSigner;
  feeStroops?: number;
  onPrepared?: SubmissionPreparedCallback;
}): Promise<MultisigConfigOutcome> {
  const { network, accountPublicKey, config } = params;

  const thresholds = [config.low, config.medium, config.high];
  if (thresholds.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new SendError("Thresholds must be whole numbers between 0 and 255.");
  }
  if (new Set(config.signers.map((signer) => signer.key)).size !== config.signers.length) {
    throw new SendError("Signer addresses must be unique.");
  }
  const additionalSignerCount = config.signers.filter(
    (signer) => signer.key !== accountPublicKey && signer.weight > 0,
  ).length;
  if (additionalSignerCount > MAX_ADDITIONAL_ACCOUNT_SIGNERS) {
    throw new SendError("A Stellar account can have at most 20 additional signers.");
  }

  for (const s of config.signers) {
    if (!isValidPublicAddress(s.key)) {
      throw new SendError("One of the signer addresses is not a valid Stellar address.");
    }
    if (!Number.isInteger(s.weight) || s.weight < 0 || s.weight > 255) {
      throw new SendError("Signer weights must be whole numbers between 0 and 255.");
    }
  }
  const own = config.signers.find((s) => s.key === accountPublicKey);
  if (!own || own.weight < 1) {
    throw new SendError("Your own key must stay a signer with weight of at least 1.");
  }
  const total = totalWeight(config.signers);
  for (const [label, v] of [["Low", config.low], ["Medium", config.medium], ["High", config.high]] as const) {
    if (v > total) throw new SendError(`${label} threshold (${v}) exceeds the total signer weight (${total}).`);
  }

  const horizonUrl = getHorizonUrl(network);
  const cfg = NETWORKS[network];
  const { kp } = resolveSource(params.secretKey, params.hardwareSigner);
  const source = await getJson<{ sequence: string }>(`${horizonUrl}/accounts/${accountPublicKey}`);
  if (!source) throw new SendError("Account does not exist on this network.");
  const current = await fetchAccountSignerInfo(accountPublicKey, network);
  if (!current) throw new SendError("Account signer configuration could not be loaded.");
  if (current.signers.some((signer) => signer.type !== "ed25519_public_key")) {
    throw new SendError(
      "This account uses signer types this configuration editor cannot safely modify.",
    );
  }
  const fee = await loadRecommendedBaseFee(network, params.feeStroops);

  const builder = new TransactionBuilder(minimalAccount(accountPublicKey, source.sequence), {
    fee: String(fee),
    networkPassphrase: cfg.networkPassphrase,
  });

  // Restore the master and increase existing signer weights before weakening
  // access. At full capacity, lower the current high threshold, remove only
  // enough obsolete signers to open slots, then add their replacements. The
  // final exact threshold/master state remains last and the transaction atomic.
  const desiredByKey = new Map(config.signers.map((signer) => [signer.key, signer.weight]));
  const currentByKey = new Map(current.signers.map((signer) => [signer.key, signer.weight]));
  const currentMasterWeight = currentByKey.get(accountPublicKey) ?? 0;
  const currentAdditionalSigners = current.signers.filter(
    (signer) => signer.key !== accountPublicKey && signer.weight > 0,
  );
  if (currentAdditionalSigners.length > MAX_ADDITIONAL_ACCOUNT_SIGNERS) {
    throw new SendError("The current account exceeds Stellar's additional-signer limit.");
  }
  const additions = config.signers.filter((signer) =>
    signer.key !== accountPublicKey &&
    signer.weight > 0 &&
    (currentByKey.get(signer.key) ?? 0) === 0
  );
  const obsoleteSigners = currentAdditionalSigners.filter(
    (signer) => (desiredByKey.get(signer.key) ?? 0) === 0,
  );
  const availableSlots = MAX_ADDITIONAL_ACCOUNT_SIGNERS - currentAdditionalSigners.length;
  const slotsToCreate = Math.max(0, additions.length - availableSlots);
  if (slotsToCreate > obsoleteSigners.length) {
    throw new SendError("The requested signer replacement cannot fit within Stellar's signer limit.");
  }
  const capacityRemovals = obsoleteSigners.slice(0, slotsToCreate);
  const capacityRemovalKeys = new Set(capacityRemovals.map((signer) => signer.key));

  if (own.weight > currentMasterWeight) {
    builder.addOperation(Operation.setOptions({ masterWeight: own.weight }));
  }
  for (const s of config.signers) {
    if (s.key === accountPublicKey) continue;
    const currentWeight = currentByKey.get(s.key) ?? 0;
    if (currentWeight <= 0 || s.weight <= currentWeight) continue;
    builder.addOperation(
      Operation.setOptions({ signer: { ed25519PublicKey: s.key, weight: s.weight } }),
    );
  }

  const weakensSignerSet =
    own.weight < (currentByKey.get(accountPublicKey) ?? 0) ||
    current.signers.some((signer) => {
      if (signer.key === accountPublicKey) return false;
      const desired = config.signers.find((entry) => entry.key === signer.key);
      return !desired || desired.weight < signer.weight;
    });
  if (weakensSignerSet && current.thresholds.high_threshold > 0) {
    builder.addOperation(Operation.setOptions({ highThreshold: 0 }));
  }

  for (const signer of capacityRemovals) {
    builder.addOperation(
      Operation.setOptions({ signer: { ed25519PublicKey: signer.key, weight: 0 } }),
    );
  }

  for (const signer of additions) {
    builder.addOperation(
      Operation.setOptions({ signer: { ed25519PublicKey: signer.key, weight: signer.weight } }),
    );
  }

  for (const s of config.signers) {
    if (s.key === accountPublicKey || s.weight <= 0) continue;
    const currentWeight = currentByKey.get(s.key);
    if (currentWeight === undefined || s.weight >= currentWeight) continue;
    builder.addOperation(
      Operation.setOptions({ signer: { ed25519PublicKey: s.key, weight: s.weight } }),
    );
  }

  for (const signer of obsoleteSigners) {
    if (capacityRemovalKeys.has(signer.key)) continue;
    builder.addOperation(
      Operation.setOptions({ signer: { ed25519PublicKey: signer.key, weight: 0 } }),
    );
  }

  builder.addOperation(
    Operation.setOptions({
      masterWeight: own.weight,
      lowThreshold: config.low,
      medThreshold: config.medium,
      highThreshold: config.high,
    }),
  );

  const tx = builder.setTimeout(180).build();
  const review = reviewTransactionEnvelope(tx.toXdr(), network);
  if (kp) tx.sign(kp);
  else if (params.hardwareSigner) await signHardwareTx(tx, params.hardwareSigner);
  assertReviewTimeValid(review);

  const context: AuthorizationContext = {
    sourceInfo: new Map([[extractBaseAddress(accountPublicKey), current]]),
    requirements: authorizationRequirements(tx),
  };
  const evaluation = authorizationEvaluationFromContext(tx, context);
  const collected = evaluation.authorizations.reduce(
    (sum, authorization) => sum + authorization.collectedWeight,
    0,
  );
  const required = evaluation.authorizations.reduce(
    (sum, authorization) => sum + authorization.requiredWeight,
    0,
  );
  const signedKeys = new Set(
    evaluation.authorizations.flatMap((authorization) => authorization.signedKeys),
  );
  if (!evaluation.authorizations.every((authorization) => authorization.satisfied)) {
    return {
      submission: null,
      xdr: tx.toXdr(),
      collectedWeight: collected,
      requiredWeight: required,
      signedKeys: [...signedKeys],
    };
  }

  try {
    assertReviewTimeValid(review);
    const result = await submitSignedTx(tx, network, 15_000, params.onPrepared);
    return {
      submission: result,
      xdr: tx.toXdr(),
      collectedWeight: collected,
      requiredWeight: required,
      signedKeys: [...signedKeys],
    };
  } catch (err) {
    throw new SendError(explainSubmitError(err));
  }
}

/** Remove every cosigner and reset thresholds to single-sig defaults. */
export async function disableMultisig(params: {
  network: NetworkKey;
  accountPublicKey: string;
  secretKey?: string;
  hardwareSigner?: HardwareSigner;
  feeStroops?: number;
  onPrepared?: SubmissionPreparedCallback;
}): Promise<MultisigConfigOutcome> {
  return applyMultisigConfig({
    ...params,
    config: {
      signers: [{ key: params.accountPublicKey, weight: 1 }],
      low: 0,
      medium: 0,
      high: 0,
    },
  });
}

/**
 * Build a payment transaction and sign it with OUR key only, returning the
 * partially-signed envelope (base64 XDR) to share with cosigners instead of
 * submitting — the first step of an M-of-N payment.
 */
export async function prepareCosignPayment(params: {
  network: NetworkKey;
  sourcePublicKey: string;
  destination: string;
  amount: string;
  assetCode: string;
  issuer?: string | null;
  memo?: StellarMemoInput;
  /** @deprecated Use `memo` so the memo type is preserved. */
  memoText?: string;
  feeStroops?: number;
  secretKey?: string;
  hardwareSigner?: HardwareSigner;
}): Promise<{ xdr: string }> {
  const { network, destination, amount, assetCode, issuer, memoText } = params;
  const feeStroops = await loadRecommendedBaseFee(network, params.feeStroops);
  const memo = buildStellarMemo(
    params.memo ?? (memoText ? { type: "text", value: memoText } : null),
  );

  if (!isValidPublicAddress(destination)) {
    throw new SendError("Destination is not a valid Stellar address.");
  }

  const horizonUrl = getHorizonUrl(network);
  const cfg = NETWORKS[network];
  const { kp } = resolveSource(params.secretKey, params.hardwareSigner);
  const source = await getJson<{ sequence: string }>(
    `${horizonUrl}/accounts/${params.sourcePublicKey}`,
  );
  if (!source) throw new SendError("Your account does not exist on this network.");

  const destExists = (await getJson(`${horizonUrl}/accounts/${destination}`)) !== null;
  const paymentAsset = toStellarAsset(assetCode, issuer);
  const isNative = paymentAsset.isNative();
  if (!destExists && !isNative) {
    throw new SendError(
      "Destination account doesn't exist yet. New accounts must be activated with XLM.",
    );
  }

  const builder = new TransactionBuilder(minimalAccount(params.sourcePublicKey, source.sequence), {
    fee: String(feeStroops),
    networkPassphrase: cfg.networkPassphrase,
  });
  if (!destExists) {
    builder.addOperation(
      Operation.createAccount({ destination, startingBalance: normalizeAmount(amount) }),
    );
  } else {
    builder.addOperation(
      Operation.payment({
        destination,
        amount: normalizeAmount(amount),
        asset: paymentAsset,
      }),
    );
  }
  if (memo) builder.addMemo(memo);

  const tx = builder.setTimeout(180).build();
  if (kp) tx.sign(kp);
  else if (params.hardwareSigner) await signHardwareTx(tx, params.hardwareSigner);
  return { xdr: tx.toXdr() };
}

/* ---------------- Co-signing (merge envelopes, submit when full) ---------------- */

export type TxOpExplanation = ReviewedOperation;

export interface TxExplanation {
  network: NetworkKey;
  networkLabel: string;
  source: string;
  feeXlm: string;
  sequence: string;
  memoText?: string;
  timeBounds?: { minTime: string; maxTime: string | null };
  /** epoch seconds, when the envelope has a maxTime timebound */
  expiresAt?: number;
  operations: TxOpExplanation[];
  collectedWeight: number;
  requiredWeight: number;
  signedKeys: string[];
  operationCount: number;
  signable: boolean;
  blockingReasons: string[];
  authorizations: SourceAuthorization[];
  hasDangerOps: boolean;
}

export interface SourceAuthorization {
  source: string;
  collectedWeight: number;
  requiredWeight: number;
  signedKeys: string[];
  satisfied: boolean;
}

/**
 * Decode a transaction envelope into a human-readable explanation for
 * pre-signature review under an explicitly selected network, including exact
 * operation effects, expiry, and every source account's authorization state.
 */
export async function explainTransaction(
  xdr: string,
  network: NetworkKey,
): Promise<TxExplanation> {
  const review = reviewTransactionEnvelope(xdr, network);
  const authorizations = await authorizationStatus(review.transaction, network);
  const signedKeys = new Set(authorizations.flatMap((entry) => entry.signedKeys));
  return {
    network: review.network,
    networkLabel: review.networkLabel,
    source: review.source,
    feeXlm: review.feeXlm,
    sequence: review.sequence,
    memoText: review.memoText,
    timeBounds: review.timeBounds,
    expiresAt: review.expiresAt,
    operations: review.operations,
    operationCount: review.operationCount,
    signable: review.signable,
    blockingReasons: review.blockingReasons,
    hasDangerOps: review.hasDangerOps,
    collectedWeight: authorizations.reduce((sum, entry) => sum + entry.collectedWeight, 0),
    requiredWeight: authorizations.reduce((sum, entry) => sum + entry.requiredWeight, 0),
    signedKeys: [...signedKeys],
    authorizations,
  };
}


export interface CosignOutcome {
  /** Null means the updated envelope still needs additional signatures. */
  submission: SubmissionResult | null;
  /** Updated envelope including any signature we added. */
  xdr: string;
  collectedWeight: number;
  requiredWeight: number;
  signedKeys: string[];
  addedSignature: boolean;
  operationCount: number;
  authorizations: SourceAuthorization[];
}

function verifySignedKeys(tx: Transaction, signers: MultisigSignerEntry[]): {
  collected: number;
  signedKeys: Set<string>;
} {
  const hash = tx.hash();
  const signedKeys = new Set<string>();
  let collected = 0;
  for (const s of signers) {
    try {
      const kp = Keypair.fromPublicKey(s.key);
      const hit = tx.signatures.some((sig) => {
        try {
          return kp.verify(hash, sig.signature.toBytes());
        } catch {
          return false;
        }
      });
      if (hit) {
        collected += s.weight;
        signedKeys.add(s.key);
      }
    } catch {
      // Skip malformed signer entries
    }
  }
  return { collected, signedKeys };
}

type ThresholdLevel = "low" | "medium" | "high";

interface AuthorizationContext {
  sourceInfo: Map<string, AccountSignerInfo>;
  requirements: Map<string, Set<ThresholdLevel>>;
}

function authorizationRequirements(tx: Transaction): Map<string, Set<ThresholdLevel>> {
  const requirements = new Map<string, Set<ThresholdLevel>>();
  // The transaction source always authorizes the envelope at its low threshold,
  // even when every operation overrides its own source account.
  requirements.set(extractBaseAddress(tx.source), new Set<ThresholdLevel>(["low"]));
  for (const operation of tx.operations) {
    const source = extractBaseAddress(operation.source ?? tx.source);
    const levels = requirements.get(source) ?? new Set<ThresholdLevel>();
    levels.add(thresholdLevelForOperation(operation));
    requirements.set(source, levels);
  }
  return requirements;
}

async function loadAuthorizationContext(
  tx: Transaction,
  network: NetworkKey,
): Promise<AuthorizationContext> {
  const requirements = authorizationRequirements(tx);
  const entries = await Promise.all(
    [...requirements.keys()].map(async (source) => {
      const info = await fetchAccountSignerInfo(source, network);
      if (!info) throw new SendError(`Required source account ${source} was not found on ${NETWORKS[network].label}.`);
      if (info.signers.some((signer) => signer.type !== "ed25519_public_key")) {
        throw new SendError(
          `Required source account ${source} uses unsupported signer types. This wallet will not guess their authorization state.`,
        );
      }
      return [source, info] as const;
    }),
  );
  return { sourceInfo: new Map(entries), requirements };
}

function authorizationStatusFromContext(
  tx: Transaction,
  context: AuthorizationContext,
): SourceAuthorization[] {
  return authorizationEvaluationFromContext(tx, context).authorizations;
}

interface AuthorizationCheck {
  source: string;
  operationIndex: number | null;
  collectedWeight: number;
  requiredWeight: number;
  signedKeys: string[];
  satisfied: boolean;
  signerWeights: Map<string, number>;
}

interface AuthorizationEvaluation {
  authorizations: SourceAuthorization[];
  checks: AuthorizationCheck[];
}

interface SignerAuthorizationStatus {
  alreadySigned: boolean;
  legitimateSigner: boolean;
  contributesToUnsatisfiedSource: boolean;
}

interface MutableAuthorizationState {
  masterKey: string;
  thresholds: AccountSignerInfo["thresholds"];
  signers: Map<string, number>;
  hasOpaqueSignerMutation: boolean;
  merged: boolean;
}

function thresholdWeight(
  thresholds: AccountSignerInfo["thresholds"],
  level: ThresholdLevel,
): number {
  const configured = level === "low"
    ? thresholds.low_threshold
    : level === "high"
      ? thresholds.high_threshold
      : thresholds.med_threshold;
  // Stellar Core still requires a recognized authorization at threshold zero.
  return Math.max(1, configured);
}

function applyAuthorizationMutation(
  state: MutableAuthorizationState,
  operation: Transaction["operations"][number],
): void {
  if (operation.type === "accountMerge") {
    state.merged = true;
    return;
  }
  if (operation.type !== "setOptions") return;

  if (operation.masterWeight !== undefined) {
    state.signers.set(state.masterKey, operation.masterWeight);
  }
  if (operation.lowThreshold !== undefined) {
    state.thresholds.low_threshold = operation.lowThreshold;
  }
  if (operation.medThreshold !== undefined) {
    state.thresholds.med_threshold = operation.medThreshold;
  }
  if (operation.highThreshold !== undefined) {
    state.thresholds.high_threshold = operation.highThreshold;
  }
  if (!operation.signer) return;
  if ("ed25519PublicKey" in operation.signer && operation.signer.ed25519PublicKey) {
    state.signers.set(operation.signer.ed25519PublicKey, Number(operation.signer.weight ?? 0));
  } else {
    state.hasOpaqueSignerMutation = true;
  }
}

function authorizationEvaluationFromContext(
  tx: Transaction,
  context: AuthorizationContext,
): AuthorizationEvaluation {
  const states = new Map<string, MutableAuthorizationState>();
  for (const [source, info] of context.sourceInfo) {
    states.set(source, {
      masterKey: extractBaseAddress(source),
      thresholds: { ...info.thresholds },
      signers: new Map(info.signers.map((signer) => [signer.key, signer.weight])),
      hasOpaqueSignerMutation: false,
      merged: false,
    });
  }

  const checks: AuthorizationCheck[] = [];
  const check = (sourceValue: string, level: ThresholdLevel, operationIndex: number | null) => {
    const source = extractBaseAddress(sourceValue);
    const state = states.get(source);
    if (!state) throw new SendError(`Signer information for ${source} is unavailable.`);
    if (state.merged) {
      throw new SendError(`Cannot prove authorization for operation ${Number(operationIndex) + 1}: source ${source} was merged earlier in the transaction.`);
    }
    if (state.hasOpaqueSignerMutation) {
      throw new SendError(
        `Cannot prove ordered authorization for source ${source} after an unsupported signer-type change.`,
      );
    }
    const signerEntries = [...state.signers].map(([key, weight]) => ({ key, weight }));
    const { collected, signedKeys } = verifySignedKeys(tx, signerEntries);
    const requiredWeight = thresholdWeight(state.thresholds, level);
    checks.push({
      source,
      operationIndex,
      collectedWeight: collected,
      requiredWeight,
      signedKeys: [...signedKeys],
      satisfied: collected >= requiredWeight,
      signerWeights: new Map(state.signers),
    });
  };

  check(tx.source, "low", null);
  tx.operations.forEach((operation, operationIndex) => {
    const source = extractBaseAddress(operation.source ?? tx.source);
    check(source, thresholdLevelForOperation(operation), operationIndex);
    const state = states.get(source);
    if (!state) throw new SendError(`Signer information for ${source} is unavailable.`);
    applyAuthorizationMutation(state, operation);
  });

  const authorizations = [...context.requirements.keys()].map((source) => {
    const sourceChecks = checks.filter((entry) => entry.source === source);
    const representative = sourceChecks.reduce((current, candidate) => {
      const currentDeficit = current.requiredWeight - current.collectedWeight;
      const candidateDeficit = candidate.requiredWeight - candidate.collectedWeight;
      if (candidateDeficit !== currentDeficit) {
        return candidateDeficit > currentDeficit ? candidate : current;
      }
      return candidate.requiredWeight > current.requiredWeight ? candidate : current;
    });
    return {
      source,
      collectedWeight: representative.collectedWeight,
      requiredWeight: representative.requiredWeight,
      signedKeys: [...new Set(sourceChecks.flatMap((entry) => entry.signedKeys))],
      satisfied: sourceChecks.every((entry) => entry.satisfied),
    };
  });
  return { authorizations, checks };
}

function transactionHasSignatureFrom(tx: Transaction, signerPublicKey: string): boolean {
  let signer: Keypair;
  try {
    signer = Keypair.fromPublicKey(signerPublicKey);
  } catch {
    return false;
  }
  const hash = tx.hash();
  return tx.signatures.some((signature) => {
    try {
      return signer.verify(hash, signature.signature.toBytes());
    } catch {
      return false;
    }
  });
}

function signerAuthorizationStatus(
  tx: Transaction,
  evaluation: AuthorizationEvaluation,
  signerPublicKey: string,
): SignerAuthorizationStatus {
  return {
    alreadySigned: transactionHasSignatureFrom(tx, signerPublicKey),
    legitimateSigner: evaluation.checks.some(
      (check) => (check.signerWeights.get(signerPublicKey) ?? 0) > 0,
    ),
    contributesToUnsatisfiedSource: evaluation.checks.some(
      (check) =>
        !check.satisfied &&
        (check.signerWeights.get(signerPublicKey) ?? 0) > 0,
    ),
  };
}

/**
 * Prove from current on-chain signer state that this key may add one useful
 * signature. This is intentionally reusable by connected and local signing.
 */
export async function assertCanAddTransactionSignature(params: {
  transaction: Transaction;
  network: NetworkKey;
  signerPublicKey: string;
}): Promise<void> {
  if (transactionHasSignatureFrom(params.transaction, params.signerPublicKey)) {
    throw new SendError("This envelope already contains a signature from the active account.");
  }
  const context = await loadAuthorizationContext(params.transaction, params.network);
  const evaluation = authorizationEvaluationFromContext(params.transaction, context);
  const status = signerAuthorizationStatus(
    params.transaction,
    evaluation,
    params.signerPublicKey,
  );
  if (!status.legitimateSigner) {
    throw new SendError(
      "The active account is not a positive-weight signer for any required source account.",
    );
  }
  if (!status.contributesToUnsatisfiedSource) {
    throw new SendError(
      "The active account does not contribute weight to any unsatisfied authorization check.",
    );
  }
}

async function authorizationStatus(
  tx: Transaction,
  network: NetworkKey,
): Promise<SourceAuthorization[]> {
  return authorizationStatusFromContext(tx, await loadAuthorizationContext(tx, network));
}

/**
 * Import a (partially-signed) transaction envelope, add our signature if it
 * is missing, and submit once the collected weight meets the threshold.
 */
export async function cosignTransaction(params: {
  network: NetworkKey;
  confirmedNetwork: NetworkKey | null;
  xdr: string;
  signerPublicKey: string;
  secretKey?: string;
  hardwareSigner?: HardwareSigner;
  onPrepared?: SubmissionPreparedCallback;
}): Promise<CosignOutcome> {
  const review = reviewTransactionEnvelope(params.xdr, params.network);
  if (!params.confirmedNetwork) {
    throw new SendError(`Confirm ${review.networkLabel} before signing this imported envelope.`);
  }
  if (params.confirmedNetwork !== params.network) {
    throw new SendError(
      `The confirmed network (${NETWORKS[params.confirmedNetwork].label}) no longer matches the selected ${review.networkLabel}. Review again before signing.`,
    );
  }
  if (!review.signable) throw new SendError(review.blockingReasons.join(" "));

  const tx = review.transaction;
  const context = await loadAuthorizationContext(tx, params.network);
  assertReviewTimeValid(review);
  let evaluation = authorizationEvaluationFromContext(tx, context);
  const signerStatus = signerAuthorizationStatus(tx, evaluation, params.signerPublicKey);
  if (!signerStatus.legitimateSigner) {
    throw new SendError("The selected account is not a signer for any source account in this transaction.");
  }

  let authorizations = evaluation.authorizations;
  let signedKeys = new Set(authorizations.flatMap((entry) => entry.signedKeys));

  let addedSignature = false;
  if (
    !authorizations.every((entry) => entry.satisfied) &&
    !signerStatus.alreadySigned
  ) {
    if (!signerStatus.contributesToUnsatisfiedSource) {
      throw new SendError(
        "The selected signer does not contribute weight to any unsatisfied source account.",
      );
    }
    const { kp, publicKey } = resolveSource(params.secretKey, params.hardwareSigner);
    if (publicKey !== params.signerPublicKey) {
      throw new SendError("Signing credential does not match the selected account.");
    }
    if (kp) tx.sign(kp);
    else if (params.hardwareSigner) await signHardwareTx(tx, params.hardwareSigner);
    assertReviewTimeValid(review);
    addedSignature = true;
    evaluation = authorizationEvaluationFromContext(tx, context);
    authorizations = evaluation.authorizations;
    signedKeys = new Set(authorizations.flatMap((entry) => entry.signedKeys));
  }

  const collected = authorizations.reduce((sum, entry) => sum + entry.collectedWeight, 0);
  const required = authorizations.reduce((sum, entry) => sum + entry.requiredWeight, 0);
  if (authorizations.every((entry) => entry.satisfied)) {
    try {
      assertReviewTimeValid(review);
      const res = await submitSignedTx(tx, params.network, 15_000, params.onPrepared);
      return {
        submission: res,
        xdr: tx.toXdr(),
        collectedWeight: collected,
        requiredWeight: required,
        signedKeys: [...signedKeys],
        addedSignature,
        operationCount: tx.operations.length,
        authorizations,
      };
    } catch (err) {
      throw new SendError(explainSubmitError(err));
    }
  }

  return {
    submission: null,
    xdr: tx.toXdr(),
    collectedWeight: collected,
    requiredWeight: required,
    signedKeys: [...signedKeys],
    addedSignature,
    operationCount: tx.operations.length,
    authorizations,
  };
}
