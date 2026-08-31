import { decryptBytesWithKey, encryptBytesWithKey, type RawKeyEncryptedPayload } from '../../../lib/crypto';
import { IndexedDbEncryptedRecordDriver } from '../../../lib/indexed-db';
import {
  privateBalanceSensitivePrefix,
  privateBalanceStateRecordKey,
  type PrivateBalanceStorageScope,
} from '../../../lib/private-balance-bootstrap';
import type {
  PrivateBalanceDurableState,
  PrivateBuildReservation,
  PrivateChainedApproval,
  PrivatePendingAction,
  PrivateRecentRecipient,
  ShieldedActivityRecord,
  ShieldedCheckpoint,
  ShieldedNoteRecord,
} from './types';

const RECORD_KIND = 'stellarkey-private-balance-state';
const RECORD_VERSION = 1;
const PRIVATE_ADDRESS_PATTERN = /^(?:tks1|sks1)[02-9ac-hj-np-z]{115}$/;
const RECIPIENT_FINGERPRINT_PATTERN = /^[0-9A-F]{4} [0-9A-F]{4}$/;
export const MAX_RECENT_PRIVATE_RECIPIENTS = 5;
export const PRIVATE_BUILD_RESERVATION_TTL_MS = 10 * 60_000;
// Must exceed the 15-minute chained approval window so a live chain's
// prepared or reviewed step is never swept out from under its driver.
export const PRIVATE_PENDING_ACTION_PRE_BROADCAST_TTL_MS = 16 * 60_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type PrivateStorageContext = PrivateBalanceStorageScope;

export interface PrivateRecordDriver {
  read(key: string): Promise<string | null>;
  compareAndSet(
    key: string,
    expectedRevision: number | null,
    value: string,
  ): Promise<{ ok: boolean; current: string | null }>;
  removePrefix(prefix: string): Promise<void>;
}

interface PrivateRecordEnvelope {
  kind: typeof RECORD_KIND;
  version: typeof RECORD_VERSION;
  revision: number;
  crypto: RawKeyEncryptedPayload;
}

let defaultDriver: PrivateRecordDriver | null = null;

function driver(candidate?: PrivateRecordDriver): PrivateRecordDriver {
  defaultDriver ??= new IndexedDbEncryptedRecordDriver();
  return candidate ?? defaultDriver;
}

function isHex(value: unknown, bytes: number): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isSafeIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validateContext(context: PrivateStorageContext): void {
  for (const [name, value] of [
    ['networkId', context.networkId],
    ['realmId', context.realmId],
    ['poolId', context.poolId],
    ['deploymentBindingHash', context.deploymentBindingHash],
  ] as const) {
    if (!isHex(value, 32)) throw new Error(`${name} must be 32-byte lowercase hex`);
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(context.accountId)) throw new Error('accountId is invalid');
}

function aad(key: string, revision: number): Uint8Array {
  return encoder.encode(`${RECORD_KIND}|${RECORD_VERSION}|${revision}|${key}`);
}

function isEnvelope(value: unknown): value is PrivateRecordEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const envelope = value as Partial<PrivateRecordEnvelope>;
  return (
    envelope.kind === RECORD_KIND &&
    envelope.version === RECORD_VERSION &&
    isSafeIndex(envelope.revision) &&
    Boolean(envelope.crypto) &&
    typeof envelope.crypto?.iv === 'string' &&
    envelope.crypto.iv.length > 0 &&
    typeof envelope.crypto?.ciphertext === 'string' &&
    envelope.crypto.ciphertext.length > 0
  );
}

async function encryptRecord(
  value: PrivateBalanceDurableState,
  key: Uint8Array,
  recordKey: string,
): Promise<string> {
  const crypto = await encryptBytesWithKey(
    encoder.encode(JSON.stringify(value)),
    key,
    aad(recordKey, value.revision),
  );
  return JSON.stringify({
    kind: RECORD_KIND,
    version: RECORD_VERSION,
    revision: value.revision,
    crypto,
  } satisfies PrivateRecordEnvelope);
}

async function decryptRecord(
  raw: string,
  key: Uint8Array,
  recordKey: string,
): Promise<unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isEnvelope(parsed)) throw new Error('invalid envelope');
    const plaintext = await decryptBytesWithKey(
      parsed.crypto,
      key,
      aad(recordKey, parsed.revision),
    );
    try {
      const decoded = JSON.parse(decoder.decode(plaintext)) as { revision?: unknown };
      if (decoded.revision !== parsed.revision) throw new Error('revision mismatch');
      return decoded;
    } finally {
      plaintext.fill(0);
    }
  } catch {
    throw new Error('Private Balance state could not be decrypted or authenticated.');
  }
}

function isNote(value: unknown): value is ShieldedNoteRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const note = value as Partial<ShieldedNoteRecord>;
  const statusValid = ['unspent', 'reserved', 'spent'].includes(note.status ?? '');
  const reservationValid = note.status === 'reserved'
    ? isTimestamp(note.reservedAt)
    : note.reservedAt === undefined;
  const spentValid = note.status === 'spent'
    ? isSafeIndex(note.spentInActionIndex)
    : note.spentInActionIndex === undefined;
  return (
    isHex(note.id, 32) &&
    note.commitment === note.id &&
    typeof note.value === 'string' &&
    /^[1-9][0-9]*$/.test(note.value) &&
    typeof note.assetContractId === 'string' &&
    /^C[A-Z2-7]{55}$/.test(note.assetContractId) &&
    isHex(note.diversifier, 4) &&
    isHex(note.ownerCommitment, 32) &&
    isSafeIndex(note.leafIndex) &&
    isSafeIndex(note.actionIndex) &&
    isHex(note.rho, 32) &&
    typeof note.memoHex === 'string' &&
    /^(?:[0-9a-f]{2})*$/.test(note.memoHex) &&
    note.memoHex.length <= 64 &&
    typeof note.senderFingerprintHex === 'string' &&
    /^(?:[0-9a-f]{2})*$/.test(note.senderFingerprintHex) &&
    statusValid &&
    reservationValid &&
    spentValid &&
    isTimestamp(note.createdAt)
  );
}

function isActivity(value: unknown): value is ShieldedActivityRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const activity = value as Partial<ShieldedActivityRecord>;
  return (
    isHex(activity.id, 32) &&
    isSafeIndex(activity.actionIndex) &&
    ['deposit', 'transfer', 'withdraw'].includes(activity.actionKind ?? '') &&
    typeof activity.assetContractId === 'string' &&
    /^C[A-Z2-7]{55}$/.test(activity.assetContractId) &&
    typeof activity.amount === 'string' &&
    /^(?:0|[1-9][0-9]*)$/.test(activity.amount) &&
    ['inflow', 'outflow', 'internal'].includes(activity.direction ?? '') &&
    isTimestamp(activity.timestamp) &&
    Array.isArray(activity.nullifiers) &&
    activity.nullifiers.every(item => isHex(item, 32)) &&
    Array.isArray(activity.outputCommitments) &&
    activity.outputCommitments.every(item => isHex(item, 32)) &&
    (activity.transactionHash === undefined || isHex(activity.transactionHash, 32)) &&
    (activity.recipientFingerprint === undefined || /^[0-9A-F]{4} [0-9A-F]{4}$/.test(activity.recipientFingerprint)) &&
    (activity.memoHex === undefined || /^(?:[0-9a-f]{2}){1,32}$/.test(activity.memoHex)) &&
    (activity.actionKind === 'transfer' || (
      activity.recipientFingerprint === undefined && activity.memoHex === undefined
    ))
  );
}

function isCheckpoint(value: unknown): value is ShieldedCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const checkpoint = value as Partial<ShieldedCheckpoint>;
  return (
    isSafeIndex(checkpoint.lastActionIndex) &&
    isHex(checkpoint.lastRecordHash, 32) &&
    isHex(checkpoint.treeRoot, 32) &&
    Array.isArray(checkpoint.treeFrontier) &&
    checkpoint.treeFrontier.length === 32 &&
    checkpoint.treeFrontier.every(item => isHex(item, 32)) &&
    isHex(checkpoint.deploymentBindingHash, 32) &&
    isHex(checkpoint.manifestHash, 32) &&
    isSafeIndex(checkpoint.latestLedger) &&
    isTimestamp(checkpoint.updatedAt)
  );
}

function isPendingAction(value: unknown): value is PrivatePendingAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const action = value as Partial<PrivatePendingAction>;
  return (
    typeof action.id === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(action.id) &&
    ['deposit', 'transfer', 'withdraw'].includes(action.kind ?? '') &&
    typeof action.assetContractId === 'string' &&
    /^C[A-Z2-7]{55}$/.test(action.assetContractId) &&
    ['prepared', 'reviewed', 'signed', 'broadcast', 'ambiguous'].includes(action.status ?? '') &&
    Array.isArray(action.reservedNoteIds) &&
    (action.kind === 'deposit'
      ? action.reservedNoteIds.length === 0
      : action.reservedNoteIds.length >= 1 && action.reservedNoteIds.length <= 2) &&
    action.reservedNoteIds.every(id => isHex(id, 32)) &&
    new Set(action.reservedNoteIds).size === action.reservedNoteIds.length &&
    isHex(action.actionField, 32) &&
    Array.isArray(action.nullifiers) &&
    action.nullifiers.length === 2 &&
    action.nullifiers.every(item => isHex(item, 32)) &&
    Array.isArray(action.outputCommitments) &&
    action.outputCommitments.length === 2 &&
    action.outputCommitments.every(item => isHex(item, 32)) &&
    isHex(action.anchorRoot, 32) &&
    isSafeIndex(action.anchorExpiresAtLedger) &&
    isHex(action.proofHash, 32) &&
    typeof action.classicFeeCapStroops === 'string' &&
    /^(?:0|[1-9][0-9]*)$/.test(action.classicFeeCapStroops) &&
    typeof action.resourceFeeCapStroops === 'string' &&
    /^(?:0|[1-9][0-9]*)$/.test(action.resourceFeeCapStroops) &&
    (action.amountStroops === undefined || (
      typeof action.amountStroops === 'string' && /^(?:0|[1-9][0-9]*)$/.test(action.amountStroops)
    )) &&
    (action.changeValueStroops === undefined || (
      typeof action.changeValueStroops === 'string' && /^(?:0|[1-9][0-9]*)$/.test(action.changeValueStroops)
    )) &&
    (action.expiresAtSeconds === undefined || isSafeIndex(action.expiresAtSeconds)) &&
    (action.transactionHash === undefined || isHex(action.transactionHash, 32)) &&
    (action.signedEnvelopeXdr === undefined || (
      typeof action.signedEnvelopeXdr === 'string' &&
      action.signedEnvelopeXdr.length > 0 &&
      action.signedEnvelopeXdr.length <= 256 * 1024 &&
      action.signedEnvelopeXdr.length % 4 === 0 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(action.signedEnvelopeXdr)
    )) &&
    isSafeIndex(action.broadcastAttempts) &&
    (action.latestRpcStatus === undefined || [
      'PENDING',
      'DUPLICATE',
      'TRY_AGAIN_LATER',
      'ERROR',
      'SUCCESS',
      'FAILED',
      'NOT_FOUND',
      'UNAVAILABLE',
    ].includes(action.latestRpcStatus)) &&
    (action.lastBroadcastAt === undefined || isTimestamp(action.lastBroadcastAt)) &&
    (action.journalId === undefined || (
      typeof action.journalId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(action.journalId)
    )) &&
    (action.recipientFingerprint === undefined || /^[0-9A-F]{4} [0-9A-F]{4}$/.test(action.recipientFingerprint)) &&
    (action.memoHex === undefined || /^(?:[0-9a-f]{2}){1,32}$/.test(action.memoHex)) &&
    (action.kind === 'transfer' || (
      action.recipientFingerprint === undefined && action.memoHex === undefined
    )) &&
    isTimestamp(action.createdAt) &&
    isTimestamp(action.updatedAt) &&
    pendingActionStatusFieldsAreValid(action)
  );
}

function isBuildReservation(value: unknown): value is PrivateBuildReservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const reservation = value as Partial<PrivateBuildReservation>;
  return (
    typeof reservation.id === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(reservation.id) &&
    ['deposit', 'transfer', 'withdraw'].includes(reservation.kind ?? '') &&
    typeof reservation.assetContractId === 'string' &&
    /^C[A-Z2-7]{55}$/.test(reservation.assetContractId) &&
    Array.isArray(reservation.reservedNoteIds) &&
    (reservation.kind === 'deposit'
      ? reservation.reservedNoteIds.length === 0
      : reservation.reservedNoteIds.length >= 1 && reservation.reservedNoteIds.length <= 2) &&
    reservation.reservedNoteIds.every(id => isHex(id, 32)) &&
    new Set(reservation.reservedNoteIds).size === reservation.reservedNoteIds.length &&
    isTimestamp(reservation.createdAt) &&
    isTimestamp(reservation.updatedAt) &&
    reservation.updatedAt >= reservation.createdAt
  );
}

function pendingActionStatusFieldsAreValid(action: Partial<PrivatePendingAction>): boolean {
  if (action.updatedAt! < action.createdAt!) return false;
  if (action.status === 'prepared') {
    return action.transactionHash === undefined && action.signedEnvelopeXdr === undefined &&
      action.expiresAtSeconds === undefined &&
      action.broadcastAttempts === 0 && action.latestRpcStatus === undefined && action.lastBroadcastAt === undefined;
  }
  if (!isHex(action.transactionHash, 32)) return false;
  if (action.status === 'reviewed') {
    return action.signedEnvelopeXdr === undefined && action.expiresAtSeconds === undefined &&
      action.broadcastAttempts === 0 &&
      action.latestRpcStatus === undefined && action.lastBroadcastAt === undefined;
  }
  if (typeof action.signedEnvelopeXdr !== 'string') return false;
  if (action.status === 'signed') {
    return action.broadcastAttempts === 0 && action.latestRpcStatus === undefined && action.lastBroadcastAt === undefined;
  }
  return (action.broadcastAttempts ?? 0) >= 1 && typeof action.latestRpcStatus === 'string' &&
    isTimestamp(action.lastBroadcastAt);
}

function isChainedApproval(value: unknown): value is PrivateChainedApproval {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const approval = value as Partial<PrivateChainedApproval>;
  const stroops = (candidate: unknown): candidate is string =>
    typeof candidate === 'string' && /^(?:0|[1-9][0-9]*)$/.test(candidate);
  return (
    typeof approval.id === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(approval.id) &&
    Number.isSafeInteger(approval.steps) &&
    (approval.steps as number) >= 2 &&
    (approval.steps as number) <= 64 &&
    stroops(approval.perStepMaxFeeStroops) &&
    stroops(approval.cumulativeMaxFeeStroops) &&
    stroops(approval.accumulatedFeeStroops) &&
    BigInt(approval.accumulatedFeeStroops) <= BigInt(approval.cumulativeMaxFeeStroops) &&
    isSafeIndex(approval.expiresAtSeconds) &&
    isTimestamp(approval.createdAt) &&
    isTimestamp(approval.updatedAt) &&
    approval.updatedAt! >= approval.createdAt!
  );
}

function isRecentRecipient(value: unknown): value is PrivateRecentRecipient {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const recipient = value as Partial<PrivateRecentRecipient>;
  return (
    typeof recipient.address === 'string' &&
    PRIVATE_ADDRESS_PATTERN.test(recipient.address) &&
    typeof recipient.fingerprint === 'string' &&
    RECIPIENT_FINGERPRINT_PATTERN.test(recipient.fingerprint) &&
    isTimestamp(recipient.lastUsedAt)
  );
}

function isDurableState(
  value: unknown,
  context: PrivateStorageContext,
): value is PrivateBalanceDurableState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Partial<PrivateBalanceDurableState>;
  if (
    state.schemaVersion !== 1 ||
    !isSafeIndex(state.revision) ||
    !isHex(state.lastValidatedManifestHash, 32) ||
    !state.account ||
    !['not-configured', 'ready'].includes(state.account.setupState) ||
    !['never', 'syncing', 'current', 'safe-error'].includes(state.account.syncStatus) ||
    !(state.account.lastVerifiedActionIndex === null || isSafeIndex(state.account.lastVerifiedActionIndex)) ||
    !isTimestamp(state.account.updatedAt) ||
    !(state.privateAddress === undefined || PRIVATE_ADDRESS_PATTERN.test(state.privateAddress)) ||
    !(state.recentPrivateRecipients === undefined || (
      Array.isArray(state.recentPrivateRecipients) &&
      state.recentPrivateRecipients.length <= MAX_RECENT_PRIVATE_RECIPIENTS &&
      state.recentPrivateRecipients.every(isRecentRecipient) &&
      new Set(state.recentPrivateRecipients.map(recipient => recipient.address)).size ===
        state.recentPrivateRecipients.length
    )) ||
    !(state.chainedApproval === undefined || isChainedApproval(state.chainedApproval)) ||
    !Array.isArray(state.notes) ||
    !state.notes.every(isNote) ||
    new Set(state.notes.map(note => note.id)).size !== state.notes.length ||
    !Array.isArray(state.activities) ||
    !state.activities.every(isActivity) ||
    new Set(state.activities.map(activity => activity.id)).size !== state.activities.length ||
    !(state.checkpoint === null || isCheckpoint(state.checkpoint)) ||
    !Array.isArray(state.buildReservations) ||
    !state.buildReservations.every(isBuildReservation) ||
    new Set(state.buildReservations.map(reservation => reservation.id)).size !== state.buildReservations.length ||
    !Array.isArray(state.pendingActions) ||
    !state.pendingActions.every(isPendingAction) ||
    new Set(state.pendingActions.map(action => action.id)).size !== state.pendingActions.length
  ) {
    return false;
  }
  if (state.checkpoint && state.checkpoint.deploymentBindingHash !== context.deploymentBindingHash) {
    return false;
  }

  const referencedReservations = new Map<string, string>();
  const reservationIds = new Set<string>();
  for (const reservation of state.buildReservations) {
    if (reservationIds.has(reservation.id)) return false;
    reservationIds.add(reservation.id);
    for (const noteId of reservation.reservedNoteIds) {
      if (referencedReservations.has(noteId)) return false;
      referencedReservations.set(noteId, reservation.id);
    }
  }
  for (const action of state.pendingActions) {
    if (reservationIds.has(action.id)) return false;
    reservationIds.add(action.id);
    for (const noteId of action.reservedNoteIds) {
      if (referencedReservations.has(noteId)) return false;
      referencedReservations.set(noteId, action.id);
    }
  }
  const notes = state.notes;
  for (const note of notes) {
    if ((note.status === 'reserved') !== referencedReservations.has(note.id)) return false;
  }
  return [...referencedReservations].every(([noteId]) =>
    notes.some(note => note.id === noteId && note.status === 'reserved'));
}

export function createEmptyPrivateBalanceState(
  lastValidatedManifestHash: string,
  now = Date.now(),
): PrivateBalanceDurableState {
  if (!isHex(lastValidatedManifestHash, 32)) throw new Error('Manifest hash must be 32-byte lowercase hex');
  if (!isTimestamp(now)) throw new Error('State timestamp is invalid');
  return {
    schemaVersion: 1,
    revision: 0,
    lastValidatedManifestHash,
    account: {
      setupState: 'not-configured',
      syncStatus: 'never',
      lastVerifiedActionIndex: null,
      updatedAt: now,
    },
    notes: [],
    activities: [],
    checkpoint: null,
    buildReservations: [],
    pendingActions: [],
  };
}

export async function reservePrivateBuildReservation(
  context: PrivateStorageContext,
  key: Uint8Array,
  expectedRevision: number,
  reservation: PrivateBuildReservation,
  candidate?: PrivateRecordDriver,
): Promise<PrivateBalanceDurableState> {
  if (!isBuildReservation(reservation)) {
    throw new Error('Private Balance build reservation is invalid.');
  }
  const current = await loadPrivateBalanceState(context, key, candidate);
  if (!current || current.revision !== expectedRevision) {
    throw new Error('Private Balance state changed in another wallet session.');
  }
  if (
    current.buildReservations.some(item => item.id === reservation.id) ||
    current.pendingActions.some(action => action.id === reservation.id)
  ) {
    throw new Error('Private Balance reservation already exists.');
  }
  const reservationIds = new Set(reservation.reservedNoteIds);
  const notes = current.notes.map(note => {
    if (!reservationIds.has(note.id)) return { ...note };
    if (note.status !== 'unspent') throw new Error('Private Balance note is not available.');
    reservationIds.delete(note.id);
    return { ...note, status: 'reserved' as const, reservedAt: reservation.createdAt };
  });
  if (reservationIds.size > 0) throw new Error('Private Balance note does not exist.');
  const next: PrivateBalanceDurableState = {
    ...current,
    revision: current.revision + 1,
    notes,
    buildReservations: [...current.buildReservations, { ...reservation }],
  };
  await commitPrivateBalanceState(context, key, next, current.revision, candidate);
  return next;
}

export async function commitPrivateBuildReservation(
  context: PrivateStorageContext,
  key: Uint8Array,
  expectedRevision: number,
  reservationId: string,
  pendingAction: PrivatePendingAction,
  candidate?: PrivateRecordDriver,
): Promise<PrivateBalanceDurableState> {
  if (pendingAction.status !== 'prepared' || !isPendingAction(pendingAction)) {
    throw new Error('Private Balance pending action is invalid.');
  }
  const current = await loadPrivateBalanceState(context, key, candidate);
  if (!current || current.revision !== expectedRevision) {
    throw new Error('Private Balance state changed in another wallet session.');
  }
  const reservation = current.buildReservations.find(item => item.id === reservationId);
  if (!reservation) throw new Error('Private Balance build reservation does not exist.');
  if (
    pendingAction.id !== reservation.id ||
    pendingAction.kind !== reservation.kind ||
    pendingAction.createdAt !== reservation.createdAt ||
    pendingAction.updatedAt < reservation.updatedAt ||
    pendingAction.reservedNoteIds.length !== reservation.reservedNoteIds.length ||
    pendingAction.reservedNoteIds.some((id, index) => id !== reservation.reservedNoteIds[index])
  ) {
    throw new Error('Private Balance pending action does not match its build reservation.');
  }
  if (current.pendingActions.some(action => action.id === pendingAction.id)) {
    throw new Error('Private Balance pending action already exists.');
  }
  const next: PrivateBalanceDurableState = {
    ...current,
    revision: current.revision + 1,
    buildReservations: current.buildReservations.filter(item => item.id !== reservationId),
    pendingActions: [...current.pendingActions, { ...pendingAction }],
  };
  await commitPrivateBalanceState(context, key, next, current.revision, candidate);
  return next;
}

export async function releasePrivateBuildReservation(
  context: PrivateStorageContext,
  key: Uint8Array,
  expectedRevision: number,
  reservationId: string,
  updatedAt: number,
  candidate?: PrivateRecordDriver,
): Promise<PrivateBalanceDurableState> {
  const current = await loadPrivateBalanceState(context, key, candidate);
  if (!current || current.revision !== expectedRevision) {
    throw new Error('Private Balance state changed in another wallet session.');
  }
  const reservation = current.buildReservations.find(item => item.id === reservationId);
  if (!reservation) throw new Error('Private Balance build reservation does not exist.');
  if (!isTimestamp(updatedAt) || updatedAt < reservation.updatedAt) {
    throw new Error('Private Balance build reservation timestamp is invalid.');
  }
  const reserved = new Set(reservation.reservedNoteIds);
  const next: PrivateBalanceDurableState = {
    ...current,
    revision: current.revision + 1,
    notes: current.notes.map(note => reserved.has(note.id)
      ? { ...note, status: 'unspent' as const, reservedAt: undefined }
      : { ...note }),
    buildReservations: current.buildReservations.filter(item => item.id !== reservationId),
  };
  await commitPrivateBalanceState(context, key, next, current.revision, candidate);
  return next;
}

/**
 * Releases every build reservation past the TTL in one commit. Reservations
 * are pre-proof by construction — the only path to signed/broadcast deletes
 * the reservation atomically — so an expired one was provably never sent.
 */
export async function releaseExpiredPrivateBuildReservations(
  context: PrivateStorageContext,
  key: Uint8Array,
  now: number,
  ttlMilliseconds = PRIVATE_BUILD_RESERVATION_TTL_MS,
  candidate?: PrivateRecordDriver,
): Promise<PrivateBalanceDurableState | null> {
  if (!isTimestamp(now)) throw new Error('Private Balance reservation cleanup timestamp is invalid.');
  const current = await loadPrivateBalanceState(context, key, candidate);
  if (!current) return null;
  const expired = current.buildReservations.filter(
    reservation => now - reservation.createdAt >= ttlMilliseconds,
  );
  if (expired.length === 0) return current;
  const released = new Set(expired.flatMap(reservation => reservation.reservedNoteIds));
  const expiredIds = new Set(expired.map(reservation => reservation.id));
  const next: PrivateBalanceDurableState = {
    ...current,
    revision: current.revision + 1,
    notes: current.notes.map(note => released.has(note.id)
      ? { ...note, status: 'unspent' as const, reservedAt: undefined }
      : { ...note }),
    buildReservations: current.buildReservations.filter(item => !expiredIds.has(item.id)),
  };
  await commitPrivateBalanceState(context, key, next, current.revision, candidate);
  return next;
}

/**
 * Releases every stale pre-broadcast pending action in one commit, using the
 * exact pre-broadcast-rejection guard: status 'prepared' or 'reviewed' with
 * zero broadcast attempts was provably never signed or sent. A tab closed or
 * locked mid-review, or a chain that died between preparing a step and
 * advancing its fee, leaves such an orphan holding reserved notes; past the
 * TTL it only locks value, so the leader sync sweeps it.
 */
export async function releaseStalePrivatePendingActions(
  context: PrivateStorageContext,
  key: Uint8Array,
  now: number,
  ttlMilliseconds = PRIVATE_PENDING_ACTION_PRE_BROADCAST_TTL_MS,
  candidate?: PrivateRecordDriver,
): Promise<PrivateBalanceDurableState | null> {
  if (!isTimestamp(now)) {
    throw new Error('Private Balance pending action cleanup timestamp is invalid.');
  }
  const current = await loadPrivateBalanceState(context, key, candidate);
  if (!current) return null;
  const stale = current.pendingActions.filter(action =>
    ['prepared', 'reviewed'].includes(action.status) &&
    action.broadcastAttempts === 0 &&
    now - action.updatedAt >= ttlMilliseconds);
  if (stale.length === 0) return current;
  const released = new Set(stale.flatMap(action => action.reservedNoteIds));
  const staleIds = new Set(stale.map(action => action.id));
  const next: PrivateBalanceDurableState = {
    ...current,
    revision: current.revision + 1,
    notes: current.notes.map(note => released.has(note.id)
      ? { ...note, status: 'unspent' as const, reservedAt: undefined }
      : { ...note }),
    pendingActions: current.pendingActions.filter(action => !staleIds.has(action.id)),
  };
  await commitPrivateBalanceState(context, key, next, current.revision, candidate);
  return next;
}

export async function recordPrivateBalanceAddress(
  context: PrivateStorageContext,
  key: Uint8Array,
  expectedRevision: number,
  privateAddress: string,
  candidate?: PrivateRecordDriver,
): Promise<PrivateBalanceDurableState> {
  if (!PRIVATE_ADDRESS_PATTERN.test(privateAddress)) {
    throw new Error('Private Balance address is invalid.');
  }
  const current = await loadPrivateBalanceState(context, key, candidate);
  if (!current || current.revision !== expectedRevision) {
    throw new Error('Private Balance state changed in another wallet session.');
  }
  if (current.privateAddress === privateAddress) return current;
  const next: PrivateBalanceDurableState = {
    ...current,
    revision: current.revision + 1,
    privateAddress,
  };
  await commitPrivateBalanceState(context, key, next, current.revision, candidate);
  return next;
}

export async function recordPrivateRecentRecipient(
  context: PrivateStorageContext,
  key: Uint8Array,
  expectedRevision: number,
  recipient: PrivateRecentRecipient,
  candidate?: PrivateRecordDriver,
): Promise<PrivateBalanceDurableState> {
  if (!isRecentRecipient(recipient)) {
    throw new Error('Private Balance recent recipient is invalid.');
  }
  const current = await loadPrivateBalanceState(context, key, candidate);
  if (!current || current.revision !== expectedRevision) {
    throw new Error('Private Balance state changed in another wallet session.');
  }
  const others = (current.recentPrivateRecipients ?? []).filter(
    item => item.address !== recipient.address,
  );
  const next: PrivateBalanceDurableState = {
    ...current,
    revision: current.revision + 1,
    recentPrivateRecipients: [{ ...recipient }, ...others].slice(0, MAX_RECENT_PRIVATE_RECIPIENTS),
  };
  await commitPrivateBalanceState(context, key, next, current.revision, candidate);
  return next;
}

export async function loadPrivateBalanceState(
  context: PrivateStorageContext,
  key: Uint8Array,
  candidate?: PrivateRecordDriver,
): Promise<PrivateBalanceDurableState | null> {
  validateContext(context);
  const recordKey = privateBalanceStateRecordKey(context);
  const raw = await driver(candidate).read(recordKey);
  if (raw === null) return null;
  const decoded = await decryptRecord(raw, key, recordKey);
  if (!isDurableState(decoded, context)) {
    throw new Error('Private Balance state schema is invalid.');
  }
  return decoded;
}

export async function commitPrivateBalanceState(
  context: PrivateStorageContext,
  key: Uint8Array,
  state: PrivateBalanceDurableState,
  expectedRevision: number | null,
  candidate?: PrivateRecordDriver,
): Promise<void> {
  const requiredRevision = expectedRevision === null ? 0 : expectedRevision + 1;
  if (state.revision !== requiredRevision || !isDurableState(state, context)) {
    throw new Error('Private Balance state schema or revision is invalid.');
  }
  validateContext(context);
  const recordKey = privateBalanceStateRecordKey(context);
  const encrypted = await encryptRecord(state, key, recordKey);
  const result = await driver(candidate).compareAndSet(recordKey, expectedRevision, encrypted);
  if (!result.ok) throw new Error('Private Balance state changed in another wallet session.');
}

/**
 * Journals the one-shot approval that authorizes a whole consolidation chain.
 * A previous approval must be finished, dead, or expired; the driver never
 * resumes an interrupted chain without fresh consent.
 */
export async function beginPrivateChainedApproval(
  context: PrivateStorageContext,
  key: Uint8Array,
  expectedRevision: number,
  approval: PrivateChainedApproval,
  candidate?: PrivateRecordDriver,
): Promise<PrivateBalanceDurableState> {
  if (!isChainedApproval(approval) || approval.accumulatedFeeStroops !== '0') {
    throw new Error('Private Balance chained approval is invalid.');
  }
  const current = await loadPrivateBalanceState(context, key, candidate);
  if (!current || current.revision !== expectedRevision) {
    throw new Error('Private Balance state changed in another wallet session.');
  }
  if (
    current.chainedApproval &&
    Math.floor(approval.createdAt / 1000) <= current.chainedApproval.expiresAtSeconds
  ) {
    throw new Error('Private Balance chained approval already exists.');
  }
  const next: PrivateBalanceDurableState = {
    ...current,
    revision: current.revision + 1,
    chainedApproval: { ...approval },
  };
  await commitPrivateBalanceState(context, key, next, current.revision, candidate);
  return next;
}

/**
 * Advances the durable running fee total before a chain step broadcasts.
 * Failing closed here keeps every broadcast inside the approved cumulative
 * cap even if the step later fails or the tab crashes mid-chain.
 */
export async function advancePrivateChainedApprovalFee(
  context: PrivateStorageContext,
  key: Uint8Array,
  expectedRevision: number,
  approvalId: string,
  stepFeeStroops: bigint,
  updatedAt: number,
  candidate?: PrivateRecordDriver,
): Promise<PrivateBalanceDurableState> {
  if (stepFeeStroops < 0n) throw new Error('Private Balance chained step fee is invalid.');
  const current = await loadPrivateBalanceState(context, key, candidate);
  if (!current || current.revision !== expectedRevision) {
    throw new Error('Private Balance state changed in another wallet session.');
  }
  const approval = current.chainedApproval;
  if (!approval || approval.id !== approvalId) {
    throw new Error('Private Balance chained approval does not exist.');
  }
  if (!isTimestamp(updatedAt) || updatedAt < approval.updatedAt) {
    throw new Error('Private Balance chained approval timestamp is invalid.');
  }
  if (Math.floor(updatedAt / 1000) > approval.expiresAtSeconds) {
    throw new Error('Private Balance chained approval expired.');
  }
  if (stepFeeStroops > BigInt(approval.perStepMaxFeeStroops)) {
    throw new Error('Private Balance chained step fee exceeds the approved per-step cap.');
  }
  const accumulated = BigInt(approval.accumulatedFeeStroops) + stepFeeStroops;
  if (accumulated > BigInt(approval.cumulativeMaxFeeStroops)) {
    throw new Error('Private Balance chained fees exceed the approved cumulative cap.');
  }
  const next: PrivateBalanceDurableState = {
    ...current,
    revision: current.revision + 1,
    chainedApproval: {
      ...approval,
      accumulatedFeeStroops: accumulated.toString(),
      updatedAt,
    },
  };
  await commitPrivateBalanceState(context, key, next, current.revision, candidate);
  return next;
}

export async function clearPrivateChainedApproval(
  context: PrivateStorageContext,
  key: Uint8Array,
  expectedRevision: number,
  candidate?: PrivateRecordDriver,
): Promise<PrivateBalanceDurableState> {
  const current = await loadPrivateBalanceState(context, key, candidate);
  if (!current || current.revision !== expectedRevision) {
    throw new Error('Private Balance state changed in another wallet session.');
  }
  if (!current.chainedApproval) return current;
  const next: PrivateBalanceDurableState = {
    ...current,
    revision: current.revision + 1,
  };
  delete next.chainedApproval;
  await commitPrivateBalanceState(context, key, next, current.revision, candidate);
  return next;
}

type PrivateRpcStatus = NonNullable<PrivatePendingAction['latestRpcStatus']>;

export type PrivatePendingActionTransition =
  | {
    from: 'prepared';
    to: 'reviewed';
    transactionHash: string;
    updatedAt: number;
  }
  | {
    from: 'reviewed';
    to: 'signed';
    signedEnvelopeXdr: string;
    expiresAtSeconds: number;
    updatedAt: number;
  }
  | {
    from: 'signed' | 'broadcast' | 'ambiguous';
    to: 'broadcast' | 'ambiguous';
    latestRpcStatus: PrivateRpcStatus;
    updatedAt: number;
  };

export async function transitionPrivatePendingAction(
  context: PrivateStorageContext,
  key: Uint8Array,
  expectedRevision: number,
  actionId: string,
  transition: PrivatePendingActionTransition,
  candidate?: PrivateRecordDriver,
): Promise<PrivateBalanceDurableState> {
  const current = await loadPrivateBalanceState(context, key, candidate);
  if (!current || current.revision !== expectedRevision) {
    throw new Error('Private Balance state changed in another wallet session.');
  }
  const index = current.pendingActions.findIndex(action => action.id === actionId);
  if (index < 0) throw new Error('Private Balance pending action does not exist.');
  const existing = current.pendingActions[index];
  if (existing.status !== transition.from) {
    throw new Error('Private Balance pending action lifecycle changed unexpectedly.');
  }
  if (!isTimestamp(transition.updatedAt) || transition.updatedAt < existing.updatedAt) {
    throw new Error('Private Balance pending action timestamp is invalid.');
  }

  let updated: PrivatePendingAction;
  if (transition.to === 'reviewed') {
    updated = {
      ...existing,
      status: transition.to,
      transactionHash: transition.transactionHash,
      updatedAt: transition.updatedAt,
    };
  } else if (transition.to === 'signed') {
    if (!isSafeIndex(transition.expiresAtSeconds)) {
      throw new Error('Private Balance pending action expiry is invalid.');
    }
    updated = {
      ...existing,
      status: transition.to,
      signedEnvelopeXdr: transition.signedEnvelopeXdr,
      expiresAtSeconds: transition.expiresAtSeconds,
      updatedAt: transition.updatedAt,
    };
  } else {
    updated = {
      ...existing,
      status: transition.to,
      broadcastAttempts: existing.broadcastAttempts + 1,
      latestRpcStatus: transition.latestRpcStatus,
      lastBroadcastAt: transition.updatedAt,
      updatedAt: transition.updatedAt,
    };
  }
  if (!isPendingAction(updated)) throw new Error('Private Balance pending action transition is invalid.');

  const pendingActions = current.pendingActions.map((action, actionIndex) =>
    actionIndex === index ? updated : { ...action });
  const next: PrivateBalanceDurableState = {
    ...current,
    revision: current.revision + 1,
    pendingActions,
  };
  await commitPrivateBalanceState(context, key, next, current.revision, candidate);
  return next;
}

export async function recordPrivatePendingActionRpcStatus(
  context: PrivateStorageContext,
  key: Uint8Array,
  expectedRevision: number,
  actionId: string,
  latestRpcStatus: PrivateRpcStatus,
  updatedAt: number,
  candidate?: PrivateRecordDriver,
): Promise<PrivateBalanceDurableState> {
  const current = await loadPrivateBalanceState(context, key, candidate);
  if (!current || current.revision !== expectedRevision) {
    throw new Error('Private Balance state changed in another wallet session.');
  }
  const index = current.pendingActions.findIndex(action => action.id === actionId);
  if (index < 0) throw new Error('Private Balance pending action does not exist.');
  const existing = current.pendingActions[index];
  if (!['broadcast', 'ambiguous'].includes(existing.status) || !isTimestamp(updatedAt) || updatedAt < existing.updatedAt) {
    throw new Error('Private Balance pending action RPC update is invalid.');
  }
  const updated: PrivatePendingAction = {
    ...existing,
    status: 'ambiguous',
    latestRpcStatus,
    updatedAt,
  };
  if (!isPendingAction(updated)) throw new Error('Private Balance pending action RPC update is invalid.');
  const next: PrivateBalanceDurableState = {
    ...current,
    revision: current.revision + 1,
    pendingActions: current.pendingActions.map((action, actionIndex) =>
      actionIndex === index ? updated : { ...action }),
  };
  await commitPrivateBalanceState(context, key, next, current.revision, candidate);
  return next;
}

export interface PrivatePendingActionRelease {
  reason: 'pre-broadcast-rejection' | 'definitive-failure-nullifiers-absent';
  updatedAt: number;
}

export async function releasePrivatePendingAction(
  context: PrivateStorageContext,
  key: Uint8Array,
  expectedRevision: number,
  actionId: string,
  release: PrivatePendingActionRelease,
  candidate?: PrivateRecordDriver,
): Promise<PrivateBalanceDurableState> {
  const current = await loadPrivateBalanceState(context, key, candidate);
  if (!current || current.revision !== expectedRevision) {
    throw new Error('Private Balance state changed in another wallet session.');
  }
  const pending = current.pendingActions.find(action => action.id === actionId);
  if (!pending) throw new Error('Private Balance pending action does not exist.');
  if (!isTimestamp(release.updatedAt) || release.updatedAt < pending.updatedAt) {
    throw new Error('Private Balance pending action timestamp is invalid.');
  }
  const mayReleaseRejectedReview =
    ['prepared', 'reviewed'].includes(pending.status) && pending.broadcastAttempts === 0;
  const mayReleaseDefinitiveFailure =
    ['broadcast', 'ambiguous'].includes(pending.status) && pending.broadcastAttempts > 0;
  if (
    (release.reason === 'pre-broadcast-rejection' && !mayReleaseRejectedReview) ||
    (release.reason === 'definitive-failure-nullifiers-absent' && !mayReleaseDefinitiveFailure)
  ) {
    throw new Error('Private Balance pending action cannot be released from this lifecycle state.');
  }

  const reserved = new Set(pending.reservedNoteIds);
  const notes = current.notes.map(note => reserved.has(note.id)
    ? { ...note, status: 'unspent' as const, reservedAt: undefined }
    : { ...note });
  const next: PrivateBalanceDurableState = {
    ...current,
    revision: current.revision + 1,
    notes,
    pendingActions: current.pendingActions.filter(action => action.id !== actionId),
  };
  await commitPrivateBalanceState(context, key, next, current.revision, candidate);
  return next;
}

export function clearShieldedState(
  context: PrivateStorageContext,
  candidate?: PrivateRecordDriver,
): Promise<void> {
  validateContext(context);
  return driver(candidate).removePrefix(privateBalanceSensitivePrefix(context));
}
