/** Share public market transports without giving one consumer ownership of another. */
export function createSharedMarketRequests<T>() {
  type Pending = { controller: AbortController; promise: Promise<T>; consumers: number };
  const pending = new Map<string, Pending>();

  return (key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) return Promise.reject(signal.reason);
    let entry = pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created: Pending = {
        controller,
        consumers: 0,
        promise: Promise.resolve().then(() => {
          if (controller.signal.aborted) throw controller.signal.reason;
          return load(controller.signal);
        }).finally(() => {
          if (pending.get(key) === created) pending.delete(key);
        }),
      };
      pending.set(key, created);
      entry = created;
    }
    const request = entry;
    request.consumers++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = (publish: () => void) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", onAbort);
        request.consumers--;
        if (request.consumers === 0 && pending.get(key) === request) {
          // Revoke immediately so a new consumer cannot join an abandoned request.
          pending.delete(key);
          request.controller.abort();
        }
        publish();
      };
      const onAbort = () => finish(() => reject(signal?.reason));
      signal?.addEventListener("abort", onAbort, { once: true });
      request.promise.then(
        value => finish(() => resolve(value)),
        error => finish(() => reject(error)),
      );
    });
  };
}
