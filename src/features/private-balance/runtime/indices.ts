/** Protocol positions/counters never pass through a JavaScript Number. */
export const MAX_PRIVATE_INDEX = (1n << 128n) - 1n;

export function isPrivateIndex(value: unknown): value is bigint {
  return typeof value === 'bigint' && value >= 0n && value <= MAX_PRIVATE_INDEX;
}

export function parsePrivateIndex(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,38})$/.test(value)) {
    throw new Error('Invalid private index');
  }
  const index = BigInt(value);
  if (!isPrivateIndex(index)) throw new Error('Invalid private index');
  return index;
}

export function comparePrivateIndices(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Convert only a bounded local batch length, never a global position. */
export function privateBatchLength(remaining: bigint, maximum: number): number {
  if (!isPrivateIndex(remaining) || !Number.isSafeInteger(maximum) || maximum < 0) {
    throw new Error('Invalid private batch range');
  }
  return remaining < BigInt(maximum) ? Number(remaining) : maximum;
}

export function stringifyPrivateIndices(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== 'bigint') return item;
    if (!isPrivateIndex(item)) throw new Error('Invalid private index');
    return item.toString();
  });
}

export function parsePrivateIndices(raw: string, fields: readonly string[]): unknown {
  const names = new Set(fields);
  return JSON.parse(raw, (key, value: unknown) => (
    names.has(key) && value !== null ? parsePrivateIndex(value) : value
  ));
}
