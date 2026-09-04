import type { Event, EventTemplate, VerifiedEvent } from 'nostr-tools/pure';
import { PRIVATE_RELAY_MAX_ENCRYPTED_BYTES, PRIVATE_RELAY_MAX_PLAINTEXT_BYTES } from './protocol';

export interface PrivateRelayEphemeralIdentity {
  secretKey: Uint8Array;
  publicKey: string;
}

async function pure() {
  return import('nostr-tools/pure');
}

async function nip44() {
  return import('nostr-tools/nip44');
}

function assertSecretKey(secretKey: Uint8Array): void {
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32 || secretKey.every(byte => byte === 0)) {
    throw new Error('Private relay ephemeral secret is invalid');
  }
}

function assertPublicKey(publicKey: string): void {
  if (!/^[0-9a-f]{64}$/u.test(publicKey)) {
    throw new Error('Private relay ephemeral public key is invalid');
  }
}

export async function createPrivateRelayEphemeralIdentity(): Promise<PrivateRelayEphemeralIdentity> {
  const nostr = await pure();
  const secretKey = nostr.generateSecretKey();
  return { secretKey, publicKey: nostr.getPublicKey(secretKey) };
}

export async function encryptPrivateRelayPayload(
  secretKey: Uint8Array,
  peerPublicKey: string,
  plaintext: string,
): Promise<string> {
  assertSecretKey(secretKey);
  assertPublicKey(peerPublicKey);
  if (new TextEncoder().encode(plaintext).byteLength > PRIVATE_RELAY_MAX_PLAINTEXT_BYTES) {
    throw new Error('Private relay plaintext is too large');
  }
  const nostr = await nip44();
  const key = nostr.v2.utils.getConversationKey(secretKey, peerPublicKey);
  try {
    const encrypted = nostr.v2.encrypt(plaintext, key);
    if (new TextEncoder().encode(encrypted).byteLength > PRIVATE_RELAY_MAX_ENCRYPTED_BYTES) {
      throw new Error('Private relay encrypted payload is too large');
    }
    return encrypted;
  } finally {
    key.fill(0);
  }
}

export async function decryptPrivateRelayPayload(
  secretKey: Uint8Array,
  peerPublicKey: string,
  encrypted: string,
): Promise<string> {
  assertSecretKey(secretKey);
  assertPublicKey(peerPublicKey);
  if (typeof encrypted !== 'string' || new TextEncoder().encode(encrypted).byteLength > PRIVATE_RELAY_MAX_ENCRYPTED_BYTES) {
    throw new Error('Private relay encrypted payload is invalid');
  }
  const nostr = await nip44();
  const key = nostr.v2.utils.getConversationKey(secretKey, peerPublicKey);
  try {
    const plaintext = nostr.v2.decrypt(encrypted, key);
    if (new TextEncoder().encode(plaintext).byteLength > PRIVATE_RELAY_MAX_PLAINTEXT_BYTES) {
      throw new Error('Private relay plaintext is too large');
    }
    return plaintext;
  } finally {
    key.fill(0);
  }
}

export async function signPrivateRelayEvent(
  secretKey: Uint8Array,
  template: EventTemplate,
): Promise<VerifiedEvent> {
  assertSecretKey(secretKey);
  return (await pure()).finalizeEvent(template, secretKey);
}

export async function verifyPrivateRelayEvent(event: Event): Promise<boolean> {
  return (await pure()).verifyEvent(event);
}
