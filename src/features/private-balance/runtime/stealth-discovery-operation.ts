import { createSessionRevocationGuard, subscribeSessionRevocation } from '../../../lib/vault';

export interface StealthDiscoveryGuard {
  signal?: AbortSignal;
  assertActive?(): void;
}

/** Check on both sides of awaits, even when the transport ignores abort. */
export function assertStealthDiscoveryActive(guard: StealthDiscoveryGuard): void {
  guard.signal?.throwIfAborted();
  guard.assertActive?.();
  guard.signal?.throwIfAborted();
}

export interface StealthDiscoveryOperation {
  readonly identity: symbol;
  readonly signal: AbortSignal;
  /** Settles only after owned work drains; abort alone is not completion. */
  readonly completion: Promise<void>;
  assertActive(): void;
  abort(): void;
  run<T>(work: (guard: StealthDiscoveryGuard) => Promise<T>): Promise<T>;
}

function cancelled(): DOMException {
  return new DOMException('Reusable payment discovery was cancelled.', 'AbortError');
}

/** One scan generation, shared by refresh and abort/drain-before-removal. */
export function createStealthDiscoveryOperation(assertContext: () => void): StealthDiscoveryOperation {
  const assertSession = createSessionRevocationGuard();
  const controller = new AbortController();
  let started = false;
  let finished = false;
  let resolveCompletion!: () => void;
  const completion = new Promise<void>(resolve => { resolveCompletion = resolve; });
  const unsubscribe = subscribeSessionRevocation(() => abort());
  const finish = () => {
    if (finished) return;
    finished = true;
    unsubscribe();
    resolveCompletion();
  };
  const assertActive = () => {
    controller.signal.throwIfAborted();
    if (finished) throw cancelled();
    try {
      assertSession();
      assertContext();
    } catch (error) {
      abort();
      throw error;
    }
    controller.signal.throwIfAborted();
  };
  function abort(): void {
    if (!controller.signal.aborted) controller.abort(cancelled());
    if (!started) finish();
  }
  return {
    identity: Symbol('stealth-discovery'),
    signal: controller.signal,
    completion,
    assertActive,
    abort,
    async run<T>(work: (guard: StealthDiscoveryGuard) => Promise<T>): Promise<T> {
      if (started) throw new Error('Discovery operation can run only once.');
      started = true;
      try {
        assertActive();
        const result = await work({ signal: controller.signal, assertActive });
        assertActive();
        return result;
      } finally { finish(); }
    },
  };
}
