export type ResourceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

type ResourcePromises = Record<string, Promise<unknown>>;

export type SettledResourceMap<T extends ResourcePromises> = {
  [K in keyof T]: ResourceResult<Awaited<T[K]>>;
};

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export async function settleResourceMap<T extends ResourcePromises>(
  resources: T,
): Promise<SettledResourceMap<T>> {
  const entries = await Promise.all(
    Object.entries(resources).map(async ([name, promise]) => {
      try {
        return [name, { ok: true, value: await promise }] as const;
      } catch (error) {
        return [name, { ok: false, error: asError(error) }] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as SettledResourceMap<T>;
}

function resourceLabel(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
}

export function describeResourceFailures(resources: Record<string, ResourceResult<unknown>>): string | null {
  const failures = Object.entries(resources).flatMap(([key, result]) =>
    result.ok ? [] : [`${resourceLabel(key)}: ${result.error.message}`]);
  return failures.length > 0 ? failures.join(" · ") : null;
}

interface DeadlineOptions {
  timeoutMs: number;
  label: string;
  signal?: AbortSignal;
}

/**
 * Bounds an entire async resource, including response-body decoding. The race is
 * intentional: callers still settle if a browser implementation ignores abort.
 */
export async function withAbortDeadline<T>(
  task: (signal: AbortSignal) => Promise<T>,
  { timeoutMs, label, signal: callerSignal }: DeadlineOptions,
): Promise<T> {
  const controller = new AbortController();
  let rejectDeadline: ((reason: Error) => void) | null = null;
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });

  const stop = (reason: unknown) => {
    const error = asError(reason);
    if (!controller.signal.aborted) controller.abort(error);
    rejectDeadline?.(error);
  };
  const onCallerAbort = () => stop(callerSignal?.reason ?? new Error(`${label} was cancelled.`));
  if (callerSignal?.aborted) onCallerAbort();
  else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  const timer = setTimeout(() => stop(new Error(`${label} timed out.`)), timeoutMs);
  try {
    const work = Promise.resolve().then(() => task(controller.signal));
    return await Promise.race([work, stopped]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}
