/**
 * Multi-signature orchestration for Stellar accounts: threshold/signer
 * configuration via setOptions, partially-signed payment envelopes for
 * co-signing, and cosigner-envelope merging with weight-aware submission.
 *
 * Threshold model (Stellar): every operation needs a minimum signing weight
 * (low/med/high). Payments and most ops are "med"; setOptions is "high".
 */
import {
  Asset,
  FeeBumpTransaction,
  Keypair,
  Operation,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import {
  explainSubmitError,
  fetchAccountSignerInfo,
  getJson,
  minimalAccount,
  resolveSource,
  signAndSubmit,
  submitSignedTx,
  SendError,
} from "./api";
import { getHorizonUrl, NETWORKS, type NetworkKey } from "./stellar";
import { normalizeAmount } from "./format";
import { isValidPublicAddress } from "./vault";
import { signHardwareTx, type HardwareSigner } from "./hardware";
import { buildStellarMemo, toStellarAsset, type StellarMemoInput } from "./stellar-domain";

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

export function totalWeight(signers: { weight: number }[]): number {
  return signers.reduce((sum, s) => sum + s.weight, 0);
}

/** Signing weight a transaction requires, derived from its operation types. */
export function requiredWeightForTx(tx: Transaction, thresholds: {
  low_threshold: number;
  med_threshold: number;
  high_threshold: number;
}): number {
  let required = 0;
  for (const op of tx.operations) {
    let level: number;
    if (op.type === "setOptions") level = thresholds.high_threshold;
    else if (op.type === "bumpSequence" || op.type === "allowTrust" || op.type === "setTrustLineFlags") {
      level = thresholds.low_threshold;
    } else level = thresholds.med_threshold;
    if (level > required) required = level;
  }
  return required;
}

/** Apply a full signer/threshold configuration to an account (setOptions). */
export async function applyMultisigConfig(params: {
  network: NetworkKey;
  accountPublicKey: string;
  config: MultisigConfig;
  secretKey?: string;
  hardwareSigner?: HardwareSigner;
}): Promise<{ hash: string }> {
  const { network, accountPublicKey, config } = params;

  const thresholds = [config.low, config.medium, config.high];
  if (thresholds.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new SendError("Thresholds must be whole numbers between 0 and 255.");
  }
  if (new Set(config.signers.map((signer) => signer.key)).size !== config.signers.length) {
    throw new SendError("Signer addresses must be unique.");
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

  const builder = new TransactionBuilder(minimalAccount(accountPublicKey, source.sequence), {
    fee: "100",
    networkPassphrase: cfg.networkPassphrase,
  });

  // 1) Remove cosigners that are absent from the new configuration
  const keep = new Set(config.signers.map((s) => s.key));
  for (const s of current?.signers ?? []) {
    if (s.key === accountPublicKey) continue;
    if (!keep.has(s.key)) {
      builder.addOperation(
        Operation.setOptions({ signer: { ed25519PublicKey: s.key, weight: 0 } }),
      );
    }
  }
  // 2) Upsert cosigners
  for (const s of config.signers) {
    if (s.key === accountPublicKey) continue;
    builder.addOperation(
      Operation.setOptions({ signer: { ed25519PublicKey: s.key, weight: s.weight } }),
    );
  }
  // 3) Thresholds + master weight last (single atomic transaction)
  builder.addOperation(
    Operation.setOptions({
      masterWeight: own.weight,
      lowThreshold: config.low,
      medThreshold: config.medium,
      highThreshold: config.high,
    }),
  );

  const tx = builder.setTimeout(180).build();
  try {
    return await signAndSubmit(tx, network, kp, params.hardwareSigner);
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
}): Promise<{ hash: string }> {
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
  const feeStroops = params.feeStroops ?? 100;
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

export interface TxOpExplanation {
  type: string;
  title: string;
  lines: { label: string; value: string; kind?: "text" | "mono" | "address" }[];
  risk: "none" | "warn" | "danger";
}

export interface TxExplanation {
  source: string;
  feeXlm: string;
  sequence: string;
  memoText?: string;
  /** epoch seconds, when the envelope has a maxTime timebound */
  expiresAt?: number;
  operations: TxOpExplanation[];
  collectedWeight: number;
  requiredWeight: number;
  signedKeys: string[];
  operationCount: number;
  /** Envelope network passphrase differs from the active network */
  networkMismatch: boolean;
  hasDangerOps: boolean;
}

function assetCodeOf(asset: Asset): string {
  return asset.isNative() ? "XLM" : asset.getCode();
}

function explainOp(op: Transaction["operations"][number]): TxOpExplanation {
  switch (op.type) {
    case "payment":
      return {
        type: op.type,
        risk: "none",
        title: `Send ${op.amount} ${assetCodeOf(op.asset)}`,
        lines: [
          { label: "To", value: op.destination, kind: "address" },
          { label: "Amount", value: `${op.amount} ${assetCodeOf(op.asset)}`, kind: "mono" },
        ],
      };
    case "createAccount":
      return {
        type: op.type,
        risk: "none",
        title: "Create & fund a new account",
        lines: [
          { label: "New account", value: op.destination, kind: "address" },
          { label: "Starting balance", value: `${op.startingBalance} XLM`, kind: "mono" },
        ],
      };
    case "changeTrust": {
      const removing = parseFloat(op.limit) === 0;
      return {
        type: op.type,
        risk: "none",
        title: `${removing ? "Remove" : "Add"} trustline — ${assetCodeOf(op.line as Asset)}`,
        lines: [
          { label: "Asset", value: assetCodeOf(op.line as Asset), kind: "mono" },
          { label: "Issuer", value: (op.line as Asset).getIssuer() ?? "", kind: "address" },
        ],
      };
    }
    case "pathPaymentStrictSend":
      return {
        type: op.type,
        risk: "none",
        title: `Swap ${op.sendAmount} ${assetCodeOf(op.sendAsset)} → ${assetCodeOf(op.destAsset)}`,
        lines: [
          { label: "You send", value: `${op.sendAmount} ${assetCodeOf(op.sendAsset)}`, kind: "mono" },
          { label: "Min. received", value: `${op.destMin} ${assetCodeOf(op.destAsset)}`, kind: "mono" },
          { label: "Destination", value: op.destination, kind: "address" },
          { label: "Route hops", value: String(op.path.length), kind: "mono" },
        ],
      };
    case "pathPaymentStrictReceive":
      return {
        type: op.type,
        risk: "none",
        title: `Swap → ${op.destAmount} ${assetCodeOf(op.destAsset)}`,
        lines: [
          { label: "Max. send", value: `${op.sendMax} ${assetCodeOf(op.sendAsset)}`, kind: "mono" },
          { label: "You receive", value: `${op.destAmount} ${assetCodeOf(op.destAsset)}`, kind: "mono" },
          { label: "Destination", value: op.destination, kind: "address" },
        ],
      };
    case "accountMerge":
      return {
        type: op.type,
        risk: "danger",
        title: "Close account & merge all funds",
        lines: [
          { label: "Receives everything", value: op.destination, kind: "address" },
          { label: "Effect", value: "Permanently closes the source account" },
        ],
      };
    case "setOptions": {
      const lines: TxOpExplanation["lines"] = [];
      if (op.signer) {
        const key =
          "ed25519PublicKey" in op.signer ? String(op.signer.ed25519PublicKey) : "custom signer";
        const w = Number(op.signer.weight ?? 0);
        lines.push({
          label: w === 0 ? "Remove signer" : "Add/update signer",
          value: key,
          kind: "address",
        });
        if (w > 0) lines.push({ label: "Signer weight", value: String(w), kind: "mono" });
      }
      if (op.masterWeight !== undefined) {
        lines.push({ label: "Master weight", value: String(op.masterWeight), kind: "mono" });
      }
      if (
        op.lowThreshold !== undefined ||
        op.medThreshold !== undefined ||
        op.highThreshold !== undefined
      ) {
        lines.push({
          label: "Thresholds L/M/H",
          value: `${op.lowThreshold ?? "—"} / ${op.medThreshold ?? "—"} / ${op.highThreshold ?? "—"}`,
          kind: "mono",
        });
      }
      if (op.homeDomain !== undefined) {
        lines.push({ label: "Home domain", value: String(op.homeDomain) });
      }
      if (lines.length === 0) lines.push({ label: "Detail", value: "Account flag changes" });
      return {
        type: op.type,
        risk: "danger",
        title: "Change signers / thresholds",
        lines,
      };
    }
    case "claimClaimableBalance":
      return {
        type: op.type,
        risk: "none",
        title: "Claim a claimable balance",
        lines: [{ label: "Balance ID", value: op.balanceId, kind: "mono" }],
      };
    case "manageData":
      return {
        type: op.type,
        risk: "warn",
        title: `Set data entry "${op.name}"`,
        lines: [{ label: "Name", value: op.name, kind: "mono" }],
      };
    case "bumpSequence":
      return {
        type: op.type,
        risk: "warn",
        title: "Bump account sequence",
        lines: [{ label: "Bump to", value: String(op.bumpTo), kind: "mono" }],
      };
    case "manageSellOffer":
    case "createPassiveSellOffer":
      return {
        type: op.type,
        risk: "none",
        title: `Offer: sell ${op.amount} ${assetCodeOf(op.selling)} for ${assetCodeOf(op.buying)}`,
        lines: [
          { label: "Selling", value: `${op.amount} ${assetCodeOf(op.selling)}`, kind: "mono" },
          { label: "Price", value: `${op.price} ${assetCodeOf(op.buying)}`, kind: "mono" },
        ],
      };
    case "manageBuyOffer":
      return {
        type: op.type,
        risk: "none",
        title: `Offer: buy ${op.buyAmount} ${assetCodeOf(op.buying)}`,
        lines: [
          { label: "Buying", value: `${op.buyAmount} ${assetCodeOf(op.buying)}`, kind: "mono" },
          { label: "Selling", value: assetCodeOf(op.selling), kind: "mono" },
          { label: "Price", value: `${op.price} ${assetCodeOf(op.buying)}`, kind: "mono" },
        ],
      };
    case "allowTrust":
    case "setTrustLineFlags":
      return {
        type: op.type,
        risk: "warn",
        title: "Change trustline authorization",
        lines: [{ label: "Operation", value: op.type, kind: "mono" }],
      };
    case "clawback":
    case "clawbackClaimableBalance":
      return {
        type: op.type,
        risk: "danger",
        title: "Claw back funds",
        lines: [{ label: "Operation", value: op.type, kind: "mono" }],
      };
    case "invokeHostFunction":
    case "extendFootprintTtl":
    case "restoreFootprint":
      return {
        type: op.type,
        risk: "warn",
        title: "Smart contract interaction",
        lines: [{ label: "Note", value: "Contract call details are not decodable here" }],
      };
    default:
      return {
        type: op.type,
        risk: "warn",
        title: op.type,
        lines: [{ label: "Note", value: "Unrecognized operation type — review carefully" }],
      };
  }
}

/**
 * Decode a transaction envelope into a human-readable explanation for
 * pre-signature review: plain-English operations, risk flags, expiry,
 * network check, and the current signature-weight status of the source
 * account — WITHOUT signing anything.
 */
export async function explainTransaction(
  xdr: string,
  network: NetworkKey,
): Promise<TxExplanation> {
  const cfg = NETWORKS[network];
  let tx: Transaction | FeeBumpTransaction;
  try {
    tx = TransactionBuilder.fromXdr(xdr.trim(), cfg.networkPassphrase);
  } catch {
    throw new SendError("That doesn't look like a valid transaction envelope (base64 XDR).");
  }
  if (tx instanceof FeeBumpTransaction) {
    throw new SendError("Fee-bump envelopes are not supported — share the inner transaction envelope.");
  }

  const info = await fetchAccountSignerInfo(tx.source, network);
  const signerEntries: MultisigSignerEntry[] = (info?.signers ?? []).map((s) => ({
    key: s.key,
    weight: s.weight,
  }));
  const thresholds = info?.thresholds ?? { low_threshold: 0, med_threshold: 1, high_threshold: 1 };
  const { collected, signedKeys } = verifySignedKeys(tx, signerEntries);

  const operations = tx.operations.map(explainOp);
  return {
    source: tx.source,
    feeXlm: (Number(tx.fee) / 10_000_000).toFixed(7),
    sequence: tx.sequence,
    memoText:
      tx.memo.type === "text"
        ? String(tx.memo.value ?? "")
        : tx.memo.type === "id"
          ? `id: ${String(tx.memo.value)}`
          : undefined,
    expiresAt: tx.timeBounds ? Number(tx.timeBounds.maxTime) : undefined,
    operations,
    collectedWeight: collected,
    requiredWeight: requiredWeightForTx(tx, thresholds),
    signedKeys: [...signedKeys],
    operationCount: tx.operations.length,
    networkMismatch: tx.networkPassphrase !== cfg.networkPassphrase,
    hasDangerOps: operations.some((o) => o.risk === "danger"),
  };
}


export interface CosignOutcome {
  submitted: boolean;
  hash?: string;
  /** Updated envelope including any signature we added. */
  xdr: string;
  collectedWeight: number;
  requiredWeight: number;
  signedKeys: string[];
  addedSignature: boolean;
  operationCount: number;
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

/**
 * Import a (partially-signed) transaction envelope, add our signature if it
 * is missing, and submit once the collected weight meets the threshold.
 */
export async function cosignTransaction(params: {
  network: NetworkKey;
  xdr: string;
  signerPublicKey: string;
  secretKey?: string;
  hardwareSigner?: HardwareSigner;
}): Promise<CosignOutcome> {
  const cfg = NETWORKS[params.network];
  let tx: Transaction | FeeBumpTransaction;
  try {
    tx = TransactionBuilder.fromXdr(params.xdr.trim(), cfg.networkPassphrase);
  } catch {
    throw new SendError("That doesn't look like a valid transaction envelope (base64 XDR).");
  }
  if (tx instanceof FeeBumpTransaction) {
    throw new SendError("Fee-bump envelopes are not supported — share the inner transaction envelope.");
  }

  const info = await fetchAccountSignerInfo(tx.source, params.network);
  if (!info) throw new SendError("Source account was not found on this network.");
  const signerEntries: MultisigSignerEntry[] = info.signers.map((s) => ({
    key: s.key,
    weight: s.weight,
  }));
  const required = requiredWeightForTx(tx, info.thresholds);

  let { collected, signedKeys } = verifySignedKeys(tx, signerEntries);

  let addedSignature = false;
  if (!signedKeys.has(params.signerPublicKey)) {
    if (!signerEntries.some((s) => s.key === params.signerPublicKey)) {
      throw new SendError("The selected account is not a signer on this transaction's source account.");
    }
    const { kp, publicKey } = resolveSource(params.secretKey, params.hardwareSigner);
    if (publicKey !== params.signerPublicKey) {
      throw new SendError("Signing credential does not match the selected account.");
    }
    if (kp) tx.sign(kp);
    else if (params.hardwareSigner) await signHardwareTx(tx, params.hardwareSigner);
    addedSignature = true;
    ({ collected, signedKeys } = verifySignedKeys(tx, signerEntries));
  }

  if (collected >= required) {
    try {
      const res = await submitSignedTx(tx, params.network);
      return {
        submitted: true,
        hash: res.hash,
        xdr: tx.toXdr(),
        collectedWeight: collected,
        requiredWeight: required,
        signedKeys: [...signedKeys],
        addedSignature,
        operationCount: tx.operations.length,
      };
    } catch (err) {
      throw new SendError(explainSubmitError(err));
    }
  }

  return {
    submitted: false,
    xdr: tx.toXdr(),
    collectedWeight: collected,
    requiredWeight: required,
    signedKeys: [...signedKeys],
    addedSignature,
    operationCount: tx.operations.length,
  };
}
