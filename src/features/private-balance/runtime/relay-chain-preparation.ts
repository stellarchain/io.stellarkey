import { decodePrivateAddress } from '@stellarkey/private-balance';
import type { PrivateBalanceStorageScope } from '../../../lib/private-balance-bootstrap';
import type { PrivateActionDraft, PrivateRelayChainPreparation } from './action-flow';
import { parsePrivateAmount } from './coin-selection';
import { privateRelayChainContextKey, resolvePrivateRelayChainInputs } from './relay-chain-policy';
import type { PrivateBalanceDurableState } from './types';

export async function validatePrivateRelayChainPreparation(input: {
  state: PrivateBalanceDurableState; scope: PrivateBalanceStorageScope;
  assetContractId: string; assetIndex: number; assetDecimals: number; networkPassphrase: string;
  draft: PrivateActionDraft; chain: PrivateRelayChainPreparation; nowSeconds: number;
  deriveOwnAddress(diversifier: Uint8Array): Promise<string>;
}): Promise<{ noteIds: string[]; amount: bigint; recipientAddress: string }> {
  const journal = input.state.relayChainedApproval;
  if (!journal || journal.approval.id !== input.chain.approvalId || journal.authorized.length !== input.chain.step ||
    journal.approval.assetContractId !== input.assetContractId || journal.approval.assetIndex !== input.assetIndex ||
    journal.approval.contextKey !== privateRelayChainContextKey(input.scope, input.assetContractId) || input.nowSeconds >= journal.approval.expiresAtSeconds ||
    (input.draft.kind !== 'consolidate' && input.draft.kind !== 'transfer') || !input.draft.relay) throw new Error('Private relay chain context, route or step changed.');
  const fee = BigInt(input.draft.relay.feeAtomic);
  if (fee <= 0n || fee > BigInt(journal.approval.plan.perStepMaxPrivateFeeAtomic)) throw new Error('Private relay fee exceeds the approved cap.');
  const notes = resolvePrivateRelayChainInputs(journal, input.state);
  const isFinal = input.chain.step === journal.approval.steps - 1;
  if (isFinal) {
    const draft = input.draft;
    if (draft.kind !== 'transfer' || input.chain.selfAddress !== undefined || draft.recipientAddress !== journal.approval.draft.recipientAddress ||
      parsePrivateAmount(draft.amount, input.assetDecimals).toString() !== journal.approval.plan.amountAtomic ||
      (draft.memo?.trim() ?? '') !== (journal.approval.draft.memo?.trim() ?? '')) throw new Error('Private relay final send intent changed.');
    return { noteIds: notes.map(note => note.id), amount: BigInt(journal.approval.plan.amountAtomic), recipientAddress: draft.recipientAddress };
  }
  if (input.draft.kind !== 'consolidate' || !input.chain.selfAddress || notes.length !== 2) throw new Error('Private relay consolidation step is invalid.');
  const address = input.chain.selfAddress;
  const binding = Uint8Array.from(input.scope.deploymentBindingHash.match(/../g) ?? [], byte => parseInt(byte, 16));
  const decoded = await decodePrivateAddress(address, input.networkPassphrase.startsWith('Public ') ? 'skpay_' : 'tskpay_', binding);
  const diversifier = Array.from(decoded.diversifier, byte => byte.toString(16).padStart(2, '0')).join('');
  if (journal.selfAddresses[input.chain.step] !== address || address === input.state.privateAddress || !input.state.issuedAddressDiversifiers?.includes(diversifier) ||
    journal.authorized.some(step => step.recipientAddress === address) || await input.deriveOwnAddress(decoded.diversifier) !== address) throw new Error('Private relay consolidation must use its fresh full owned address.');
  const amount = notes.reduce((sum, note) => sum + BigInt(note.value), 0n) - fee;
  const bounds = journal.approval.plan.merges[input.chain.step];
  if (amount <= 0n || amount < BigInt(bounds.minimumOutputValue) || amount > BigInt(bounds.maximumOutputValue)) throw new Error('Private relay consolidation output exceeds the approved bounds.');
  return { noteIds: notes.map(note => note.id), amount, recipientAddress: address };
}
