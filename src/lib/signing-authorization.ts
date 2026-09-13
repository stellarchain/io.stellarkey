export interface SigningAuthorizationRequest {
  id: number;
  label: string;
  purpose?: "sensitive-setting";
  requiresUserGestureContinuation?: boolean;
}

export class SigningAuthorizationCancelledError extends Error {
  constructor(message = "Signing cancelled.") {
    super(message);
    this.name = "SigningAuthorizationCancelledError";
  }
}

/** A local operation's captured authority, never a mutable global signer. */
export function captureSigningContextAuthorization(isCurrent: () => boolean): () => void {
  const assertCurrent = () => {
    if (!isCurrent()) {
      throw new SigningAuthorizationCancelledError("Wallet context changed. Review the payment again before signing.");
    }
  };
  assertCurrent();
  return assertCurrent;
}

interface PendingSigningAuthorization extends SigningAuthorizationRequest {
  resolve: () => void;
  reject: (error: Error) => void;
}

export interface SigningAuthorizationGate {
  readonly pending: SigningAuthorizationRequest | null;
  request: (
    label: string,
    options?: {
      purpose?: "sensitive-setting";
      requiresUserGestureContinuation?: boolean;
    },
  ) => Promise<void>;
  approve: (requestId: number) => void;
  cancel: (message?: string) => void;
}

/**
 * Serializes password approval for transaction signing. The gate stores no
 * credential and grants exactly one pending action after its caller verifies
 * the password independently.
 */
export function createSigningAuthorizationGate(
  onChange: (request: SigningAuthorizationRequest | null) => void,
): SigningAuthorizationGate {
  let nextId = 1;
  let pending: PendingSigningAuthorization | null = null;

  const snapshot = (): SigningAuthorizationRequest | null => pending
    ? {
        id: pending.id,
        label: pending.label,
        ...(pending.purpose ? { purpose: pending.purpose } : {}),
        ...(pending.requiresUserGestureContinuation
          ? { requiresUserGestureContinuation: true }
          : {}),
      }
    : null;

  const publish = () => {
    onChange(snapshot());
  };

  return {
    get pending() {
      return snapshot();
    },
    request(label, options) {
      if (pending) {
        return Promise.reject(
          new Error("Finish the current signing approval before starting another transaction."),
        );
      }
      const normalizedLabel = label.trim() || "Transaction";
      return new Promise<void>((resolve, reject) => {
        pending = {
          id: nextId,
          label: normalizedLabel,
          ...(options?.purpose ? { purpose: options.purpose } : {}),
          ...(options?.requiresUserGestureContinuation
            ? { requiresUserGestureContinuation: true }
            : {}),
          resolve,
          reject,
        };
        nextId += 1;
        publish();
      });
    },
    approve(requestId) {
      if (!pending) throw new Error("There is no signing approval to complete.");
      if (pending.id !== requestId) {
        throw new Error("This signing approval is no longer current.");
      }
      const approved = pending;
      pending = null;
      publish();
      approved.resolve();
    },
    cancel(message) {
      if (!pending) return;
      const cancelled = pending;
      pending = null;
      publish();
      cancelled.reject(new SigningAuthorizationCancelledError(message));
    },
  };
}
