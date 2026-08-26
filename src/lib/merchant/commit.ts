export type MerchantStorageErrorCode = "recovery_required" | "write_failed" | "conflict";

export class MerchantStorageError extends Error {
  readonly code: MerchantStorageErrorCode;

  constructor(code: MerchantStorageErrorCode) {
    super(code === "recovery_required"
      ? "Merchant data needs recovery before it can be changed."
      : code === "conflict"
        ? "Merchant data changed in another tab. The newer version has been loaded; try again."
        : "Merchant data could not be saved on this device. Free storage and try again.");
    this.name = "MerchantStorageError";
    this.code = code;
  }
}

export function commitMerchantUpdate<T>({
  current,
  update,
  locked = false,
  save,
  publish,
}: {
  current: T;
  update: T | ((current: T) => T);
  locked?: boolean;
  save: (next: T) => boolean;
  publish: (next: T) => void;
}): T {
  if (locked) throw new MerchantStorageError("recovery_required");
  const next = typeof update === "function" ? (update as (current: T) => T)(current) : update;
  if (!save(next)) throw new MerchantStorageError("write_failed");
  publish(next);
  return next;
}

export function isMerchantStorageError(error: unknown): error is MerchantStorageError {
  return error instanceof MerchantStorageError;
}
