import type { PrivateChainedSendApproval, PrivateChainedSendDraft } from './chained-send';
import type { PrivateRelayConsolidationPlan } from './relay-consolidation-plan';
import type { PrivateBalanceDurableState, ShieldedNoteRecord } from './types';
import type { PrivateBalanceStorageScope } from '../../../lib/private-balance-bootstrap';

export function privateRelayChainContextKey(scope: PrivateBalanceStorageScope, assetContractId: string): string {
  return JSON.stringify([scope.accountId, scope.networkId, scope.realmId, scope.poolId, scope.deploymentBindingHash, assetContractId]);
}

export interface PrivateRelayChainApproval extends PrivateChainedSendApproval {
  submissionMode: 'relay';
  contextKey: string;
  assetContractId: string;
  assetIndex: number;
  draft: PrivateChainedSendDraft;
  plan: PrivateRelayConsolidationPlan;
}

export interface PrivateRelayChainStep {
  actionId: string;
  step: number; // Zero-based, including the final send.
  actionField: string;
  inputNoteIds: string[];
  outputCommitment: string;
  amountAtomic: string;
  recipientAddress: string;
  privateFeeAtomic: string;
  networkFeeStroops: string;
  quoteId: string;
  requestId: string;
  sourceAccount: string;
  expiresAtSeconds: number;
}

export interface PrivateRelayChainJournal {
  approval: PrivateRelayChainApproval;
  authorized: PrivateRelayChainStep[];
  privateFeeAtomic: string;
  networkFeeStroops: string;
  selfAddresses: string[];
}

const HEX = /^[0-9a-f]{64}$/;
const integer = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,20})$/.test(value);
const boundedText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const MAX = (1n << 63n) - 1n;

export function assertPrivateRelayChainApproval(approval: PrivateRelayChainApproval): void {
  const plan = approval?.plan;
  if (!approval || approval.submissionMode !== 'relay' || !boundedText(approval.id) || typeof approval.contextKey !== 'string' || approval.contextKey.length > 1024 || approval.contextKey.length === 0 ||
    !boundedText(approval.assetContractId) || !Number.isSafeInteger(approval.assetIndex) || approval.assetIndex < 0 ||
    !approval.draft || approval.draft.kind !== 'transfer' || !boundedText(approval.draft.recipientAddress) ||
    !boundedText(approval.draft.amount) || (approval.draft.memo !== undefined && (typeof approval.draft.memo !== 'string' || new TextEncoder().encode(approval.draft.memo.trim()).length > 32)) ||
    !Number.isSafeInteger(approval.steps) || approval.steps < 2 || approval.steps > 64 ||
    !Number.isSafeInteger(approval.expiresAtSeconds) || approval.expiresAtSeconds <= 0 ||
    !integer(approval.perStepMaxFeeStroops) || !integer(approval.cumulativeMaxFeeStroops) ||
    BigInt(approval.cumulativeMaxFeeStroops) !== BigInt(approval.perStepMaxFeeStroops) * BigInt(approval.steps) ||
    !plan || plan.steps !== approval.steps || !integer(plan.amountAtomic) || BigInt(plan.amountAtomic) <= 0n ||
    !integer(plan.perStepMaxPrivateFeeAtomic) || BigInt(plan.perStepMaxPrivateFeeAtomic) <= 0n ||
    !integer(plan.cumulativeMaxPrivateFeeAtomic) || BigInt(plan.cumulativeMaxPrivateFeeAtomic) !== BigInt(plan.perStepMaxPrivateFeeAtomic) * BigInt(approval.steps) ||
    !Array.isArray(plan.inputNotes) || plan.inputNotes.length > 65 || !Array.isArray(plan.merges) || plan.merges.length !== approval.steps - 1 ||
    !Array.isArray(plan.finalInputs) || plan.finalInputs.length < 1 || plan.finalInputs.length > 2) {
    throw new Error('Private relay chain approval is invalid.');
  }
  const values = new Map<string, { min: bigint; max: bigint }>();
  for (const note of plan.inputNotes) {
    if (!HEX.test(note.id) || !HEX.test(note.commitment) || !integer(note.value) || BigInt(note.value) <= 0n || BigInt(note.value) > MAX || values.has(`note:${note.id}`)) throw new Error('Private relay chain input is invalid.');
    values.set(`note:${note.id}`, { min: BigInt(note.value), max: BigInt(note.value) });
  }
  for (const [index, merge] of plan.merges.entries()) {
    const left = values.get(merge.left); const right = values.get(merge.right);
    if (!left || !right || merge.left === merge.right || merge.output !== `merge:${index}` ||
      !integer(merge.minimumOutputValue) || !integer(merge.maximumOutputValue)) throw new Error('Private relay merge trace is invalid.');
    const min = left.min + right.min - BigInt(plan.perStepMaxPrivateFeeAtomic);
    const max = left.max + right.max;
    if (min <= 0n || max > MAX || min.toString() !== merge.minimumOutputValue || max.toString() !== merge.maximumOutputValue) throw new Error('Private relay merge bounds are invalid.');
    values.delete(merge.left); values.delete(merge.right); values.set(merge.output, { min, max });
  }
  if (new Set(plan.finalInputs).size !== plan.finalInputs.length || plan.finalInputs.some(ref => !values.has(ref))) throw new Error('Private relay final inputs are invalid.');
  const total = plan.finalInputs.reduce((sum, ref) => sum + values.get(ref)!.min, 0n);
  if (total < BigInt(plan.amountAtomic) + BigInt(plan.perStepMaxPrivateFeeAtomic) || plan.finalInputs.reduce((sum, ref) => sum + values.get(ref)!.max, 0n) > MAX) throw new Error('Private relay final amount is invalid.');
}

export function confirmPrivateRelayMerge(
  approval: PrivateRelayChainApproval, step: PrivateRelayChainStep,
  state: Pick<PrivateBalanceDurableState, 'activities' | 'notes' | 'pendingActions'>,
): ShieldedNoteRecord | null {
  const activity = state.activities.find(item => item.id === step.actionField && item.assetContractId === approval.assetContractId && item.outputCommitments.includes(step.outputCommitment));
  if (!activity || state.pendingActions.some(item => item.id === step.actionId)) return null;
  const notes = state.notes.filter(note => note.commitment === step.outputCommitment && note.assetContractId === approval.assetContractId && note.assetIndex === approval.assetIndex &&
    note.actionIndex === activity.actionIndex && note.status === 'unspent' && note.value === step.amountAtomic);
  return notes.length === 1 ? notes[0] : null;
}

export function resolvePrivateRelayChainInputs(journal: PrivateRelayChainJournal, state: Pick<PrivateBalanceDurableState, 'activities' | 'notes' | 'pendingActions'>): ShieldedNoteRecord[] {
  const { approval } = journal;
  const index = journal.authorized.length;
  const merge = approval.plan.merges[index];
  const references = merge ? [merge.left, merge.right] : approval.plan.finalInputs;
  return references.map(reference => {
    if (reference.startsWith('note:')) {
      const original = approval.plan.inputNotes.find(note => `note:${note.id}` === reference);
      const note = state.notes.find(note => original && note.id === original.id && note.commitment === original.commitment && note.value === original.value && note.assetContractId === approval.assetContractId && note.assetIndex === approval.assetIndex && note.status === 'unspent');
      if (note) return note;
    } else {
      const step = journal.authorized[Number(reference.slice(6))];
      const note = step && confirmPrivateRelayMerge(approval, step, state);
      if (note) return note;
    }
    throw new Error('An exact approved private relay input is unavailable. Review the chain again.');
  });
}

export function advancePrivateRelayChain(journal: PrivateRelayChainJournal, step: PrivateRelayChainStep, nowSeconds: number, state?: Pick<PrivateBalanceDurableState, 'activities' | 'notes' | 'pendingActions'>): PrivateRelayChainJournal {
  const { approval } = journal;
  assertPrivateRelayChainApproval(approval);
  if (nowSeconds >= approval.expiresAtSeconds || nowSeconds >= step.expiresAtSeconds) throw new Error('Private relay chain approval expired.');
  if (step.step !== journal.authorized.length || step.step >= approval.steps || journal.authorized.some(item => item.actionId === step.actionId || item.actionField === step.actionField || item.quoteId === step.quoteId)) throw new Error('Private relay chain step is duplicate or out of order.');
  if (!boundedText(step.actionId) || !HEX.test(step.actionField) || !HEX.test(step.outputCommitment) || !HEX.test(step.quoteId) || !HEX.test(step.requestId) ||
    !boundedText(step.sourceAccount) || !boundedText(step.recipientAddress) || !Number.isSafeInteger(step.expiresAtSeconds) ||
    !Array.isArray(step.inputNoteIds) || step.inputNoteIds.length < 1 || step.inputNoteIds.length > 2 || new Set(step.inputNoteIds).size !== step.inputNoteIds.length || step.inputNoteIds.some(id => !HEX.test(id)) ||
    !integer(step.amountAtomic) || !integer(step.privateFeeAtomic) || !integer(step.networkFeeStroops) ||
    BigInt(step.privateFeeAtomic) <= 0n || BigInt(step.privateFeeAtomic) > BigInt(approval.plan.perStepMaxPrivateFeeAtomic) ||
    BigInt(step.networkFeeStroops) > BigInt(approval.perStepMaxFeeStroops)) throw new Error('Private relay chain step or fee is invalid.');
  const merge = approval.plan.merges[step.step];
  const references = merge ? [merge.left, merge.right] : approval.plan.finalInputs;
  const ids = state ? resolvePrivateRelayChainInputs(journal, { ...state, notes: state.notes.map(note => step.inputNoteIds.includes(note.id) && note.status === 'reserved' ? { ...note, status: 'unspent' } : note) }).map(note => note.id)
    : references.map(ref => { if (!ref.startsWith('note:')) throw new Error('Private relay merge confirmation is required.'); return ref.slice(5); });
  if (ids.length !== step.inputNoteIds.length || ids.some((id, index) => id !== step.inputNoteIds[index])) throw new Error('Private relay chain inputs differ from the approved step.');
  if (merge) {
    const value = references.reduce((sum, ref) => sum + BigInt(ref.startsWith('note:') ? approval.plan.inputNotes.find(note => `note:${note.id}` === ref)!.value : journal.authorized[Number(ref.slice(6))].amountAtomic), 0n) - BigInt(step.privateFeeAtomic);
    if (value.toString() !== step.amountAtomic) throw new Error('Private relay merge amount is invalid.');
  } else if (step.amountAtomic !== approval.plan.amountAtomic || step.recipientAddress !== approval.draft.recipientAddress) throw new Error('Private relay final intent changed.');
  const privateFee = BigInt(journal.privateFeeAtomic) + BigInt(step.privateFeeAtomic);
  const networkFee = BigInt(journal.networkFeeStroops) + BigInt(step.networkFeeStroops);
  if (privateFee > BigInt(approval.plan.cumulativeMaxPrivateFeeAtomic) || networkFee > BigInt(approval.cumulativeMaxFeeStroops)) throw new Error('Private relay cumulative fee cap exceeded.');
  return { approval, authorized: [...journal.authorized, structuredClone(step)], privateFeeAtomic: privateFee.toString(), networkFeeStroops: networkFee.toString(), selfAddresses: [...journal.selfAddresses] };
}

export function isPrivateRelayChainJournal(value: unknown): value is PrivateRelayChainJournal {
  try {
    const journal = value as PrivateRelayChainJournal;
    assertPrivateRelayChainApproval(journal.approval);
    return Array.isArray(journal.selfAddresses) && journal.selfAddresses.length <= journal.approval.steps - 1 && journal.selfAddresses.every(boundedText) && new Set(journal.selfAddresses).size === journal.selfAddresses.length &&
      Array.isArray(journal.authorized) && journal.authorized.length <= journal.approval.steps && journal.authorized.every((step, index) =>
      step.step === index && boundedText(step.actionId) && HEX.test(step.actionField) && HEX.test(step.outputCommitment) && HEX.test(step.quoteId) && HEX.test(step.requestId) &&
      boundedText(step.recipientAddress) && boundedText(step.sourceAccount) && Number.isSafeInteger(step.expiresAtSeconds) &&
      Array.isArray(step.inputNoteIds) && step.inputNoteIds.length > 0 && step.inputNoteIds.length <= 2 && step.inputNoteIds.every(id => HEX.test(id)) &&
      integer(step.amountAtomic) && integer(step.privateFeeAtomic) && integer(step.networkFeeStroops) &&
      BigInt(step.privateFeeAtomic) <= BigInt(journal.approval.plan.perStepMaxPrivateFeeAtomic) && BigInt(step.networkFeeStroops) <= BigInt(journal.approval.perStepMaxFeeStroops)) &&
      integer(journal.privateFeeAtomic) && integer(journal.networkFeeStroops) &&
      journal.authorized.reduce((sum, step) => sum + BigInt(step.privateFeeAtomic), 0n).toString() === journal.privateFeeAtomic &&
      journal.authorized.reduce((sum, step) => sum + BigInt(step.networkFeeStroops), 0n).toString() === journal.networkFeeStroops &&
      BigInt(journal.privateFeeAtomic) <= BigInt(journal.approval.plan.cumulativeMaxPrivateFeeAtomic) && BigInt(journal.networkFeeStroops) <= BigInt(journal.approval.cumulativeMaxFeeStroops);
  } catch { return false; }
}
