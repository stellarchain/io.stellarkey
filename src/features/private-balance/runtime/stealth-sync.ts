import {
  deriveStealthRecipientKey,
  type StealthMetaKeys,
  type StealthNetwork,
  type X25519Implementation,
} from '@stellarkey/private-balance';
import { StrKey } from '@stellar/stellar-sdk';
import {
  commitStealthDiscoveryCache,
  createEmptyStealthDiscoveryCache,
  loadStealthDiscoveryCache,
  type StealthCacheDriver,
  type StealthDiscoveryCache,
  type StealthOwnedPayment,
} from './stealth-cache';
import type { PrivateStorageContext } from './storage';

export const MAX_STEALTH_ANNOUNCEMENTS_PER_PAGE = 200;
export const MAX_STEALTH_DISCOVERY_PAGES = 1_000;

export interface StealthAnnouncement {
  pagingToken: string;
  transactionHash: string;
  ephemeralPublicKey: Uint8Array;
  destinationPublicKey: Uint8Array;
  amountStroops: string;
  ledger: number;
  createdAt: number;
}

export interface StealthAnnouncementPage {
  announcements: StealthAnnouncement[];
  nextCursor: string | null;
  latestLedger: number;
  hasMore: boolean;
}

export interface StealthAnnouncementReader {
  readPage(input: {
    cursor: string | null;
    lowerBoundCreatedAt: number;
    limit: number;
  }): Promise<StealthAnnouncementPage>;
}

export interface SyncStealthAnnouncementsInput {
  context: PrivateStorageContext;
  storageKey: Uint8Array;
  keys: StealthMetaKeys;
  network: StealthNetwork;
  reader: StealthAnnouncementReader;
  storageDriver?: StealthCacheDriver;
  implementation?: X25519Implementation;
  now?: () => number;
  lowerBoundCreatedAt?: number;
  onProgress?(progress: { pages: number; cursor: string | null; ownedPayments: number }): void;
}

const HEX_32 = /^[0-9a-f]{64}$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function safePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function validateAnnouncement(
  announcement: StealthAnnouncement,
  lowerBoundCreatedAt: number,
): void {
  if (!POSITIVE_DECIMAL.test(announcement.pagingToken)) {
    throw new Error('Stealth announcement paging token is invalid');
  }
  if (!HEX_32.test(announcement.transactionHash)) {
    throw new Error('Stealth announcement transaction hash is invalid');
  }
  if (!(announcement.ephemeralPublicKey instanceof Uint8Array) || announcement.ephemeralPublicKey.length !== 32) {
    throw new Error('Stealth announcement ephemeral key is invalid');
  }
  if (!(announcement.destinationPublicKey instanceof Uint8Array) || announcement.destinationPublicKey.length !== 32) {
    throw new Error('Stealth announcement destination is invalid');
  }
  if (!POSITIVE_DECIMAL.test(announcement.amountStroops)) {
    throw new Error('Stealth announcement amount is invalid');
  }
  if (!safePositiveInteger(announcement.ledger)) {
    throw new Error('Stealth announcement ledger is invalid');
  }
  if (!timestamp(announcement.createdAt) || announcement.createdAt < lowerBoundCreatedAt) {
    throw new Error('Stealth announcement timestamp is outside the discovery window');
  }
}

function validatePage(
  page: StealthAnnouncementPage,
  state: StealthDiscoveryCache,
): void {
  if (!Array.isArray(page.announcements) || page.announcements.length > MAX_STEALTH_ANNOUNCEMENTS_PER_PAGE) {
    throw new Error('Stealth announcement page exceeds its record limit');
  }
  if (!(page.nextCursor === null || POSITIVE_DECIMAL.test(page.nextCursor))) {
    throw new Error('Stealth announcement page cursor is invalid');
  }
  if (!Number.isSafeInteger(page.latestLedger) || page.latestLedger < state.latestLedger) {
    throw new Error('Stealth announcement ledger moved behind the verified cache');
  }
  if (typeof page.hasMore !== 'boolean') throw new Error('Stealth announcement page continuation is invalid');

  let previous = state.cursor === null ? 0n : BigInt(state.cursor);
  for (const announcement of page.announcements) {
    validateAnnouncement(announcement, state.lowerBoundCreatedAt);
    const token = BigInt(announcement.pagingToken);
    if (token <= previous) throw new Error('Stealth announcements are not strictly ordered');
    if (announcement.ledger > page.latestLedger) {
      throw new Error('Stealth announcement is ahead of the page ledger');
    }
    previous = token;
  }
  if (
    page.announcements.length > 0 &&
    (page.nextCursor === null || BigInt(page.nextCursor) < BigInt(page.announcements.at(-1)!.pagingToken))
  ) {
    throw new Error('Stealth announcement page cursor precedes its final verified record');
  }
  if (page.nextCursor !== null && state.cursor !== null && BigInt(page.nextCursor) < BigInt(state.cursor)) {
    throw new Error('Stealth announcement page cursor moved backwards');
  }
  if (page.hasMore && (page.announcements.length === 0 || page.nextCursor === state.cursor)) {
    throw new Error('Stealth announcement page cannot make forward progress');
  }
}

async function ownedPayment(
  announcement: StealthAnnouncement,
  input: SyncStealthAnnouncementsInput,
): Promise<StealthOwnedPayment | null> {
  let recovered: Awaited<ReturnType<typeof deriveStealthRecipientKey>>;
  try {
    recovered = await deriveStealthRecipientKey(
      input.keys,
      announcement.ephemeralPublicKey,
      input.network,
      input.implementation,
    );
  } catch {
    // The announcement account is public and can be spammed. Invalid or
    // low-order ephemeral keys must not poison the durable cursor.
    return null;
  }
  if (!equalBytes(recovered.publicKey, announcement.destinationPublicKey)) return null;
  return {
    transactionHash: announcement.transactionHash,
    pagingToken: announcement.pagingToken,
    ephemeralPublicKey: hex(announcement.ephemeralPublicKey),
    destinationPublicKey: StrKey.encodeEd25519PublicKey(announcement.destinationPublicKey),
    amountStroops: announcement.amountStroops,
    ledger: announcement.ledger,
    createdAt: announcement.createdAt,
    status: 'unspent',
  };
}

export async function syncStealthAnnouncements(
  input: SyncStealthAnnouncementsInput,
): Promise<StealthDiscoveryCache> {
  const now = input.now?.() ?? Date.now();
  if (!timestamp(now)) throw new Error('Stealth discovery clock is invalid');
  const persisted = await loadStealthDiscoveryCache(
    input.context,
    input.storageKey,
    input.storageDriver,
  );
  let expectedRevision = persisted?.revision ?? null;
  let state = persisted ?? createEmptyStealthDiscoveryCache(now, input.lowerBoundCreatedAt);
  const existing = new Set(
    state.payments.map(payment => `${payment.transactionHash}:${payment.destinationPublicKey}`),
  );

  for (let pageIndex = 0; pageIndex < MAX_STEALTH_DISCOVERY_PAGES; pageIndex += 1) {
    const page = await input.reader.readPage({
      cursor: state.cursor,
      lowerBoundCreatedAt: state.lowerBoundCreatedAt,
      limit: MAX_STEALTH_ANNOUNCEMENTS_PER_PAGE,
    });
    validatePage(page, state);

    const additions: StealthOwnedPayment[] = [];
    for (const announcement of page.announcements) {
      const payment = await ownedPayment(announcement, input);
      if (!payment) continue;
      const identity = `${payment.transactionHash}:${payment.destinationPublicKey}`;
      if (existing.has(identity)) continue;
      existing.add(identity);
      additions.push(payment);
    }

    const nextState: StealthDiscoveryCache = {
      ...state,
      revision: expectedRevision === null ? 0 : expectedRevision + 1,
      cursor: page.nextCursor,
      latestLedger: page.latestLedger,
      payments: [...state.payments, ...additions],
      updatedAt: now,
    };
    await commitStealthDiscoveryCache(
      input.context,
      input.storageKey,
      nextState,
      expectedRevision,
      input.storageDriver,
    );
    state = nextState;
    expectedRevision = state.revision;
    input.onProgress?.({
      pages: pageIndex + 1,
      cursor: state.cursor,
      ownedPayments: state.payments.length,
    });
    if (!page.hasMore) return state;
  }
  throw new Error('Stealth discovery exceeded its page safety limit');
}
