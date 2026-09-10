import { PrivateRelayConfigurationError, type PrivateRelayConfigurationProblem } from './connection-error';

export type PrivateRelayHelperPhase =
  | 'off'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'configuration-error'
  | 'unavailable';

export interface PrivateRelayHelperStatus {
  phase: PrivateRelayHelperPhase;
  connectedRelays: number;
  totalRelays: number;
  configurationProblem?: PrivateRelayConfigurationProblem;
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
  if ((status.phase === 'configuration-error') !== Boolean(status.configurationProblem) ||
    (status.configurationProblem && (status.connectedRelays !== 0 || status.configurationProblem.code !== 'waku-cluster-mismatch'))) {
    throw new Error('Private relay helper configuration status is invalid');
  }
  const configurationProblem = status.configurationProblem ? new PrivateRelayConfigurationError(
    status.configurationProblem.configuredClusterId, status.configurationProblem.peerClusterIds,
  ).problem : undefined;
  if (
    currentStatus.phase === status.phase &&
    currentStatus.connectedRelays === status.connectedRelays &&
    currentStatus.totalRelays === status.totalRelays &&
    currentStatus.configurationProblem?.configuredClusterId === configurationProblem?.configuredClusterId &&
    currentStatus.configurationProblem?.peerClusterIds.join(',') === configurationProblem?.peerClusterIds.join(',')
  ) return;
  currentStatus = Object.freeze({ phase: status.phase, connectedRelays: status.connectedRelays, totalRelays: status.totalRelays,
    ...(configurationProblem ? { configurationProblem } : {}),
  });
  for (const listener of listeners) listener();
}

export function resetPrivateRelayHelperStatus(): void {
  publishPrivateRelayHelperStatus(OFF_STATUS);
}

function helperAbortError(): DOMException {
  return new DOMException('Private relay helper cancelled.', 'AbortError');
}

function waitForHelperRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(helperAbortError());
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(helperAbortError());
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export async function retryPrivateRelayHelperReadiness<T>(input: {
  signal: AbortSignal;
  connect(signal: AbortSignal): Promise<T>;
  onUnavailable(): void;
  onRetry(): void;
  shouldRetry?(cause: unknown): boolean;
  retryDelayMs?: number;
}): Promise<T> {
  const retryDelayMs = input.retryDelayMs ?? 1_000;
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1 || retryDelayMs > 60_000) {
    throw new Error('Private relay helper retry delay is invalid');
  }
  while (!input.signal.aborted) {
    try {
      return await input.connect(input.signal);
    } catch (cause) {
      if (input.signal.aborted) throw helperAbortError();
      if (input.shouldRetry?.(cause) === false) throw cause;
      input.onUnavailable();
      await waitForHelperRetry(retryDelayMs, input.signal);
      input.onRetry();
    }
  }
  throw helperAbortError();
}
