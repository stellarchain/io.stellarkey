import {
  deriveStealthRootKey,
  deriveStealthViewingKeys,
  encodeStealthMetaAddress,
  type StealthViewingKeys,
  type StealthNetwork,
  type X25519Implementation,
} from '@stellarkey/private-balance';
import { HorizonStealthAnnouncementReader } from './stealth-horizon';
import {
  syncStealthAnnouncements,
  type StealthAnnouncementReader,
} from './stealth-sync';
import type {
  StealthCacheDriver,
  StealthDiscoveryCache,
} from './stealth-cache';
import type { PrivateStorageContext } from './storage';
import { assertStealthDiscoveryActive, type StealthDiscoveryGuard } from './stealth-discovery-operation';
import { withPrivacySessionRoot } from '../../../lib/vault';

export interface StealthRuntimeIdentity {
  metaAddress: string;
}

export interface StealthRuntimeMaterial {
  keys: StealthViewingKeys;
  storageKey: Uint8Array;
}

export interface SyncStealthRuntimeInput extends StealthDiscoveryGuard, StealthRuntimeMaterial {
  context: PrivateStorageContext;
  network: StealthNetwork;
  walletCreatedAt: number;
  announcerPublicKey: string;
  storageDriver?: StealthCacheDriver;
  implementation?: X25519Implementation;
  createReader?(input: {
    network: StealthNetwork;
    announcerPublicKey: string;
  }): StealthAnnouncementReader;
  now?: () => number;
  onIdentity?(metaAddress: string): void;
}

export interface StealthRuntimeResult extends StealthRuntimeIdentity {
  cache: StealthDiscoveryCache;
}

function assertRootKey(rootKey: Uint8Array): void {
  if (!(rootKey instanceof Uint8Array) || rootKey.length !== 32) {
    throw new Error('Stealth runtime root key must be 32 bytes');
  }
}

function disposeViewingKeys(keys: StealthViewingKeys): void {
  keys.scanPrivateKey.fill(0);
  keys.scanPublicKey.fill(0);
  keys.spendPublicKey.fill(0);
  keys.deploymentBindingHash.fill(0);
}

/** Caller owns these copies until scoped discovery has actually drained. */
export function disposeStealthRuntimeMaterial(material: StealthRuntimeMaterial): void {
  disposeViewingKeys(material.keys);
  material.storageKey.fill(0);
}

/** The vault callback settles before any transport can receive this result. */
export async function prepareStealthRuntimeMaterial(input: StealthDiscoveryGuard & {
  accountId: string;
  deploymentContext: Parameters<typeof withPrivacySessionRoot>[1];
  network: StealthNetwork;
}): Promise<StealthRuntimeMaterial> {
  assertStealthDiscoveryActive(input);
  const owned: Partial<StealthRuntimeMaterial> = {};
  try {
    await withPrivacySessionRoot(input.accountId, input.deploymentContext, (sessionRoot, storageKey) => {
      assertStealthDiscoveryActive(input);
      const root = deriveStealthRootKey(sessionRoot);
      try {
        const binding = Uint8Array.from(input.deploymentContext.deploymentBindingHash.match(/../gu) ?? [],
          byte => Number.parseInt(byte, 16));
        owned.keys = deriveStealthViewingKeys(root, input.network, binding);
        owned.storageKey = storageKey.slice();
        assertStealthDiscoveryActive(input);
      } finally { root.fill(0); }
    });
    assertStealthDiscoveryActive(input);
    if (!owned.keys || !owned.storageKey) throw new Error('Reusable payment viewing preparation is incomplete.');
    return { keys: owned.keys, storageKey: owned.storageKey };
  } catch (error) {
    if (owned.keys) disposeViewingKeys(owned.keys);
    owned.storageKey?.fill(0);
    throw error;
  }
}

export function deriveStealthRuntimeIdentity(
  rootKey: Uint8Array,
  network: StealthNetwork,
  deploymentBindingHash: Uint8Array,
): StealthRuntimeIdentity {
  assertRootKey(rootKey);
  const keys = deriveStealthViewingKeys(rootKey, network, deploymentBindingHash);
  try {
    return {
      metaAddress: encodeStealthMetaAddress(keys, network),
    };
  } finally {
    disposeViewingKeys(keys);
  }
}

export async function syncStealthRuntime(
  input: SyncStealthRuntimeInput,
): Promise<StealthRuntimeResult> {
  assertStealthDiscoveryActive(input);
  if (!(input.storageKey instanceof Uint8Array) || input.storageKey.length !== 32) {
    throw new Error('Stealth runtime storage key must be 32 bytes');
  }
  if (!/^[0-9a-f]{64}$/u.test(input.context.deploymentBindingHash)) {
    throw new Error('Stealth runtime deployment binding hash must be 32 bytes');
  }
  const keys = input.keys;
  if (keys.network !== input.network) throw new Error('Stealth viewing key network mismatch');
  if (keys.deploymentBindingHash.length !== 32 || !keys.deploymentBindingHash.every((byte, index) =>
    byte === Number.parseInt(input.context.deploymentBindingHash.slice(index * 2, index * 2 + 2), 16))) {
    throw new Error('Stealth viewing keys belong to another deployment');
  }
  const metaAddress = encodeStealthMetaAddress(keys, input.network);
  assertStealthDiscoveryActive(input);
  input.onIdentity?.(metaAddress);
  assertStealthDiscoveryActive(input);
  const reader = input.createReader?.({
    network: input.network,
    announcerPublicKey: input.announcerPublicKey,
  }) ?? new HorizonStealthAnnouncementReader({
    network: input.network,
    announcerPublicKey: input.announcerPublicKey,
  });
  assertStealthDiscoveryActive(input);
  const cache = await syncStealthAnnouncements({
    context: input.context,
    storageKey: input.storageKey,
    keys,
    network: input.network,
    reader,
    storageDriver: input.storageDriver,
    implementation: input.implementation,
    now: input.now,
    lowerBoundCreatedAt: input.walletCreatedAt,
    signal: input.signal,
    assertActive: input.assertActive,
  });
  assertStealthDiscoveryActive(input);
  return { metaAddress, cache };
}
