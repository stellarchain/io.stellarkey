/**
 * Shell-side bridge for Private Payments. This module must stay free of any
 * import from src/features/private-balance so the public shell bundle keeps
 * its lazy boundary (release-gate enforced) — shape checks only, no decoding.
 */

/** Cheap shape check for a v2 Bech32m private address (tks testnet, sks mainnet). */
export function isPrivateReceiveAddressLike(value: string): boolean {
  const trimmed = value.trim();
  return /^(?:tks1|sks1)[02-9ac-hj-np-z]{166}$/.test(trimmed);
}

/** Cheap shape check for a v2 reusable stealth handle (tsm testnet, ssm mainnet). */
export function isStealthMetaAddressLike(value: string): boolean {
  const trimmed = value.trim();
  return /^(?:tsm1|ssm1)[02-9ac-hj-np-z]{160}$/.test(trimmed);
}

/** Fired for a mounted Private Payments card to open a flow immediately. */
export const PRIVATE_SEND_REQUEST_EVENT = 'stellarkey.private.send-request';
export const PRIVATE_ADD_REQUEST_EVENT = 'stellarkey.private.add-request';
export const PRIVATE_RECEIVE_REQUEST_EVENT = 'stellarkey.private.receive-request';
/** Fired for the wallet shell to open the PUBLIC send sheet, prefilled. */
export const PUBLIC_SEND_REQUEST_EVENT = 'stellarkey.public.send-request';

const SEND_INTENT_KEY = 'send';
const ADD_INTENT_KEY = 'add';
const RECEIVE_INTENT_KEY = 'receive';
const INTENT_TTL_MS = 60_000;
const pendingIntents = new Map<string, { value: string; expiresAt: number }>();

function setIntent(key: string, value: string): void {
  pendingIntents.set(key, { value, expiresAt: Date.now() + INTENT_TTL_MS });
}

function consumeIntent(key: string): string | null {
  const intent = pendingIntents.get(key) ?? null;
  pendingIntents.delete(key);
  if (!intent || intent.expiresAt < Date.now()) return null;
  return intent.value;
}

/**
 * Ask Private Payments to open its send flow for `recipient`. Works whether or
 * not the private surface is mounted yet: an expiring intent is held for the next
 * mount, and a live event covers a card already on screen.
 */
export function requestPrivateSend(recipient: string): void {
  setIntent(SEND_INTENT_KEY, recipient);
  window.dispatchEvent(new CustomEvent(PRIVATE_SEND_REQUEST_EVENT, { detail: { recipient } }));
}

export function consumePrivateSendIntent(): string | null {
  return consumeIntent(SEND_INTENT_KEY);
}

/** Ask Private Payments to open its add-funds flow, optionally prefilled. */
export function requestPrivateAdd(amount?: string): void {
  setIntent(ADD_INTENT_KEY, amount ?? '');
  window.dispatchEvent(new CustomEvent(PRIVATE_ADD_REQUEST_EVENT, { detail: { amount } }));
}

export function consumePrivateAddIntent(): string | null {
  return consumeIntent(ADD_INTENT_KEY);
}

/** Ask Private Payments to open its receive sheet. */
export function requestPrivateReceive(): void {
  setIntent(RECEIVE_INTENT_KEY, '1');
  window.dispatchEvent(new CustomEvent(PRIVATE_RECEIVE_REQUEST_EVENT));
}

export function consumePrivateReceiveIntent(): boolean {
  return consumeIntent(RECEIVE_INTENT_KEY) !== null;
}

/** Ask the wallet shell to open the public send sheet for `destination`. */
export function requestPublicSend(destination: string): void {
  window.dispatchEvent(
    new CustomEvent(PUBLIC_SEND_REQUEST_EVENT, { detail: { destination } }),
  );
}
