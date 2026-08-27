export type HorizonErrorKind =
  | "not_found"
  | "rate_limited"
  | "validation"
  | "server"
  | "network"
  | "response_too_large"
  | "unknown";

export const MAX_HORIZON_RESPONSE_BYTES = 1024 * 1024;

export class HorizonRequestError extends Error {
  readonly kind: HorizonErrorKind;
  readonly status: number | null;
  readonly body: unknown;
  readonly retryAfterMs: number | null;

  constructor(message: string, options: {
    kind: HorizonErrorKind;
    status?: number;
    body?: unknown;
    retryAfterMs?: number | null;
  }) {
    super(message);
    this.name = "HorizonRequestError";
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.body = options.body;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export interface HorizonReadPolicy {
  /** Total attempts, including the first request. Ignored for non-read methods. */
  maxReadAttempts?: number;
  /** Test seam; production uses an abort-aware timer. */
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  /** Test seam for deterministic bounded jitter. */
  random?: () => number;
  /** Test seam for HTTP-date Retry-After parsing. */
  now?: () => number;
}

const DEFAULT_READ_ATTEMPTS = 3;
const MAX_READ_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 5_000;
const BASE_RETRY_DELAY_MS = 250;

function kindForStatus(status: number): HorizonErrorKind {
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500) return "validation";
  if (status >= 500) return "server";
  return "unknown";
}

function errorDetail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = body as { title?: unknown; detail?: unknown };
  if (typeof value.detail === "string" && value.detail) return value.detail;
  if (typeof value.title === "string" && value.title) return value.title;
  return null;
}

async function readJsonBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) return JSON.parse("");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let byteLength = 0;
  let rejectForAbort: ((reason?: unknown) => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectForAbort = reject;
  });
  const abortBody = () => {
    const reason = signal.reason ?? new Error("Horizon request was aborted.");
    void reader.cancel(reason).catch(() => undefined);
    rejectForAbort?.(reason);
  };
  if (signal.aborted) abortBody();
  else signal.addEventListener("abort", abortBody, { once: true });

  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_HORIZON_RESPONSE_BYTES) {
        void reader.cancel(new Error("Horizon response body exceeded the safe byte limit."))
          .catch(() => undefined);
        throw new HorizonRequestError("Horizon response body exceeded the safe byte limit.", {
          kind: "response_too_large",
          status: response.status,
        });
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    signal.removeEventListener("abort", abortBody);
    reader.releaseLock();
  }
}

function retryAfterMilliseconds(value: string | null, now: () => number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.ceil(Number(trimmed) * 1_000)));
  }
  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) return null;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, date - now()));
}

function retryableReadError(error: HorizonRequestError): boolean {
  return error.kind === "rate_limited" || error.kind === "server" || error.kind === "network";
}

function isIdempotentRead(init?: RequestInit): boolean {
  const method = (init?.method ?? "GET").toUpperCase();
  return method === "GET" || method === "HEAD";
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Horizon request was aborted."));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function requestHorizonJsonOnce<T>(
  url: string,
  init: RequestInit | undefined,
  signal: AbortSignal,
  now: () => number,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (error) {
    throw new HorizonRequestError(
      `Unable to reach Horizon: ${error instanceof Error ? error.message : "network request failed"}`,
      { kind: "network" },
    );
  }
  let body: unknown = null;
  let parseError: unknown = null;

  try {
    body = await readJsonBody(response, signal);
  } catch (error) {
    parseError = error;
    if (response.ok && error instanceof HorizonRequestError) throw error;
    // Once Horizon has returned an explicit HTTP error, the transport
    // outcome is no longer ambiguous. Preserve that status even when the
    // optional error body stalls or the caller stops waiting for it.
    if (signal.aborted && response.ok) {
      throw new HorizonRequestError(
        `Unable to reach Horizon: ${error instanceof Error ? error.message : "request aborted"}`,
        { kind: "network" },
      );
    }
  }

  if (!response.ok) {
    const detail = errorDetail(body);
    throw new HorizonRequestError(
      `Horizon request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      {
        kind: kindForStatus(response.status),
        status: response.status,
        body,
        retryAfterMs: retryAfterMilliseconds(response.headers.get("Retry-After"), now),
      },
    );
  }
  if (parseError) {
    throw new HorizonRequestError("Horizon returned a malformed JSON response.", {
      kind: "unknown",
      status: response.status,
    });
  }
  return body as T;
}

export async function getHorizonJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs?: number,
  policy?: HorizonReadPolicy,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Horizon request timed out.")),
    timeoutMs ?? 15_000,
  );
  const callerSignal = init?.signal;
  const abortFromCaller = () => controller.abort(
    callerSignal?.reason ?? new Error("Horizon request was aborted."),
  );
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const read = isIdempotentRead(init);
  const attempts = read
    ? Math.max(1, Math.min(MAX_READ_ATTEMPTS, policy?.maxReadAttempts ?? DEFAULT_READ_ATTEMPTS))
    : 1;
  const random = policy?.random ?? Math.random;
  const now = policy?.now ?? Date.now;
  const sleep = policy?.sleep ?? defaultSleep;

  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await requestHorizonJsonOnce<T>(url, init, controller.signal, now);
      } catch (error) {
        if (
          !(error instanceof HorizonRequestError) ||
          !retryableReadError(error) ||
          attempt >= attempts ||
          controller.signal.aborted ||
          callerSignal?.aborted
        ) {
          throw error;
        }
        const exponential = BASE_RETRY_DELAY_MS * (2 ** (attempt - 1));
        const jittered = Math.round(exponential * (1 + Math.max(0, Math.min(1, random()))));
        await sleep(error.retryAfterMs ?? jittered, controller.signal);
      }
    }
    throw new Error("Horizon request exhausted its retry policy.");
  } catch (error) {
    if (error instanceof HorizonRequestError) throw error;
    throw new HorizonRequestError(
      `Unable to reach Horizon: ${error instanceof Error ? error.message : "network request failed"}`,
      { kind: "network" },
    );
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}
