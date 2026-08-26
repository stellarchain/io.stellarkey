export interface StorageIssue {
  kind: "corrupt" | "future";
  raw: string;
  message: string;
  version?: number;
}

export type StorageLoadResult<T> =
  | { kind: "absent" }
  | { kind: "ready"; value: T }
  | StorageIssue;

export function storageIssueOf<T>(result: StorageLoadResult<T>): StorageIssue | null {
  return result.kind === "corrupt" || result.kind === "future" ? result : null;
}
