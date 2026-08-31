const LEASE_PREFIX = 'stellarkey.private.runtime-lease.v1';
const CHANNEL_PREFIX = 'stellarkey.private.runtime-updates.v1';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PrivateBalanceRuntimeScope {
  networkId: string;
  realmId: string;
  poolId: string;
  accountId: string;
}

interface PrivateBalanceLease {
  ownerId: string;
  expiresAt: number;
}

export type PrivateBalanceRuntimePhase =
  | 'disabled'
  | 'locked'
  | 'loading-artifacts'
  | 'reading-meta'
  | 'scanning-live'
  | 'current'
  | 'safe-error';

export interface PrivateBalanceFollowerUpdate {
  protocolVersion: 1;
  type: 'private-runtime-update';
  senderId: string;
  nonce: string;
  phase: PrivateBalanceRuntimePhase;
  revision: number;
  verifiedBalanceStroops: string;
  lastVerifiedActionIndex: number | null;
}

export interface PrivateBalanceFollowerChannel {
  post(update: Omit<PrivateBalanceFollowerUpdate, 'protocolVersion' | 'type' | 'senderId' | 'nonce'>): void;
  close(): void;
}

const PHASES = new Set<PrivateBalanceRuntimePhase>([
  'disabled',
  'locked',
  'loading-artifacts',
  'reading-meta',
  'scanning-live',
  'current',
  'safe-error',
]);

const UPDATE_KEYS = [
  'lastVerifiedActionIndex',
  'nonce',
  'phase',
  'protocolVersion',
  'revision',
  'senderId',
  'type',
  'verifiedBalanceStroops',
].sort();

function hex32(value: string, name: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`Private Balance runtime ${name} must be 32-byte lowercase hex`);
  }
  return value;
}

function opaqueId(value: string, name: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error(`Private Balance runtime ${name} is invalid`);
  }
  return value;
}

function scopeSuffix(scope: PrivateBalanceRuntimeScope): string {
  return [
    hex32(scope.networkId, 'network ID'),
    hex32(scope.realmId, 'realm ID'),
    hex32(scope.poolId, 'pool ID'),
    opaqueId(scope.accountId, 'account ID'),
  ].join(':');
}

export function privateBalanceLeaseKey(scope: PrivateBalanceRuntimeScope): string {
  return `${LEASE_PREFIX}:${scopeSuffix(scope)}`;
}

function readLease(storage: StorageLike, key: string): PrivateBalanceLease | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const lease = value as Partial<PrivateBalanceLease>;
    if (
      typeof lease.ownerId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(lease.ownerId) ||
      !Number.isFinite(lease.expiresAt) ||
      (lease.expiresAt as number) < 0
    ) return null;
    return { ownerId: lease.ownerId, expiresAt: lease.expiresAt as number };
  } catch {
    return null;
  }
}

export function claimPrivateBalanceLease(
  storage: StorageLike,
  key: string,
  ownerId: string,
  now: number,
  ttlMs: number,
): boolean {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerId)) return false;
  if (!Number.isFinite(now) || now < 0 || !Number.isFinite(ttlMs) || ttlMs <= 0) return false;
  const current = readLease(storage, key);
  if (current && current.ownerId !== ownerId && current.expiresAt > now) return false;
  const desired: PrivateBalanceLease = { ownerId, expiresAt: now + ttlMs };
  if (!Number.isSafeInteger(desired.expiresAt)) return false;
  try {
    storage.setItem(key, JSON.stringify(desired));
    const confirmed = readLease(storage, key);
    return confirmed?.ownerId === ownerId && confirmed.expiresAt === desired.expiresAt;
  } catch {
    return false;
  }
}

/**
 * Force-claims the runtime lease for a follower tab's "Use Here" takeover.
 * The displaced leader observes the foreign owner on its next renewal and
 * clears its decrypted state; the CAS journal keeps the short dual-leader
 * window safe.
 */
export function forceClaimPrivateBalanceLease(
  storage: StorageLike,
  key: string,
  ownerId: string,
  now: number,
  ttlMs: number,
): boolean {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerId)) return false;
  if (!Number.isFinite(now) || now < 0 || !Number.isFinite(ttlMs) || ttlMs <= 0) return false;
  const desired: PrivateBalanceLease = { ownerId, expiresAt: now + ttlMs };
  if (!Number.isSafeInteger(desired.expiresAt)) return false;
  try {
    storage.setItem(key, JSON.stringify(desired));
    const confirmed = readLease(storage, key);
    return confirmed?.ownerId === ownerId && confirmed.expiresAt === desired.expiresAt;
  } catch {
    return false;
  }
}

export function releasePrivateBalanceLease(
  storage: StorageLike,
  key: string,
  ownerId: string,
): boolean {
  const current = readLease(storage, key);
  if (!current || current.ownerId !== ownerId) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function exactKeys(value: object): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === UPDATE_KEYS.length && keys.every((key, index) => key === UPDATE_KEYS[index]);
}

export function decodePrivateBalanceFollowerUpdate(raw: string): PrivateBalanceFollowerUpdate | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value) || !exactKeys(value)) return null;
    const update = value as Partial<PrivateBalanceFollowerUpdate>;
    if (
      update.protocolVersion !== 1 ||
      update.type !== 'private-runtime-update' ||
      typeof update.senderId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(update.senderId) ||
      typeof update.nonce !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(update.nonce) ||
      typeof update.phase !== 'string' || !PHASES.has(update.phase as PrivateBalanceRuntimePhase) ||
      !Number.isSafeInteger(update.revision) || (update.revision as number) < 0 ||
      typeof update.verifiedBalanceStroops !== 'string' ||
        !/^(?:0|[1-9][0-9]*)$/.test(update.verifiedBalanceStroops) ||
      (update.lastVerifiedActionIndex !== null &&
        (typeof update.lastVerifiedActionIndex !== 'number' ||
          !Number.isSafeInteger(update.lastVerifiedActionIndex) ||
          update.lastVerifiedActionIndex < 0))
    ) return null;
    return update as PrivateBalanceFollowerUpdate;
  } catch {
    return null;
  }
}

export function openPrivateBalanceFollowerChannel(
  scope: PrivateBalanceRuntimeScope,
  senderId: string,
  onUpdate: (update: PrivateBalanceFollowerUpdate) => void,
): PrivateBalanceFollowerChannel {
  const channelName = `${CHANNEL_PREFIX}:${scopeSuffix(scope)}`;
  opaqueId(senderId, 'sender ID');
  if (typeof window === 'undefined' || typeof window.BroadcastChannel === 'undefined') {
    return { post: () => {}, close: () => {} };
  }
  let channel: BroadcastChannel | null = null;
  const onMessage = (event: MessageEvent<unknown>) => {
    let raw: string;
    try {
      raw = JSON.stringify(event.data);
    } catch {
      return;
    }
    const update = decodePrivateBalanceFollowerUpdate(raw);
    if (update && update.senderId !== senderId) onUpdate(update);
  };
  try {
    channel = new window.BroadcastChannel(channelName);
    channel.addEventListener('message', onMessage);
  } catch {
    channel = null;
  }
  return {
    post: update => {
      if (!channel) return;
      const message: PrivateBalanceFollowerUpdate = {
        protocolVersion: 1,
        type: 'private-runtime-update',
        senderId,
        nonce: globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        ...update,
      };
      if (!decodePrivateBalanceFollowerUpdate(JSON.stringify(message))) {
        throw new Error('Private Balance follower update is invalid');
      }
      channel.postMessage(message);
    },
    close: () => {
      if (!channel) return;
      channel.removeEventListener('message', onMessage);
      channel.close();
      channel = null;
    },
  };
}
