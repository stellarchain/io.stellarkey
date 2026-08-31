import { StrKey } from '@stellar/stellar-sdk';
import {
  decryptBytesWithKey,
  encryptBytesWithKey,
  type RawKeyEncryptedPayload,
} from '../../../lib/crypto';
import { IndexedDbEncryptedRecordDriver } from '../../../lib/indexed-db';
import type { PrivateBalanceStorageScope } from '../../../lib/private-balance-bootstrap';

const RECORD_KIND = 'stellarkey-stealth-discovery-cache';
const RECORD_VERSION = 1;
const CACHE_PREFIX = 'private:cache:v1';
const MAX_CACHE_RECORD_BYTES = 8 * 1024 * 1024;
const MAX_PAYMENTS = 10_000;
const HEX_32 = /^[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type StealthPaymentStatus = 'unspent' | 'sweeping' | 'swept' | 'ignored';

export interface StealthOwnedPayment {
  transactionHash: string;
  pagingToken: string;
  ephemeralPublicKey: string;
  destinationPublicKey: string;
  amountStroops: string;
  ledger: number;
  createdAt: number;
  status: StealthPaymentStatus;
  sweptTransactionHash?: string;
  sweepActionField?: string;
}

export interface StealthDiscoveryCache {
  schemaVersion: 1;
  revision: number;
  cursor: string | null;
  lowerBoundCreatedAt: number;
  latestLedger: number;
  payments: StealthOwnedPayment[];
  updatedAt: number;
}

export interface StealthCacheDriver {
  read(key: string): Promise<string | null>;
  compareAndSet(
    key: string,
    expectedRevision: number | null,
    value: string,
  ): Promise<{ ok: boolean; current: string | null }>;
  removePrefix(prefix: string): Promise<void>;
}

interface StealthCacheEnvelope {
  kind: typeof RECORD_KIND;
  version: typeof RECORD_VERSION;
  revision: number;
  crypto: RawKeyEncryptedPayload;
}

let defaultDriver: StealthCacheDriver | null = null;

function driver(candidate?: StealthCacheDriver): StealthCacheDriver {
  defaultDriver ??= new IndexedDbEncryptedRecordDriver();
  return candidate ?? defaultDriver;
}

function safeIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateContext(context: PrivateBalanceStorageScope): void {
  for (const [name, value] of [
    ['networkId', context.networkId],
    ['realmId', context.realmId],
    ['poolId', context.poolId],
    ['deploymentBindingHash', context.deploymentBindingHash],
  ] as const) {
    if (!HEX_32.test(value)) throw new Error(`Stealth cache ${name} is invalid`);
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(context.accountId)) {
    throw new Error('Stealth cache account ID is invalid');
  }
}

export function stealthDiscoveryRecordKey(context: PrivateBalanceStorageScope): string {
  validateContext(context);
  return [
    CACHE_PREFIX,
    context.networkId,
    context.realmId,
    context.poolId,
    'stealth',
    context.accountId,
    context.deploymentBindingHash,
  ].join(':');
}

function aad(recordKey: string, revision: number): Uint8Array {
  return encoder.encode(`${RECORD_KIND}|${RECORD_VERSION}|${revision}|${recordKey}`);
}

function isEnvelope(value: unknown): value is StealthCacheEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const envelope = value as Partial<StealthCacheEnvelope>;
  return envelope.kind === RECORD_KIND &&
    envelope.version === RECORD_VERSION &&
    safeIndex(envelope.revision) &&
    Boolean(envelope.crypto) &&
    typeof envelope.crypto?.iv === 'string' &&
    envelope.crypto.iv.length > 0 &&
    typeof envelope.crypto?.ciphertext === 'string' &&
    envelope.crypto.ciphertext.length > 0;
}

function isPayment(value: unknown, lowerBound: number): value is StealthOwnedPayment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payment = value as Partial<StealthOwnedPayment>;
  return typeof payment.transactionHash === 'string' &&
    HEX_32.test(payment.transactionHash) &&
    typeof payment.pagingToken === 'string' &&
    POSITIVE_DECIMAL.test(payment.pagingToken) &&
    typeof payment.ephemeralPublicKey === 'string' &&
    HEX_32.test(payment.ephemeralPublicKey) &&
    typeof payment.destinationPublicKey === 'string' &&
    StrKey.isValidEd25519PublicKey(payment.destinationPublicKey) &&
    typeof payment.amountStroops === 'string' &&
    POSITIVE_DECIMAL.test(payment.amountStroops) &&
    safeIndex(payment.ledger) && payment.ledger > 0 &&
    timestamp(payment.createdAt) && payment.createdAt >= lowerBound &&
    ['unspent', 'sweeping', 'swept', 'ignored'].includes(payment.status ?? '') &&
    (payment.status === 'sweeping' || payment.status === 'swept'
      ? typeof payment.sweptTransactionHash === 'string' &&
        HEX_32.test(payment.sweptTransactionHash) &&
        typeof payment.sweepActionField === 'string' &&
        HEX_32.test(payment.sweepActionField)
      : payment.sweptTransactionHash === undefined && payment.sweepActionField === undefined);
}

function isCache(value: unknown): value is StealthDiscoveryCache {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const cache = value as Partial<StealthDiscoveryCache>;
  const lowerBoundCreatedAt = cache.lowerBoundCreatedAt;
  if (
    cache.schemaVersion !== 1 ||
    !safeIndex(cache.revision) ||
    !(cache.cursor === null || (typeof cache.cursor === 'string' && DECIMAL.test(cache.cursor))) ||
    !timestamp(lowerBoundCreatedAt) ||
    !safeIndex(cache.latestLedger) ||
    !Array.isArray(cache.payments) ||
    cache.payments.length > MAX_PAYMENTS ||
    !timestamp(cache.updatedAt) ||
    cache.updatedAt < lowerBoundCreatedAt ||
    !cache.payments.every(payment => isPayment(payment, lowerBoundCreatedAt))
  ) {
    return false;
  }
  const identities = new Set<string>();
  let previousToken = 0n;
  for (const payment of cache.payments) {
    const identity = `${payment.transactionHash}:${payment.destinationPublicKey}`;
    if (identities.has(identity)) return false;
    identities.add(identity);
    const token = BigInt(payment.pagingToken);
    if (token <= previousToken || payment.ledger > cache.latestLedger) return false;
    previousToken = token;
  }
  if (cache.cursor !== null && previousToken > BigInt(cache.cursor)) return false;
  return true;
}

function parseEnvelope(raw: string): StealthCacheEnvelope {
  if (encoder.encode(raw).byteLength > MAX_CACHE_RECORD_BYTES) {
    throw new Error('Stealth discovery cache exceeds its size limit');
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isEnvelope(parsed)) throw new Error('invalid envelope');
    return parsed;
  } catch {
    throw new Error('Stealth discovery cache could not be decrypted or authenticated.');
  }
}

export function createEmptyStealthDiscoveryCache(
  now: number,
  walletCreatedAt?: number,
): StealthDiscoveryCache {
  if (!timestamp(now)) throw new Error('Stealth discovery timestamp is invalid');
  if (walletCreatedAt !== undefined && !timestamp(walletCreatedAt)) {
    throw new Error('Wallet birthday timestamp is invalid');
  }
  const lowerBound = new Date(now);
  lowerBound.setUTCFullYear(lowerBound.getUTCFullYear() - 1);
  const recoveryFloor = Math.max(0, lowerBound.getTime());
  const walletBirthday = walletCreatedAt === undefined
    ? recoveryFloor
    : Math.min(now, walletCreatedAt);
  return {
    schemaVersion: 1,
    revision: 0,
    cursor: null,
    lowerBoundCreatedAt: Math.max(recoveryFloor, walletBirthday),
    latestLedger: 0,
    payments: [],
    updatedAt: now,
  };
}

export async function loadStealthDiscoveryCache(
  context: PrivateBalanceStorageScope,
  key: Uint8Array,
  candidate?: StealthCacheDriver,
): Promise<StealthDiscoveryCache | null> {
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throw new Error('Stealth discovery encryption key must be 32 bytes');
  }
  const recordKey = stealthDiscoveryRecordKey(context);
  const raw = await driver(candidate).read(recordKey);
  if (raw === null) return null;
  const envelope = parseEnvelope(raw);
  try {
    const plaintext = await decryptBytesWithKey(
      envelope.crypto,
      key,
      aad(recordKey, envelope.revision),
    );
    try {
      const decoded: unknown = JSON.parse(decoder.decode(plaintext));
      if (!isCache(decoded) || decoded.revision !== envelope.revision) {
        throw new Error('invalid cache');
      }
      return decoded;
    } finally {
      plaintext.fill(0);
    }
  } catch {
    throw new Error('Stealth discovery cache could not be decrypted or authenticated.');
  }
}

export async function commitStealthDiscoveryCache(
  context: PrivateBalanceStorageScope,
  key: Uint8Array,
  state: StealthDiscoveryCache,
  expectedRevision: number | null,
  candidate?: StealthCacheDriver,
): Promise<void> {
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throw new Error('Stealth discovery encryption key must be 32 bytes');
  }
  const requiredRevision = expectedRevision === null ? 0 : expectedRevision + 1;
  if (state.revision !== requiredRevision || !isCache(state)) {
    throw new Error('Stealth discovery cache schema or revision is invalid');
  }
  const recordKey = stealthDiscoveryRecordKey(context);
  const crypto = await encryptBytesWithKey(
    encoder.encode(JSON.stringify(state)),
    key,
    aad(recordKey, state.revision),
  );
  const envelope: StealthCacheEnvelope = {
    kind: RECORD_KIND,
    version: RECORD_VERSION,
    revision: state.revision,
    crypto,
  };
  const result = await driver(candidate).compareAndSet(
    recordKey,
    expectedRevision,
    JSON.stringify(envelope),
  );
  if (!result.ok) throw new Error('Stealth discovery cache changed in another wallet session.');
}

export function clearStealthDiscoveryCache(
  context: PrivateBalanceStorageScope,
  candidate?: StealthCacheDriver,
): Promise<void> {
  return driver(candidate).removePrefix(stealthDiscoveryRecordKey(context));
}

export interface StealthPaymentIdentity {
  transactionHash: string;
  destinationPublicKey: string;
}

export interface StealthSweepReference {
  transactionHash: string;
  actionField: string;
}

async function updateStealthDiscoveryCache(
  context: PrivateBalanceStorageScope,
  key: Uint8Array,
  mutate: (payments: StealthOwnedPayment[]) => StealthOwnedPayment[] | null,
  candidate: StealthCacheDriver | undefined,
  now: number,
): Promise<StealthDiscoveryCache> {
  if (!timestamp(now)) throw new Error('Stealth discovery timestamp is invalid');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await loadStealthDiscoveryCache(context, key, candidate);
    if (!current) throw new Error('Stealth discovery cache is unavailable. Check for payments again.');
    const payments = mutate(current.payments);
    if (payments === null) return current;
    const next: StealthDiscoveryCache = {
      ...current,
      revision: current.revision + 1,
      payments,
      updatedAt: Math.max(current.updatedAt, now),
    };
    try {
      await commitStealthDiscoveryCache(
        context,
        key,
        next,
        current.revision,
        candidate,
      );
      return next;
    } catch (error) {
      if (
        attempt === 3 ||
        !(error instanceof Error) ||
        !/another wallet session/i.test(error.message)
      ) {
        throw error;
      }
    }
  }
  throw new Error('Stealth discovery cache changed too many times. Try again.');
}

export function markStealthPaymentSweeping(
  context: PrivateBalanceStorageScope,
  key: Uint8Array,
  identity: StealthPaymentIdentity,
  sweep: StealthSweepReference,
  candidate?: StealthCacheDriver,
  now = Date.now(),
): Promise<StealthDiscoveryCache> {
  if (!HEX_32.test(sweep.transactionHash) || !HEX_32.test(sweep.actionField)) {
    return Promise.reject(new Error('Stealth sweep reference is invalid'));
  }
  return updateStealthDiscoveryCache(context, key, payments => {
    const index = payments.findIndex(payment =>
      payment.transactionHash === identity.transactionHash &&
      payment.destinationPublicKey === identity.destinationPublicKey);
    if (index < 0) throw new Error('Reusable private payment is no longer available.');
    const payment = payments[index];
    if (
      (payment.status === 'sweeping' || payment.status === 'swept') &&
      payment.sweptTransactionHash === sweep.transactionHash &&
      payment.sweepActionField === sweep.actionField
    ) {
      return null;
    }
    if (payment.status !== 'unspent') {
      throw new Error('Reusable private payment is already being moved or has been dismissed.');
    }
    const next = [...payments];
    next[index] = {
      ...payment,
      status: 'sweeping',
      sweptTransactionHash: sweep.transactionHash,
      sweepActionField: sweep.actionField,
    };
    return next;
  }, candidate, now);
}

export function reconcileStealthPaymentSweeps(
  context: PrivateBalanceStorageScope,
  key: Uint8Array,
  canonicalActionFields: ReadonlySet<string>,
  pendingActionFields: ReadonlySet<string>,
  candidate?: StealthCacheDriver,
  now = Date.now(),
): Promise<StealthDiscoveryCache> {
  return updateStealthDiscoveryCache(context, key, payments => {
    let changed = false;
    const next = payments.map(payment => {
      if (payment.status !== 'sweeping' || !payment.sweepActionField) return payment;
      if (canonicalActionFields.has(payment.sweepActionField)) {
        changed = true;
        return { ...payment, status: 'swept' as const };
      }
      if (pendingActionFields.has(payment.sweepActionField)) return payment;
      changed = true;
      const released: StealthOwnedPayment = { ...payment, status: 'unspent' };
      delete released.sweptTransactionHash;
      delete released.sweepActionField;
      return released;
    });
    return changed ? next : null;
  }, candidate, now);
}
