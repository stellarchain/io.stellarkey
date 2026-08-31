/**
 * Shell-side bridge for Private Payments. This module must stay free of any
 * import from src/features/private-balance so the public shell bundle keeps
 * its lazy boundary (release-gate enforced) — shape checks only, no decoding.
 */

/** Cheap shape check for a v2 Bech32m private address (tks testnet, sks mainnet). */
export function isPrivateReceiveAddressLike(value: string): boolean {
  const trimmed = value.trim();
  return /^(?:tks1|sks1)[02-9ac-hj-np-z]{115}$/.test(trimmed);
}

/** Cheap shape check for a v2 reusable stealth handle (tsm testnet, ssm mainnet). */
export function isStealthMetaAddressLike(value: string): boolean {
  const trimmed = value.trim();
  return /^(?:tsm1|ssm1)[02-9ac-hj-np-z]{109}$/.test(trimmed);
}

/** Fired for a mounted Private Payments card to open a flow immediately. */
export const PRIVATE_SEND_REQUEST_EVENT = 'stellarkey.private.send-request';
export const PRIVATE_ADD_REQUEST_EVENT = 'stellarkey.private.add-request';
export const PRIVATE_RECEIVE_REQUEST_EVENT = 'stellarkey.private.receive-request';
/** Fired for the wallet shell to open the PUBLIC send sheet, prefilled. */
export const PUBLIC_SEND_REQUEST_EVENT = 'stellarkey.public.send-request';

const SEND_INTENT_KEY = 'stellarkey.private.send-intent.v1';
const ADD_INTENT_KEY = 'stellarkey.private.add-intent.v1';
const RECEIVE_INTENT_KEY = 'stellarkey.private.receive-intent.v1';

function setIntent(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Session storage may be unavailable; the live event still covers the
    // already-mounted case.
  }
}

function consumeIntent(key: string): string | null {
  try {
    const value = window.sessionStorage.getItem(key);
    if (value !== null) window.sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}

/**
 * Ask Private Payments to open its send flow for `recipient`. Works whether or
 * not the private surface is mounted yet: an intent is stored for the next
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
