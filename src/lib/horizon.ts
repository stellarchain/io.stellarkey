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

  constructor(message: string, options: { kind: HorizonErrorKind; status?: number; body?: unknown }) {
    super(message);
    this.name = "HorizonRequestError";
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.body = options.body;
  }
}

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

export async function getHorizonJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs?: number,
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

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let body: unknown = null;
    let parseError: unknown = null;

    try {
      body = await readJsonBody(response, controller.signal);
    } catch (error) {
      parseError = error;
      if (response.ok && error instanceof HorizonRequestError) throw error;
      // Once Horizon has returned an explicit HTTP error, the transport
      // outcome is no longer ambiguous. Preserve that status even when the
      // optional error body stalls or the caller stops waiting for it.
      if (controller.signal.aborted && response.ok) throw error;
    }

    if (!response.ok) {
      const detail = errorDetail(body);
      throw new HorizonRequestError(
        `Horizon request failed (${response.status})${detail ? `: ${detail}` : ""}`,
        { kind: kindForStatus(response.status), status: response.status, body },
      );
    }
    if (parseError) {
      throw new HorizonRequestError("Horizon returned a malformed JSON response.", {
        kind: "unknown",
        status: response.status,
      });
    }
    return body as T;
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
