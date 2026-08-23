export type HorizonErrorKind =
  | "not_found"
  | "rate_limited"
  | "validation"
  | "server"
  | "network"
  | "unknown";

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

export async function getHorizonJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Horizon request timed out.")), 15_000);
  const callerSignal = init?.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new HorizonRequestError(
      `Unable to reach Horizon: ${error instanceof Error ? error.message : "network request failed"}`,
      { kind: "network" },
    );
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Error responses are not guaranteed to contain JSON.
  }
  if (!response.ok) {
    const detail = errorDetail(body);
    throw new HorizonRequestError(
      `Horizon request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      { kind: kindForStatus(response.status), status: response.status, body },
    );
  }
  return body as T;
}
