/**
 * Tab-local FIFO mutex serializing the sync machine with prepare/sign/
 * broadcast/cancel flows. Cross-tab safety stays with the CAS journal and
 * the runtime lease; this only removes transient same-tab interleavings so
 * callers can await an in-flight sync instead of failing on a non-current
 * phase.
 */
export interface PrivateRuntimeMutex {
  readonly locked: boolean;
  runExclusive<T>(task: () => Promise<T>): Promise<T>;
}

export function createPrivateRuntimeMutex(): PrivateRuntimeMutex {
  let tail: Promise<void> = Promise.resolve();
  let holders = 0;
  return {
    get locked() {
      return holders > 0;
    },
    runExclusive<T>(task: () => Promise<T>): Promise<T> {
      const run = tail.then(async () => {
        holders += 1;
        try {
          return await task();
        } finally {
          holders -= 1;
        }
      });
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
