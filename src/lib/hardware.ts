/**
 * Hardware Wallet Transport & Client for Stellar.
 * Trezor is supported through Trezor Connect. Ledger is deliberately rejected
 * until a real transport and signing implementation is available.
 *
 * Trezor integration uses the official @trezor/connect API: addresses are
 * read from the device itself (stellarGetAddress, optionally confirmed on
 * the device screen) and transactions are signed on-device via
 * stellarSignTransaction with the structured Stellar operation schema.
 */
import { Asset, Keypair, StrKey, xdr, type Memo, type Transaction } from "@stellar/stellar-sdk";
import type { StellarOperation as TrezorStellarOperation } from "@trezor/connect-web";

/** stellar-sdk v17 transaction operation (discriminated union on `type`). */
type TxOperation = Transaction["operations"][number];

type TrezorConnectApi = (typeof import("@trezor/connect-web"))["default"];

export type HardwareDeviceType = "ledger" | "trezor";

export interface HardwareAccountInfo {
  device: HardwareDeviceType;
  publicKey: string;
  path: string;
  index: number;
  label: string;
}

/** External signer for api.ts transaction flows (Trezor on-device signing). */
export interface HardwareSigner {
  device: HardwareDeviceType;
  publicKey: string;
  path: string;
}

export function isWebUsbSupported(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

export function isWebHidSupported(): boolean {
  return typeof navigator !== "undefined" && "hid" in navigator;
}

/**
 * Derives the standard Stellar BIP-44 derivation path for an account index.
 * Standard: m/44'/148'/account' (SEP-0005)
 */
export function getStellarDerivationPath(index = 0): string {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 2 ** 31) {
    throw new Error("Stellar derivation index must be an integer from 0 to 2147483647.");
  }
  return `m/44'/148'/${index}'`;
}

/* ------------------------------------------------------------------ */
/* Trezor — real device integration via @trezor/connect                */
/* ------------------------------------------------------------------ */

let trezorConnectPromise: Promise<TrezorConnectApi> | null = null;

/**
 * Preload + initialize @trezor/connect-web in the browser only — the library
 * touches `window`/USB at import time, so it must never run during
 * SSR/prerender. `warmTrezorConnect()` kicks this off when a Trezor UI opens
 * so the user's actual click can start the device interaction immediately.
 * The popup-hosted core keeps WebUSB on Trezor's own origin. The iframe core
 * cannot reach local transports reliably under current browser Local Network
 * Access restrictions and can leave device calls pending indefinitely.
 */
function loadTrezorConnect(): Promise<TrezorConnectApi> {
  if (!trezorConnectPromise) {
    trezorConnectPromise = import("@trezor/connect-web")
      .then(async (mod) => {
        const tc = mod.default;
        await tc.init({
          manifest: {
            email: "dev@localhost",
            appUrl:
              typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
            appName: "Polaris Wallet",
          },
          coreMode: "popup",
          interactionTimeout: 120,
        });
        return tc;
      })
      .catch((err) => {
        // Allow retry after a failed initialization
        trezorConnectPromise = null;
        throw err;
      });
  }
  return trezorConnectPromise;
}

/** Start loading + initializing the connect bundle now (call when a Trezor UI opens). */
export function warmTrezorConnect(): void {
  void loadTrezorConnect().catch(() => {
    /* surfaced on the next interactive call */
  });
}

function trezorError(payload: unknown, fallback: string): Error {
  const msg =
    payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error: unknown }).error)
      : fallback;
  return new Error(msg);
}

/**
 * Connect to a Trezor device and fetch the REAL Stellar address for the
 * given account index. The address is derived on-device from the device
 * seed at m/44'/148'/index' and shown on the Trezor screen so the user
 * can verify it matches before importing.
 */
export async function connectTrezorDevice(index = 0): Promise<HardwareAccountInfo> {
  const path = getStellarDerivationPath(index);
  const tc = await loadTrezorConnect();
  const res = await tc.stellarGetAddress({ path, showOnTrezor: true });
  if (!res.success) {
    throw trezorError(res.payload, "Trezor address request was rejected.");
  }
  if (!StrKey.isValidEd25519PublicKey(res.payload.address)) {
    throw new Error("Trezor returned an invalid Stellar address.");
  }
  return {
    device: "trezor",
    publicKey: res.payload.address,
    path,
    index,
    label: `Trezor ${index + 1}`,
  };
}

/* ---- stellar-sdk Transaction → Trezor StellarSignTransaction mapping ---- */

function toStroops(amount: string): string {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(amount);
  if (!match) {
    throw new Error(`Invalid Stellar amount "${amount}".`);
  }

  const [, whole, fraction = ""] = match;
  return (
    BigInt(whole) * BigInt(10_000_000) + BigInt(fraction.padEnd(7, "0") || "0")
  ).toString();
}

function toTrezorAsset(asset: Asset) {
  if (asset.isNative()) return { type: 0 as const }; // NATIVE
  return {
    type: (asset.getCode().length <= 4 ? 1 : 2) as 1 | 2, // ALPHANUM4 / ALPHANUM12
    code: asset.getCode(),
    issuer: asset.getIssuer(),
  };
}

function toTrezorMemo(memo: Memo) {
  switch (memo.type) {
    case "text": {
      const value = memo.value;
      return {
        type: 1 as const,
        text:
          typeof value === "string"
            ? value
            : new TextDecoder("utf-8", { fatal: true }).decode(value as Uint8Array),
      };
    }
    case "id":
      return { type: 2 as const, id: String(memo.value) };
    case "hash":
      return { type: 3 as const, hash: Buffer.from(memo.value as Uint8Array) };
    case "return":
      return { type: 4 as const, hash: Buffer.from(memo.value as Uint8Array) };
    default:
      return undefined; // MEMO_NONE
  }
}

function toTrezorSigner(
  signer: NonNullable<Extract<TxOperation, { type: "setOptions" }>["signer"]>,
) {
  if ("ed25519PublicKey" in signer && signer.ed25519PublicKey) {
    return {
      type: 0 as const,
      key: Buffer.from(StrKey.decodeEd25519PublicKey(signer.ed25519PublicKey)),
      weight: signer.weight === undefined ? undefined : Number(signer.weight),
    };
  }
  if ("preAuthTx" in signer && signer.preAuthTx) {
    return {
      type: 1 as const,
      key: Buffer.from(signer.preAuthTx),
      weight: signer.weight === undefined ? undefined : Number(signer.weight),
    };
  }
  if ("sha256Hash" in signer && signer.sha256Hash) {
    return {
      type: 2 as const,
      key: Buffer.from(signer.sha256Hash),
      weight: signer.weight === undefined ? undefined : Number(signer.weight),
    };
  }
  throw new Error("Ed25519 signed-payload signers are not supported by Trezor.");
}

type TrezorPrice = { n: number; d: number };

/**
 * Keep offer prices in their exact XDR rational form. `Transaction.operations`
 * exposes only a decimal rendering, which may not round-trip to the same n/d.
 */
function xdrOfferPrices(tx: Transaction): Array<TrezorPrice | undefined> {
  const envelope = tx.toEnvelope();
  const operations =
    envelope.type === "envelopeTypeTx"
      ? envelope.v1.tx.operations
      : envelope.type === "envelopeTypeTxV0"
        ? envelope.v0.tx.operations
        : [];

  return operations.map(({ body }) => {
    switch (body.type) {
      case "manageSellOffer":
        return body.manageSellOfferOp.price;
      case "manageBuyOffer":
        return body.manageBuyOfferOp.price;
      case "createPassiveSellOffer":
        return body.createPassiveSellOfferOp.price;
      default:
        return undefined;
    }
  });
}

function requireOfferPrice(price: TrezorPrice | undefined): TrezorPrice {
  if (!price) throw new Error("Could not read the Stellar offer price from transaction XDR.");
  return { n: price.n, d: price.d };
}

function toTrezorOperation(
  op: TxOperation,
  offerPrice?: TrezorPrice,
): TrezorStellarOperation {
  switch (op.type) {
    case "createAccount":
      return {
        type: "createAccount",
        source: op.source,
        destination: op.destination,
        startingBalance: toStroops(op.startingBalance),
      };
    case "payment":
      return {
        type: "payment",
        source: op.source,
        destination: op.destination,
        asset: toTrezorAsset(op.asset),
        amount: toStroops(op.amount),
      };
    case "pathPaymentStrictSend":
      return {
        type: "pathPaymentStrictSend",
        source: op.source,
        sendAsset: toTrezorAsset(op.sendAsset),
        sendAmount: toStroops(op.sendAmount),
        destination: op.destination,
        destAsset: toTrezorAsset(op.destAsset),
        destMin: toStroops(op.destMin),
        path: op.path.length > 0 ? op.path.map(toTrezorAsset) : undefined,
      };
    case "pathPaymentStrictReceive":
      return {
        type: "pathPaymentStrictReceive",
        source: op.source,
        sendAsset: toTrezorAsset(op.sendAsset),
        sendMax: toStroops(op.sendMax),
        destination: op.destination,
        destAsset: toTrezorAsset(op.destAsset),
        destAmount: toStroops(op.destAmount),
        path: op.path.length > 0 ? op.path.map(toTrezorAsset) : undefined,
      };
    case "manageSellOffer":
      return {
        type: "manageSellOffer",
        source: op.source,
        buying: toTrezorAsset(op.buying),
        selling: toTrezorAsset(op.selling),
        amount: toStroops(op.amount),
        price: requireOfferPrice(offerPrice),
        offerId: String(op.offerId),
      };
    case "manageBuyOffer":
      return {
        type: "manageBuyOffer",
        source: op.source,
        buying: toTrezorAsset(op.buying),
        selling: toTrezorAsset(op.selling),
        amount: toStroops(op.buyAmount),
        price: requireOfferPrice(offerPrice),
        offerId: String(op.offerId),
      };
    case "createPassiveSellOffer":
      return {
        type: "createPassiveSellOffer",
        source: op.source,
        buying: toTrezorAsset(op.buying),
        selling: toTrezorAsset(op.selling),
        amount: toStroops(op.amount),
        price: requireOfferPrice(offerPrice),
      };
    case "changeTrust": {
      if (!(op.line instanceof Asset)) {
        throw new Error("Liquidity-pool trustlines are not supported by Trezor.");
      }
      return {
        type: "changeTrust",
        source: op.source,
        line: toTrezorAsset(op.line),
        limit: toStroops(op.limit),
      };
    }
    case "allowTrust":
      if (op.authorize !== 0 && op.authorize !== 1) {
        throw new Error(
          "Trezor does not support the authorized-to-maintain-liabilities trust flag.",
        );
      }
      return {
        type: "allowTrust",
        source: op.source,
        trustor: op.trustor,
        assetCode: op.assetCode,
        assetType: op.assetCode.length <= 4 ? 1 : 2,
        authorize: op.authorize === 1,
      };
    case "setOptions":
      return {
        type: "setOptions",
        source: op.source,
        signer: op.signer ? toTrezorSigner(op.signer) : undefined,
        inflationDest: op.inflationDest,
        clearFlags: op.clearFlags,
        setFlags: op.setFlags,
        masterWeight: op.masterWeight,
        lowThreshold: op.lowThreshold,
        medThreshold: op.medThreshold,
        highThreshold: op.highThreshold,
        homeDomain: op.homeDomain,
      };
    case "accountMerge":
      return { type: "accountMerge", source: op.source, destination: op.destination };
    case "claimClaimableBalance":
      return { type: "claimClaimableBalance", source: op.source, balanceId: op.balanceId };
    case "bumpSequence":
      return { type: "bumpSequence", source: op.source, bumpTo: String(op.bumpTo) };
    case "inflation":
      return { type: "inflation", source: op.source };
    case "manageData":
      return {
        type: "manageData",
        source: op.source,
        name: op.name,
        value: op.value ? Buffer.from(op.value) : undefined,
      };
    default:
      throw new Error(
        `Operation "${op.type}" is not supported by Trezor signing in this wallet.`,
      );
  }
}

function toSafeTrezorTimeBound(value: string | number): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error("Stellar time bounds are too large for Trezor Connect to represent exactly.");
  }
  return numeric;
}

/**
 * Sign a built (unsigned) Stellar transaction on the Trezor device and
 * attach the returned decorated signature in place. The device displays
 * the transaction for user confirmation.
 */
export async function signTrezorTransaction(
  tx: Transaction,
  path: string,
  expectedPublicKey = tx.source,
): Promise<void> {
  if (
    tx.ledgerBounds !== undefined ||
    tx.minAccountSequence !== undefined ||
    tx.minAccountSequenceAge !== undefined ||
    tx.minAccountSequenceLedgerGap !== undefined ||
    (tx.extraSigners?.length ?? 0) > 0
  ) {
    throw new Error("Advanced Stellar preconditions are not supported by Trezor Connect.");
  }

  const timebounds = tx.timeBounds
    ? {
        minTime: toSafeTrezorTimeBound(tx.timeBounds.minTime),
        maxTime: toSafeTrezorTimeBound(tx.timeBounds.maxTime),
      }
    : undefined;
  const offerPrices = xdrOfferPrices(tx);

  const tc = await loadTrezorConnect();
  const res = await tc.stellarSignTransaction({
    path,
    networkPassphrase: tx.networkPassphrase,
    transaction: {
      source: tx.source,
      // This is the transaction envelope's total fee, not the base fee per operation.
      fee: Number(tx.fee),
      sequence: tx.sequence,
      timebounds,
      memo: toTrezorMemo(tx.memo),
      // Field-exact mapping to Trezor's StellarOperation schema (numeric
      // asset/memo enums and stroop-denominated amounts).
      operations: tx.operations.map((op, index) =>
        toTrezorOperation(op, offerPrices[index]),
      ),
    },
  });
  if (!res.success) {
    throw trezorError(res.payload, "Trezor signing was rejected.");
  }
  const publicKeyBytes = Buffer.from(StrKey.decodeEd25519PublicKey(expectedPublicKey));
  const returnedPublicKey = (res.payload as { publicKey?: unknown }).publicKey;
  if (returnedPublicKey !== undefined && typeof returnedPublicKey !== "string") {
    throw new Error("Trezor returned an invalid public key.");
  }
  if (
    typeof returnedPublicKey === "string" &&
    returnedPublicKey.toLowerCase() !== publicKeyBytes.toString("hex")
  ) {
    throw new Error(
      "The signing key returned by Trezor does not match the imported hardware account.",
    );
  }

  const returnedSignature = (res.payload as { signature?: unknown }).signature;
  if (
    typeof returnedSignature !== "string" ||
    !/^[0-9a-f]{128}$/i.test(returnedSignature)
  ) {
    throw new Error("Trezor returned an invalid Stellar signature.");
  }
  const signature = Buffer.from(returnedSignature, "hex");
  if (!Keypair.fromPublicKey(expectedPublicKey).verify(tx.hash(), signature)) {
    throw new Error(
      "The signature returned by Trezor does not match the imported hardware account or transaction.",
    );
  }
  // Decorated-signature hint = last 4 bytes of the signing public key
  const hint = publicKeyBytes.subarray(-4);
  tx.signatures.push(new xdr.DecoratedSignature({ hint, signature }));
}

/**
 * Entry point used by api.ts transaction flows when the active account is a
 * hardware wallet account.
 */
export async function signHardwareTx(tx: Transaction, signer: HardwareSigner): Promise<void> {
  if (signer.device === "trezor") {
    await signTrezorTransaction(tx, signer.path, signer.publicKey);
    return;
  }
  throw new Error("Ledger transaction signing is not yet supported in this build.");
}

/* ------------------------------------------------------------------ */
/* Ledger — unsupported (no @ledgerhq transport wired in this app) */
/* ------------------------------------------------------------------ */

/**
 * Connect to Ledger device via WebUSB / WebHID and fetch the Stellar public address.
 */
export async function connectLedgerDevice(index = 0): Promise<HardwareAccountInfo> {
  void index;
  throw new Error(
    "Ledger is not supported in this build. No account was imported. Use Trezor or a watch-only address.",
  );
}
