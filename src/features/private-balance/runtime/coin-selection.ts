import type { ShieldedNoteRecord } from './types';

const MAX_VALUE = (1n << 63n) - 1n;

interface AvailableNote {
  id: string;
  value: bigint;
  leafIndex: number;
}

export type PrivateCoinSelection =
  | {
      kind: 'selected';
      noteIds: string[];
      inputValue: bigint;
      changeValue: bigint;
    }
  | {
      kind: 'consolidation-required';
      availableValue: bigint;
      inputCount: number;
      actionCount: number;
    }
  | {
      kind: 'insufficient';
      availableValue: bigint;
      missingValue: bigint;
    };

export function parsePrivateAmount(raw: string, decimals = 7): bigint {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('Private asset decimals are invalid.');
  }
  const normalized = raw.trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(normalized)) {
    throw new Error('Private amount is invalid.');
  }
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) {
    throw new Error(`Private amount supports at most ${decimals} decimal places.`);
  }
  const value = BigInt(whole) * (10n ** BigInt(decimals)) +
    BigInt(fraction.padEnd(decimals, '0') || '0');
  if (value === 0n) throw new Error('Private amount must be greater than zero.');
  if (value > MAX_VALUE) throw new Error('Private amount exceeds the supported range.');
  return value;
}

function availableNotes(notes: readonly ShieldedNoteRecord[]): AvailableNote[] {
  return notes
    .filter(note => note.status === 'unspent')
    .map(note => {
      if (!/^[0-9a-f]{64}$/.test(note.id) || note.commitment !== note.id) {
        throw new Error('Private note identity is invalid.');
      }
      if (!/^[1-9][0-9]*$/.test(note.value)) {
        throw new Error('Private note value is invalid.');
      }
      const value = BigInt(note.value);
      if (value > MAX_VALUE) throw new Error('Private note value exceeds the supported range.');
      if (!Number.isSafeInteger(note.leafIndex) || note.leafIndex < 0) {
        throw new Error('Private note leaf index is invalid.');
      }
      return { id: note.id, value, leafIndex: note.leafIndex };
    })
    .sort((left, right) => {
      if (left.value !== right.value) return left.value < right.value ? -1 : 1;
      if (left.leafIndex !== right.leafIndex) return left.leafIndex - right.leafIndex;
      return left.id.localeCompare(right.id);
    });
}

export function selectPrivateNotes(
  notes: readonly ShieldedNoteRecord[],
  target: bigint,
): PrivateCoinSelection {
  if (target < 1n || target > MAX_VALUE) throw new Error('Private target is outside the supported range.');
  const available = availableNotes(notes);
  const total = available.reduce((sum, note) => sum + note.value, 0n);

  const single = available.find(note => note.value >= target);
  if (single) {
    return {
      kind: 'selected',
      noteIds: [single.id],
      inputValue: single.value,
      changeValue: single.value - target,
    };
  }

  let left = 0;
  let right = available.length - 1;
  let pair: [AvailableNote, AvailableNote] | null = null;
  let pairTotal = 0n;
  while (left < right) {
    const candidateTotal = available[left].value + available[right].value;
    if (candidateTotal >= target) {
      if (candidateTotal <= MAX_VALUE && (!pair || candidateTotal < pairTotal)) {
        pair = [available[left], available[right]];
        pairTotal = candidateTotal;
      }
      right -= 1;
    } else {
      left += 1;
    }
  }
  if (pair) {
    return {
      kind: 'selected',
      noteIds: pair.map(note => note.id),
      inputValue: pairTotal,
      changeValue: pairTotal - target,
    };
  }

  if (total < target) {
    return {
      kind: 'insufficient',
      availableValue: total,
      missingValue: target - total,
    };
  }

  let accumulated = 0n;
  let inputCount = 0;
  for (let index = available.length - 1; index >= 0 && accumulated < target; index -= 1) {
    accumulated += available[index].value;
    inputCount += 1;
  }
  return {
    kind: 'consolidation-required',
    availableValue: total,
    inputCount,
    actionCount: inputCount - 1,
  };
}
