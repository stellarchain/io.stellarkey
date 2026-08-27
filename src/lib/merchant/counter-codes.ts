import { StrKey } from "@stellar/stellar-sdk";

import { memoByteLength } from "../format";
import { buildSep7PayUri } from "../payuri";
import { NETWORKS, type NetworkKey } from "../stellar";
import {
  assetKey,
  buildQuotes,
  isNative,
  sameAsset,
  type QuoteInput,
} from "./charge";
import type { ObservedPayment } from "./match";
import { minorForAssetAmount, unitPriceE6 } from "./money";
import { parsePaymentCreatedAt } from "./payment-time";
import type {
  AcceptedAsset,
  CounterCode,
  CounterCodeKind,
  CounterPayment,
  MerchantStore,
  Minor,
  StaffMember,
} from "./types";

const MAX_TITLE_LENGTH = 48;
const MAX_SUGGESTIONS = 8;

export interface CounterCodeCommit {
  store: MerchantStore;
  code: CounterCode;
}

export interface CreateCounterCodeInput {
  id: string;
  actor: StaffMember;
  title: string;
  kind: CounterCodeKind;
  amountMinor: Minor | null;
  suggestedMinor: Minor[];
  acceptedAssets: AcceptedAsset[];
  memoPrefix: string;
  staffId: string | null;
  expiresAt: number | null;
  network: NetworkKey;
  destination: string;
  quotes: QuoteInput[];
  now?: number;
}

export interface UpdateCounterCodeInput {
  codeId: string;
  actor: StaffMember;
  title: string;
  suggestedMinor: Minor[];
  staffId: string | null;
  expiresAt: number | null;
  now?: number;
}

export interface SetCounterCodeActiveInput {
  codeId: string;
  actor: StaffMember;
  active: boolean;
  now?: number;
}

export interface ReconcileCounterPaymentsInput {
  network: NetworkKey;
  payments: ObservedPayment[];
  /** Current shop-currency rates, used only by open and tip codes. */
  rates: QuoteInput[];
  now?: number;
}

function safeTime(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} is invalid.`);
  return value;
}

function currentActor(store: MerchantStore, actor: StaffMember): StaffMember {
  const member = store.staff.find((entry) => entry.id === actor.id);
  if (!member?.active || !member.permissions.takePayment) {
    throw new Error(`${actor.name || "This staff member"} is not allowed to manage counter codes.`);
  }
  return member;
}

function validateTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new Error("Give the counter code a title.");
  if (title.length > MAX_TITLE_LENGTH) {
    throw new Error(`A counter-code title can be at most ${MAX_TITLE_LENGTH} characters.`);
  }
  return title;
}

function validateSuggestions(kind: CounterCodeKind, values: Minor[]): Minor[] {
  if (kind === "fixed") return [];
  if (values.length > MAX_SUGGESTIONS) {
    throw new Error(`Use at most ${MAX_SUGGESTIONS} suggested amounts.`);
  }
  const unique = new Set<number>();
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("Suggested amounts must be positive integer minor units.");
    }
    if (unique.has(value)) throw new Error("Suggested amounts must be unique.");
    unique.add(value);
  }
  return [...unique].sort((a, b) => a - b);
}

function validateExpiry(value: number | null, now: number): number | null {
  if (value === null) return null;
  safeTime(value, "Counter-code expiry");
  if (value <= now) throw new Error("Choose a counter-code expiry in the future.");
  return value;
}

function validateMemo(store: MerchantStore, value: string, excludeId?: string): string {
  const memo = value.trim();
  if (!/^[A-Z0-9]+$/.test(memo) || memoByteLength(memo) > 28) {
    throw new Error("A counter-code memo needs 1 to 28 uppercase letters or numbers.");
  }
  if (
    store.counterCodes.some(
      (code) => code.id !== excludeId && code.memoPrefix.toUpperCase() === memo.toUpperCase(),
    )
  ) {
    throw new Error("That counter-code memo is already in use.");
  }
  return memo;
}

function validateAssets(store: MerchantStore, assets: AcceptedAsset[]): AcceptedAsset[] {
  if (assets.length === 0) throw new Error("A counter code needs at least one accepted asset.");
  const accepted = new Set(store.settings.acceptedAssets.map(assetKey));
  const seen = new Set<string>();
  return assets.map((asset) => {
    const code = asset.code.trim();
    if (!/^[A-Za-z0-9]{1,12}$/.test(code)) throw new Error("A counter-code asset code is invalid.");
    if (!isNative(asset) && (!asset.issuer || !StrKey.isValidEd25519PublicKey(asset.issuer))) {
      throw new Error(`${code} does not have a valid issuer.`);
    }
    const normalized = isNative(asset)
      ? { code: "XLM", issuer: null }
      : { code, issuer: asset.issuer };
    const key = assetKey(normalized);
    if (!accepted.has(key)) throw new Error(`${code} is not accepted by this shop.`);
    if (seen.has(key)) throw new Error(`${code} is selected more than once.`);
    seen.add(key);
    return normalized;
  });
}

function validateStaff(
  store: MerchantStore,
  kind: CounterCodeKind,
  staffId: string | null,
): string | null {
  if (kind !== "tip") return null;
  if (staffId === null || staffId === "") return null;
  if (!store.staff.some((member) => member.id === staffId && member.active)) {
    throw new Error("Choose an active staff member for this tip code.");
  }
  return staffId;
}

function findCode(store: MerchantStore, codeId: string): CounterCode {
  const code = store.counterCodes.find((entry) => entry.id === codeId);
  if (!code) throw new Error("That counter code no longer exists.");
  return code;
}

function replaceCode(store: MerchantStore, code: CounterCode): MerchantStore {
  return {
    ...store,
    counterCodes: store.counterCodes.map((entry) => (entry.id === code.id ? code : entry)),
  };
}

export function createCounterCode(
  store: MerchantStore,
  input: CreateCounterCodeInput,
): CounterCodeCommit {
  const actor = currentActor(store, input.actor);
  const now = safeTime(input.now ?? Date.now(), "Counter-code creation time");
  const id = input.id.trim();
  if (!id || store.counterCodes.some((code) => code.id === id)) {
    throw new Error("That counter-code identity is invalid or already exists.");
  }
  if (!NETWORKS[input.network]) throw new Error("Choose a valid Stellar network.");
  const destination = input.destination.trim();
  if (!StrKey.isValidEd25519PublicKey(destination)) {
    throw new Error("The counter-code receiving account is not a valid Stellar public key.");
  }
  const title = validateTitle(input.title);
  const memoPrefix = validateMemo(store, input.memoPrefix);
  const acceptedAssets = validateAssets(store, input.acceptedAssets);
  const suggestedMinor = validateSuggestions(input.kind, input.suggestedMinor);
  const staffId = validateStaff(store, input.kind, input.staffId);
  const expiresAt = validateExpiry(input.expiresAt, now);

  let amountMinor: Minor | null = null;
  let quotes: CounterCode["quotes"] = [];
  if (input.kind === "fixed") {
    if (!Number.isSafeInteger(input.amountMinor) || (input.amountMinor as number) <= 0) {
      throw new Error("A fixed counter code needs a positive minor-unit amount.");
    }
    amountMinor = input.amountMinor as Minor;
    const quoteKeys = new Set(input.quotes.map(({ asset }) => assetKey(asset)));
    if (
      input.quotes.length !== acceptedAssets.length ||
      acceptedAssets.some((asset) => !quoteKeys.has(assetKey(asset)))
    ) {
      throw new Error("Every fixed-price asset needs one live publication quote.");
    }
    if (quoteKeys.size !== input.quotes.length) {
      throw new Error("A fixed-price publication quote is duplicated.");
    }
    quotes = buildQuotes(amountMinor, input.quotes, now);
  } else if (input.amountMinor !== null || input.quotes.length > 0) {
    throw new Error("Open and tip codes cannot lock a fixed amount or quote.");
  }

  const code: CounterCode = {
    id,
    title,
    kind: input.kind,
    amountMinor,
    suggestedMinor,
    currency: store.settings.currency,
    acceptedAssets,
    memoPrefix,
    requestMessage: `${store.settings.profile.name.trim() || "Your shop"} · ${title}`,
    network: input.network,
    destination,
    quotes,
    staffId,
    active: true,
    payments: 0,
    takingsMinor: 0,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    createdById: actor.id,
    createdBy: actor.name,
  };
  return {
    code,
    store: { ...store, counterCodes: [code, ...store.counterCodes] },
  };
}

export function updateCounterCode(
  store: MerchantStore,
  input: UpdateCounterCodeInput,
): CounterCodeCommit {
  currentActor(store, input.actor);
  const code = findCode(store, input.codeId);
  const now = safeTime(input.now ?? Date.now(), "Counter-code update time");
  if (now < code.createdAt) throw new Error("A counter-code update cannot predate its creation.");
  const updated: CounterCode = {
    ...code,
    title: validateTitle(input.title),
    suggestedMinor: validateSuggestions(code.kind, input.suggestedMinor),
    staffId: validateStaff(store, code.kind, input.staffId),
    expiresAt:
      input.expiresAt === code.expiresAt
        ? code.expiresAt
        : validateExpiry(input.expiresAt, now),
    updatedAt: now,
  };
  return { code: updated, store: replaceCode(store, updated) };
}

export function setCounterCodeActive(
  store: MerchantStore,
  input: SetCounterCodeActiveInput,
): CounterCodeCommit {
  currentActor(store, input.actor);
  const code = findCode(store, input.codeId);
  const now = safeTime(input.now ?? Date.now(), "Counter-code filing time");
  if (now < code.createdAt) throw new Error("A counter-code change cannot predate its creation.");
  if (code.active === input.active) return { code, store };
  const updated = { ...code, active: input.active, updatedAt: now };
  return { code: updated, store: replaceCode(store, updated) };
}

export function counterCodeAvailability(
  code: CounterCode,
  now = Date.now(),
): "active" | "paused" | "expired" {
  if (!code.active) return "paused";
  if (code.expiresAt !== null && now >= code.expiresAt) return "expired";
  return "active";
}

export function counterCodePayUri(
  code: CounterCode,
  asset: AcceptedAsset,
): string {
  const accepted = code.acceptedAssets.find((entry) => sameAsset(entry, asset));
  if (!accepted) throw new Error(`${asset.code} is not accepted by this counter code.`);
  const quote = code.kind === "fixed"
    ? code.quotes.find((entry) => sameAsset(entry.asset, accepted)) ?? null
    : null;
  if (code.kind === "fixed" && !quote) {
    throw new Error(`${asset.code} has no locked publication quote.`);
  }
  return buildCounterCodePayUri({
    destination: code.destination,
    network: code.network,
    asset: accepted,
    memo: code.memoPrefix,
    title: code.requestMessage,
    amount: quote?.amount ?? null,
  });
}

export function buildCounterCodePayUri(input: {
  destination: string;
  network: NetworkKey;
  asset: AcceptedAsset;
  memo: string;
  title: string;
  shopName?: string;
  amount?: string | null;
}): string {
  return buildSep7PayUri({
    destination: input.destination,
    amount: input.amount ?? undefined,
    assetCode: isNative(input.asset) ? undefined : input.asset.code,
    assetIssuer: isNative(input.asset) ? undefined : (input.asset.issuer ?? undefined),
    memo: input.memo,
    memoType: "text",
    msg: input.shopName ? `${input.shopName} · ${input.title}` : input.title,
    networkPassphrase: NETWORKS[input.network].networkPassphrase,
  });
}

function paymentMinor(
  code: CounterCode,
  payment: ObservedPayment,
  rates: QuoteInput[],
): { amountMinor: Minor | null; quote: CounterPayment["quote"] } {
  if (code.kind === "fixed") {
    const quote = code.quotes.find((entry) => sameAsset(entry.asset, payment.asset)) ?? null;
    if (!quote) return { amountMinor: null, quote: null };
    return {
      amountMinor: minorForAssetAmount(payment.amount, quote.unitPriceMinorE6),
      quote: { ...quote, asset: { ...quote.asset } },
    };
  }
  const rate = rates.find((entry) => sameAsset(entry.asset, payment.asset));
  if (!rate) return { amountMinor: null, quote: null };
  return {
    amountMinor: minorForAssetAmount(payment.amount, unitPriceE6(rate.currencyPerUnit)),
    quote: null,
  };
}

export function reconcileCounterPayments(
  store: MerchantStore,
  input: ReconcileCounterPaymentsInput,
): { store: MerchantStore; unclaimed: ObservedPayment[] } {
  const now = safeTime(input.now ?? Date.now(), "Counter-code reconciliation time");
  const claimedIds = new Set(store.counterPayments.map((entry) => entry.id));
  let counterCodes = store.counterCodes;
  const counterPayments = [...store.counterPayments];
  const unclaimed: ObservedPayment[] = [];

  for (const payment of input.payments) {
    if (claimedIds.has(payment.id)) continue;
    const paymentAt = parsePaymentCreatedAt(payment.createdAt);
    if (paymentAt === null) {
      unclaimed.push(payment);
      continue;
    }
    const codeIndex = payment.memo
      ? counterCodes.findIndex(
          (code) =>
            code.memoPrefix === payment.memo &&
            code.network === input.network &&
            code.destination === payment.destination &&
            paymentAt >= code.createdAt &&
            counterCodeAvailability(code, paymentAt) === "active",
        )
      : -1;
    if (codeIndex < 0) {
      unclaimed.push(payment);
      continue;
    }
    const code = counterCodes[codeIndex];
    if (!code.acceptedAssets.some((asset) => sameAsset(asset, payment.asset))) {
      unclaimed.push(payment);
      continue;
    }

    let priced: ReturnType<typeof paymentMinor>;
    try {
      priced = paymentMinor(code, payment, input.rates);
    } catch {
      unclaimed.push(payment);
      continue;
    }
    if (priced.amountMinor !== null && priced.amountMinor <= 0) {
      unclaimed.push(payment);
      continue;
    }
    const record: CounterPayment = {
      id: payment.id,
      codeId: code.id,
      payment: { ...payment, asset: { ...payment.asset }, lane: "memo" },
      amountMinor: priced.amountMinor,
      quote: priced.quote,
      seenAt: now,
    };
    const updated: CounterCode = {
      ...code,
      payments: code.payments + 1,
      takingsMinor: code.takingsMinor + (priced.amountMinor ?? 0),
      updatedAt: now,
    };
    counterCodes = counterCodes.map((entry, index) => (index === codeIndex ? updated : entry));
    counterPayments.push(record);
    claimedIds.add(payment.id);
  }

  if (counterCodes === store.counterCodes && counterPayments.length === store.counterPayments.length) {
    return { store, unclaimed };
  }
  return {
    store: { ...store, counterCodes, counterPayments },
    unclaimed,
  };
}
