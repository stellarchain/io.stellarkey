export interface StorageIssue {
  kind: "corrupt" | "future" | "unavailable" | "erasure-incomplete";
  raw: string;
  message: string;
  version?: number;
}

export type StorageLoadResult<T> =
  | { kind: "absent" }
  | { kind: "ready"; value: T }
  | StorageIssue;
