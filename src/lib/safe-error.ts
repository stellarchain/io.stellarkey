const SAFE_REFERENCE = /^[A-Za-z0-9_-]{1,96}$/;

export interface SafeUnexpectedError {
  title: "Something went wrong";
  description: string;
  reference: string | null;
  diagnostic: {
    code: "wallet-render-error";
    reference?: string;
  };
}

/**
 * Converts an unknown render failure into the only information the global UI
 * and console may expose. Error messages and enumerable properties are never
 * inspected because they can contain wallet, transaction, or proof material.
 */
export function safeUnexpectedError(cause: unknown): SafeUnexpectedError {
  const candidate = cause && typeof cause === "object" && "digest" in cause
    ? (cause as { digest?: unknown }).digest
    : null;
  const reference = typeof candidate === "string" && SAFE_REFERENCE.test(candidate)
    ? candidate
    : null;

  return {
    title: "Something went wrong",
    description:
      "StellarKey could not finish this view. Try again first; if it repeats, reload the app and verify any pending transaction in Activity before retrying it.",
    reference,
    diagnostic: reference
      ? { code: "wallet-render-error", reference }
      : { code: "wallet-render-error" },
  };
}
