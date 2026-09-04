export type PrivateRelayHelperPhase =
  | 'off'
  | 'waiting'
  | 'connecting'
  | 'listening'
  | 'reconnecting'
  | 'unavailable';

export interface PrivateRelayHelperStatus {
  phase: PrivateRelayHelperPhase;
  connectedRelays: number;
  totalRelays: number;
}

const OFF_STATUS: PrivateRelayHelperStatus = Object.freeze({
  phase: 'off',
  connectedRelays: 0,
  totalRelays: 0,
});

let currentStatus = OFF_STATUS;
const listeners = new Set<() => void>();

export function getPrivateRelayHelperStatus(): PrivateRelayHelperStatus {
  return currentStatus;
}

export function getPrivateRelayHelperServerStatus(): PrivateRelayHelperStatus {
  return OFF_STATUS;
}

export function subscribePrivateRelayHelperStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishPrivateRelayHelperStatus(status: PrivateRelayHelperStatus): void {
  if (
    !Number.isSafeInteger(status.connectedRelays) ||
    !Number.isSafeInteger(status.totalRelays) ||
    status.connectedRelays < 0 ||
    status.totalRelays < status.connectedRelays
  ) {
    throw new Error('Private relay helper status is invalid');
  }
  if (
    currentStatus.phase === status.phase &&
    currentStatus.connectedRelays === status.connectedRelays &&
    currentStatus.totalRelays === status.totalRelays
  ) return;
  currentStatus = Object.freeze({ ...status });
  for (const listener of listeners) listener();
}

export function resetPrivateRelayHelperStatus(): void {
  publishPrivateRelayHelperStatus(OFF_STATUS);
}
