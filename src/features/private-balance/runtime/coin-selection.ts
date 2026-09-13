import { comparePrivateIndices, isPrivateIndex } from './indices';
import type { ShieldedNoteRecord } from './types';

const MAX_VALUE = (1n << 63n) - 1n;

interface AvailableNote {
  id: string;
  value: bigint;
  leafIndex: bigint;
}

export interface PrivateWithdrawalStep {
  noteIds: string[];
  inputValueStroops: string;
  amountStroops: string;
  fullInputExit: boolean;
}

/** Disjoint inputs: no withdrawal step depends on creating a consolidation note. */
export function planPrivateWithdrawal(
  notes: readonly ShieldedNoteRecord[],
  target: bigint,
): PrivateWithdrawalStep[] {
  if (typeof target !== 'bigint' || target < 1n) throw new Error('Private withdrawal target is invalid.');
  const available = availableNotes(notes).reverse();
  if (new Set(available.map(note => note.id)).size !== available.length) {
    throw new Error('Private note identity is duplicated.');
  }
  if (available.reduce((sum, note) => sum + note.value, 0n) < target) {
    throw new Error('Private balance is insufficient.');
  }
  const steps: PrivateWithdrawalStep[] = [];
  let remaining = target;
  for (let index = 0; index < available.length && remaining > 0n;) {
    const selected = [available[index++]];
    let value = selected[0].value;
    const next = available[index];
    if (value < remaining && next && value + next.value <= MAX_VALUE) {
      selected.push(next);
      value += next.value;
      index += 1;
    }
    const amount = value < remaining ? value : remaining;
    steps.push({
      noteIds: selected.map(note => note.id),
      inputValueStroops: value.toString(),
      amountStroops: amount.toString(),
      fullInputExit: value === amount,
    });
    remaining -= amount;
  }
  return steps;
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

export function parsePrivateAmount(raw: string, decimals = 7, options: { aggregateWithdrawal?: boolean } = {}): bigint {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('Private asset decimals are invalid.');
  }
  const normalized = raw.trim();
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(normalized)) {
    throw new Error('Private amount is invalid.');
  }
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) {
    throw new Error(`Private amount supports at most ${decimals} decimal places.`);
  }
  const value = BigInt(whole) * (10n ** BigInt(decimals)) +
    BigInt(fraction.padEnd(decimals, '0') || '0');
  if (value === 0n) throw new Error('Private amount must be greater than zero.');
  const maximum = options.aggregateWithdrawal ? (1n << 127n) - 1n : MAX_VALUE;
  if (value > maximum) throw new Error('Private amount exceeds the supported range.');
  return value;
}

function availableNotes(notes: readonly ShieldedNoteRecord[]): AvailableNote[] {
  return notes
    .filter(note => note.status === 'unspent')
    .map(note => {
      if (!/^[0-9a-f]{64}$/.test(note.id) || !/^[0-9a-f]{64}$/.test(note.commitment)) {
        throw new Error('Private note identity is invalid.');
      }
      if (!/^[1-9][0-9]*$/.test(note.value)) {
        throw new Error('Private note value is invalid.');
      }
      const value = BigInt(note.value);
      if (value > MAX_VALUE) throw new Error('Private note value exceeds the supported range.');
      if (!isPrivateIndex(note.leafIndex)) {
        throw new Error('Private note leaf index is invalid.');
      }
      return { id: note.id, value, leafIndex: note.leafIndex };
    })
    .sort((left, right) => {
      if (left.value !== right.value) return left.value < right.value ? -1 : 1;
      if (left.leafIndex !== right.leafIndex) return comparePrivateIndices(left.leafIndex, right.leafIndex);
      return left.id.localeCompare(right.id);
    });
}

export function selectPrivateNotes(
  notes: readonly ShieldedNoteRecord[],
  target: bigint,
  options: { preferExact?: boolean } = {},
): PrivateCoinSelection {
  if (target < 1n || target > MAX_VALUE) throw new Error('Private target is outside the supported range.');
  const available = availableNotes(notes);
  const total = available.reduce((sum, note) => sum + note.value, 0n);

  const single = available.find(note => note.value >= target);
  if (single && (!options.preferExact || single.value === target)) {
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
  if (single && pairTotal !== target) {
    return { kind: 'selected', noteIds: [single.id], inputValue: single.value, changeValue: single.value - target };
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
