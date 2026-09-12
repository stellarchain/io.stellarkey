/** Compatibility-only validation for encrypted records and backups from before relay removal.
 * No creation, authorization, continuation, signing, transport or execution lives here. */
import type { PrivateBalanceStorageScope } from '../../../lib/private-balance-bootstrap';

export function legacyPrivateRelayChainContextKey(scope: PrivateBalanceStorageScope, assetContractId: string): string {
  return JSON.stringify([scope.accountId, scope.networkId, scope.realmId, scope.poolId, scope.deploymentBindingHash, assetContractId]);
}

export interface LegacyPrivateRelayChainApproval {
  id: string;
  steps: number;
  perStepMaxFeeStroops: string;
  cumulativeMaxFeeStroops: string;
  expiresAtSeconds: number;
  submissionMode: 'relay';
  contextKey: string;
  assetContractId: string;
  assetIndex: number;
  draft: { kind: 'transfer'; amount: string; recipientAddress: string; memo?: string };
  plan: LegacyPrivateRelayConsolidationPlan;
}

export interface LegacyPrivateRelayChainStep {
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

export interface LegacyPrivateRelayChainJournal {
  approval: LegacyPrivateRelayChainApproval;
  authorized: LegacyPrivateRelayChainStep[];
  privateFeeAtomic: string;
  networkFeeStroops: string;
  selfAddresses: string[];
}

const HEX = /^[0-9a-f]{64}$/;
const integer = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,20})$/.test(value);
const boundedText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const MAX = (1n << 63n) - 1n;

function assertLegacyPrivateRelayChainApproval(approval: LegacyPrivateRelayChainApproval): void {
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

export function isLegacyPrivateRelayChainJournal(value: unknown): value is LegacyPrivateRelayChainJournal {
  try {
    const journal = value as LegacyPrivateRelayChainJournal;
    assertLegacyPrivateRelayChainApproval(journal.approval);
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

export interface LegacyPrivateRelayConsolidationMerge {
  left: string;
  right: string;
  output: string;
  minimumOutputValue: string;
  maximumOutputValue: string;
}

/** Archived shape only; never used to create or execute a plan. */
export interface LegacyPrivateRelayConsolidationPlan {
  amountAtomic: string;
  perStepMaxPrivateFeeAtomic: string;
  cumulativeMaxPrivateFeeAtomic: string;
  steps: number;
  inputNotes: { id: string; commitment: string; value: string }[];
  merges: LegacyPrivateRelayConsolidationMerge[];
  finalInputs: string[];
}
