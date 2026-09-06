import {
  deriveStealthMetaKeys,
  encodeStealthMetaAddress,
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

export interface StealthRuntimeIdentity {
  metaAddress: string;
}

export interface SyncStealthRuntimeInput extends StealthDiscoveryGuard {
  rootKey: Uint8Array;
  storageKey: Uint8Array;
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

export function deriveStealthRuntimeIdentity(
  rootKey: Uint8Array,
  network: StealthNetwork,
  deploymentBindingHash: Uint8Array,
): StealthRuntimeIdentity {
  assertRootKey(rootKey);
  const keys = deriveStealthMetaKeys(rootKey, network, deploymentBindingHash);
  try {
    return {
      metaAddress: encodeStealthMetaAddress(keys, network),
    };
  } finally {
    keys.scanPrivateKey.fill(0);
    keys.nonceKey.fill(0);
    keys.scanPublicKey.fill(0);
    keys.spendPublicKey.fill(0);
  }
}

export async function syncStealthRuntime(
  input: SyncStealthRuntimeInput,
): Promise<StealthRuntimeResult> {
  assertStealthDiscoveryActive(input);
  assertRootKey(input.rootKey);
  if (!(input.storageKey instanceof Uint8Array) || input.storageKey.length !== 32) {
    throw new Error('Stealth runtime storage key must be 32 bytes');
  }
  const deploymentBindingHash = Uint8Array.from(
    input.context.deploymentBindingHash.match(/../gu) ?? [],
    byte => Number.parseInt(byte, 16),
  );
  if (deploymentBindingHash.length !== 32) {
    throw new Error('Stealth runtime deployment binding hash must be 32 bytes');
  }
  const keys = deriveStealthMetaKeys(input.rootKey, input.network, deploymentBindingHash);
  try {
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
  } finally {
    deploymentBindingHash.fill(0);
    keys.scanPrivateKey.fill(0);
    keys.nonceKey.fill(0);
    keys.scanPublicKey.fill(0);
    keys.spendPublicKey.fill(0);
  }
}
