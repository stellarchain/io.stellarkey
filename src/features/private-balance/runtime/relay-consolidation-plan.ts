import type { ShieldedNoteRecord } from './types';

const MAX_VALUE = (1n << 63n) - 1n;
const MAX_STEPS = 64;

export interface PrivateRelayConsolidationMerge {
  left: string;
  right: string;
  output: string;
  minimumOutputValue: string;
  maximumOutputValue: string;
}

/** Local intent only: never publish this trace or include it in relay messages. */
export interface PrivateRelayConsolidationPlan {
  amountAtomic: string;
  perStepMaxPrivateFeeAtomic: string;
  cumulativeMaxPrivateFeeAtomic: string;
  steps: number;
  inputNotes: { id: string; commitment: string; value: string }[];
  merges: PrivateRelayConsolidationMerge[];
  finalInputs: string[];
}

interface PlannedNote {
  reference: string;
  minimum: bigint;
  maximum: bigint;
  order: number;
}

function descendingValue(left: PlannedNote, right: PlannedNote): number {
  return left.minimum === right.minimum ? left.order - right.order : left.minimum > right.minimum ? -1 : 1;
}

/** Best lower-value pair whose WORST upper-value sum is still representable. */
function largestLegalPair(notes: readonly PlannedNote[]): [PlannedNote, PlannedNote] | null {
  const byMaximum = [...notes].sort((left, right) => left.maximum === right.maximum
    ? left.order - right.order : left.maximum < right.maximum ? -1 : 1);
  // Prefix top-two minima make exclusion of the current note O(1), including
  // when minimum-value and maximum-value ordering differ after cheaper fees.
  const prefixes: PlannedNote[][] = [];
  for (const note of byMaximum) {
    prefixes.push([...(prefixes.at(-1) ?? []), note].sort(descendingValue).slice(0, 2));
  }
  let best: [PlannedNote, PlannedNote] | null = null;
  for (const note of notes) {
    let low = 0;
    let high = byMaximum.length;
    const remaining = MAX_VALUE - note.maximum;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (byMaximum[middle].maximum <= remaining) low = middle + 1;
      else high = middle;
    }
    const partner = prefixes[low - 1]?.find(candidate => candidate !== note);
    if (!partner) continue;
    const pair: [PlannedNote, PlannedNote] = descendingValue(note, partner) <= 0 ? [note, partner] : [partner, note];
    const sum = pair[0].minimum + pair[1].minimum;
    const bestSum = best ? best[0].minimum + best[1].minimum : -1n;
    if (!best || sum > bestSum || (sum === bestSum &&
      (pair[0].order < best[0].order || (pair[0].order === best[0].order && pair[1].order < best[1].order)))) best = pair;
  }
  return best;
}

/**
 * Plan a largest-legal-pair consolidation strategy with a fee on EVERY
 * transaction, including the final send. Lower values assume every quote costs
 * the cap; upper values assume no fee, so cheaper quotes cannot overflow a
 * later fixed pair. This is conservative, not a global minimum-fee optimizer.
 * Original note identities and merge references prevent spending later arrivals
 * or substituting a different plan under the same approval.
 */
export function planPrivateRelayConsolidation(input: {
  notes: readonly ShieldedNoteRecord[];
  assetContractId: string;
  amountAtomic: bigint;
  perStepMaxPrivateFeeAtomic: bigint;
}): PrivateRelayConsolidationPlan {
  if (typeof input.amountAtomic !== 'bigint') throw new Error('Private relay consolidation amount is invalid.');
  if (typeof input.perStepMaxPrivateFeeAtomic !== 'bigint') throw new Error('Private relay consolidation fee is invalid.');
  const fee = input.perStepMaxPrivateFeeAtomic;
  const target = input.amountAtomic + fee;
  if (input.amountAtomic <= 0n || input.amountAtomic > MAX_VALUE || target > MAX_VALUE) {
    throw new Error('Private relay consolidation amount is outside the supported range.');
  }
  if (fee <= 0n || fee > MAX_VALUE) throw new Error('Private relay consolidation fee is invalid.');
  const originals = input.notes.filter(note => note.assetContractId === input.assetContractId && note.status === 'unspent');
  const byReference = new Map<string, ShieldedNoteRecord>();
  let available: PlannedNote[] = originals.map((note, order) => {
    if (typeof note.id !== 'string' || !/^[0-9a-f]{64}$/.test(note.id) ||
      typeof note.commitment !== 'string' || !/^[0-9a-f]{64}$/.test(note.commitment) ||
      typeof note.value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(note.value) || BigInt(note.value) > MAX_VALUE ||
      !Number.isSafeInteger(note.leafIndex) || note.leafIndex < 0) {
      throw new Error('Private relay consolidation note is invalid.');
    }
    const reference = `note:${note.id}`;
    if (byReference.has(reference)) throw new Error('Private relay consolidation contains duplicate notes.');
    byReference.set(reference, note);
    return { reference, minimum: BigInt(note.value), maximum: BigInt(note.value), order };
  });
  // Canonical tie-breaking must not depend on caller order or locale.
  available.sort((left, right) => {
    const leftNote = byReference.get(left.reference)!;
    const rightNote = byReference.get(right.reference)!;
    return leftNote.leafIndex - rightNote.leafIndex || (left.reference < right.reference ? -1 : left.reference > right.reference ? 1 : 0);
  });
  available.forEach((note, order) => { note.order = order; });
  const merges: PrivateRelayConsolidationMerge[] = [];
  const used = new Set<string>();
  const originalCount = available.length;
  while (true) {
    const single = available.filter(note => note.minimum >= target)
      .sort((left, right) => left.minimum === right.minimum ? left.order - right.order : left.minimum < right.minimum ? -1 : 1)[0];
    const pair = single ? null : largestLegalPair(available);
    const finalNotes = single ? [single] : pair && pair[0].minimum + pair[1].minimum >= target ? pair : null;
    if (finalNotes) {
      if (merges.length === 0) throw new Error('This private send does not need consolidation.');
      for (const note of finalNotes) used.add(note.reference);
      const steps = merges.length + 1;
      return {
        amountAtomic: input.amountAtomic.toString(), perStepMaxPrivateFeeAtomic: fee.toString(),
        cumulativeMaxPrivateFeeAtomic: (BigInt(steps) * fee).toString(), steps,
        inputNotes: [...byReference].filter(([reference]) => used.has(reference))
          .map(([, note]) => ({ id: note.id, commitment: note.commitment, value: note.value }))
          .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
        merges, finalInputs: finalNotes.map(note => note.reference),
      };
    }
    if (available.reduce((sum, note) => sum + note.minimum, 0n) < target || available.length < 2) {
      throw new Error('Private Balance is insufficient after the approved consolidation fees.');
    }
    if (merges.length + 2 > MAX_STEPS) throw new Error('Private relay consolidation exceeds the 64-step limit.');
    if (!pair) throw new Error('Private relay consolidation has no pair within the supported input upper bound.');
    const [left, right] = pair;
    const rest = available.filter(note => note !== left && note !== right);
    const minimum = left.minimum + right.minimum - fee;
    const maximum = left.maximum + right.maximum;
    if (maximum > MAX_VALUE) throw new Error('Private relay consolidation input upper bound exceeds the supported range.');
    if (minimum <= left.minimum || minimum <= 0n) {
      throw new Error('Private Balance is insufficient for a productive fee-paying consolidation.');
    }
    const output = `merge:${merges.length}`;
    used.add(left.reference);
    used.add(right.reference);
    merges.push({ left: left.reference, right: right.reference, output,
      minimumOutputValue: minimum.toString(), maximumOutputValue: maximum.toString() });
    available = [...rest, { reference: output, minimum, maximum, order: originalCount + merges.length }];
  }
}
