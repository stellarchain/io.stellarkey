export const MAX_BACKUP_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_CONTACTS_FILE_BYTES = 1024 * 1024;
export const MAX_KEYSTORE_FILE_BYTES = 1024 * 1024;

interface TextFileLike {
  readonly size: number;
  text(): Promise<string>;
}

const encoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export async function readBoundedTextFile(
  file: TextFileLike,
  maxBytes: number,
  label: string,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Import size limit is invalid.");
  }
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > maxBytes) {
    throw new Error(`${label} is too large. The maximum size is ${Math.ceil(maxBytes / 1024 / 1024)} MiB.`);
  }
  const text = await file.text();
  if (utf8ByteLength(text) > maxBytes) {
    throw new Error(`${label} is too large. The maximum size is ${Math.ceil(maxBytes / 1024 / 1024)} MiB.`);
  }
  return text;
}
