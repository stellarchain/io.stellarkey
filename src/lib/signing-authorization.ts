export interface SigningAuthorizationRequest {
  id: number;
  label: string;
  requiresUserGestureContinuation?: boolean;
}

export class SigningAuthorizationCancelledError extends Error {
  constructor(message = "Signing cancelled.") {
    super(message);
    this.name = "SigningAuthorizationCancelledError";
  }
}

interface PendingSigningAuthorization extends SigningAuthorizationRequest {
  resolve: () => void;
  reject: (error: Error) => void;
}

export interface SigningAuthorizationGate {
  readonly pending: SigningAuthorizationRequest | null;
  request: (
    label: string,
    options?: { requiresUserGestureContinuation?: boolean },
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
