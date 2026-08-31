import {
  ActionKind,
  MerkleNodeStore,
  bytesToBigint,
  computeCommitment,
  computeContextHash,
  computeAssetField,
  computeNullifier,
  computePublicSignals,
  createOutputPackage,
  decodePrivateAddress,
  deriveDiversifiedAddressKeys,
  encodeNotePlaintext,
  randomBytes32,
  sampleNonzeroField,
  type ActionModel,
  type ExpandedSpendingKey,
} from '@stellarkey/private-balance';
import { StrKey } from '@stellar/stellar-sdk';
import type { ShieldedNoteRecord } from '../runtime/types';
import type { PrivateBalanceKeyContext } from './messages';

const MAX_VALUE = (1n << 63n) - 1n;
const ZERO_32 = new Uint8Array(32);
const ZERO_DIVERSIFIER = new Uint8Array(4);
const ZERO_ENVELOPE = new Uint8Array(181);

export interface PublicAddressPayload {
  kind: number;
  payload: Uint8Array;
}

interface DepositIntent {
  kind: 'deposit';
  assetContractId: string;
  publicValue: string;
  depositSource: PublicAddressPayload;
  memo?: Uint8Array;
}

interface TransferIntent {
  kind: 'transfer';
  assetContractId: string;
  amount: string;
  recipientAddress: string;
  selectedNoteIds: string[];
  anchorRoot: Uint8Array;
  anchorExpiresAtLedger: number;
  memo?: Uint8Array;
  relayerFee: string;
  relayer: PublicAddressPayload;
}

interface WithdrawIntent {
  kind: 'withdraw';
  assetContractId: string;
  publicValue: string;
  publicRecipient: PublicAddressPayload;
  selectedNoteIds: string[];
  anchorRoot: Uint8Array;
  anchorExpiresAtLedger: number;
  relayerFee: string;
  relayer: PublicAddressPayload;
}

export type BuildActionIntent = DepositIntent | TransferIntent | WithdrawIntent;

type CircuitInputs = Record<string, string | string[] | string[][]>;

export interface PreparedPrivateAction {
  action: ActionModel;
  actionField: Uint8Array;
  actionBinding: Uint8Array;
  publicSignals: string[];
  circuitInputs: CircuitInputs;
  reservedNoteIds: string[];
  inputValue: string;
  changeValue: string;
  anchorExpiresAtLedger: number;
}

export interface PreparePrivateActionInput {
  esk: ExpandedSpendingKey;
  keyContext: PrivateBalanceKeyContext;
  availableNotes: ShieldedNoteRecord[];
  commitments: Uint8Array[];
  intent: BuildActionIntent;
}

interface InputWitness {
  ownerCommitment: Uint8Array;
  diversifier: Uint8Array;
  value: bigint;
  rho: Uint8Array;
  leafIndex: number;
  siblings: Uint8Array[];
  directionBits: number[];
  nullifier: Uint8Array;
}

interface OutputWitness {
  ownerCommitment: Uint8Array;
  diversifier: Uint8Array;
  value: bigint;
  rho: Uint8Array;
  commitment: Uint8Array;
  recipientEnvelope: Uint8Array;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function isZero(bytes: Uint8Array): boolean {
  return bytes.every(byte => byte === 0);
}

function decodeHex32(value: string, label: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} is not canonical hex`);
  return Uint8Array.from(value.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
}

function decodeHex4(value: string, label: string): Uint8Array {
  if (!/^[0-9a-f]{8}$/.test(value)) throw new Error(`${label} is not canonical hex`);
  return Uint8Array.from(value.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
}

function decodeContractPayload(value: string): Uint8Array {
  if (!StrKey.isValidContract(value)) throw new Error('Private asset contract is invalid');
  return new Uint8Array(StrKey.decodeContract(value));
}

function parseValue(value: string, label: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} is invalid`);
  const parsed = BigInt(value);
  if (parsed < 1n || parsed > MAX_VALUE) throw new Error(`${label} is outside the supported range`);
  return parsed;
}

function fieldString(value: Uint8Array): string {
  return bytesToBigint(value).toString();
}

function memoBytes(value?: Uint8Array): { bytes: Uint8Array; length: number } {
  if (!value) return { bytes: new Uint8Array(32), length: 0 };
  if (value.length > 32) throw new Error('Private memo must not exceed 32 bytes');
  const bytes = new Uint8Array(32);
  bytes.set(value);
  return { bytes, length: value.length };
}

function dummyInput(): InputWitness {
  return {
    ownerCommitment: ZERO_32.slice(),
    diversifier: ZERO_DIVERSIFIER.slice(),
    value: 0n,
    rho: ZERO_32.slice(),
    leafIndex: 0,
    siblings: Array.from({ length: 32 }, () => ZERO_32.slice()),
    directionBits: Array.from({ length: 32 }, () => 0),
    nullifier: ZERO_32.slice(),
  };
}

function dummyOutput(): OutputWitness {
  return {
    ownerCommitment: ZERO_32.slice(),
    diversifier: ZERO_DIVERSIFIER.slice(),
    value: 0n,
    rho: ZERO_32.slice(),
    commitment: ZERO_32.slice(),
    recipientEnvelope: ZERO_ENVELOPE.slice(),
  };
}

async function createRealOutput(input: {
  recipientOwnerCommitment: Uint8Array;
  recipientHpkePublicKey: Uint8Array;
  diversifier: Uint8Array;
  value: bigint;
  memo?: Uint8Array;
  contextHash: Uint8Array;
  contextField: Uint8Array;
  assetField: Uint8Array;
  actionNonce: Uint8Array;
  outputIndex: number;
  priorCommitments: Uint8Array[];
}): Promise<OutputWitness> {
  const memo = memoBytes(input.memo);
  for (;;) {
    const rho = sampleNonzeroField();
    const commitment = computeCommitment(
      input.contextField,
      input.assetField,
      input.recipientOwnerCommitment,
      input.value,
      rho,
    );
    if (
      isZero(commitment) ||
      input.priorCommitments.some(prior => equalBytes(prior, commitment))
    ) {
      rho.fill(0);
      continue;
    }
    const noteBytes = encodeNotePlaintext({
      protocolVersion: 1,
      flags: 0,
      value: input.value,
      diversifier: input.diversifier,
      ownerCommitment: input.recipientOwnerCommitment,
      rho,
      memoLength: memo.length,
      memo: memo.bytes,
      reserved: new Uint8Array(15),
    });
    const output = await createOutputPackage(
      input.recipientHpkePublicKey,
      input.diversifier,
      noteBytes,
      input.contextHash,
      commitment,
      input.actionNonce,
      input.outputIndex,
    );
    noteBytes.fill(0);
    return {
      ownerCommitment: input.recipientOwnerCommitment.slice(),
      diversifier: input.diversifier.slice(),
      value: input.value,
      rho,
      commitment,
      recipientEnvelope: output.recipientEnvelope,
    };
  }
}

async function prepareInputs(input: PreparePrivateActionInput): Promise<{
  witnesses: [InputWitness, InputWitness];
  selectedNoteIds: string[];
  total: bigint;
}> {
  if (input.intent.kind === 'deposit') {
    return { witnesses: [dummyInput(), dummyInput()], selectedNoteIds: [], total: 0n };
  }
  const selectedNoteIds = input.intent.selectedNoteIds;
  if (
    selectedNoteIds.length < 1 ||
    selectedNoteIds.length > 2 ||
    new Set(selectedNoteIds).size !== selectedNoteIds.length
  ) {
    throw new Error('Private action must select one or two distinct notes');
  }
  if (input.intent.anchorRoot.length !== 32 || isZero(input.intent.anchorRoot)) {
    throw new Error('Private action anchor root is invalid');
  }
  if (!Number.isSafeInteger(input.intent.anchorExpiresAtLedger) || input.intent.anchorExpiresAtLedger < 1) {
    throw new Error('Private action anchor expiry is invalid');
  }

  const store = await MerkleNodeStore.fromCommitments(input.commitments);
  if (!equalBytes(store.currentRoot, input.intent.anchorRoot)) {
    throw new Error('Private action commitments do not match the selected anchor root');
  }
  const notesById = new Map(input.availableNotes.map(note => [note.id, note]));
  const witnesses: InputWitness[] = [];
  let total = 0n;

  for (const noteId of selectedNoteIds) {
    const note = notesById.get(noteId);
    if (!note || note.status !== 'unspent') throw new Error('Selected private note is unavailable');
    if (note.assetContractId !== input.intent.assetContractId) {
      throw new Error('Selected private note belongs to another asset');
    }
    if (note.id !== note.commitment || note.id !== noteId) {
      throw new Error('Selected private note identity is inconsistent');
    }
    const commitment = decodeHex32(note.commitment, 'Note commitment');
    const ownerCommitment = decodeHex32(note.ownerCommitment, 'Note owner commitment');
    const diversifier = decodeHex4(note.diversifier, 'Note diversifier');
    const rho = decodeHex32(note.rho, 'Note rho');
    const value = parseValue(note.value, 'Note value');
    const addressKeys = await deriveDiversifiedAddressKeys(
      input.esk.baseOwnerCommitment,
      input.esk.hpkePrivateKey,
      diversifier,
    );
    if (!equalBytes(ownerCommitment, addressKeys.ownerCommitment)) {
      throw new Error('Selected private note belongs to another spending key');
    }
    const assetPayload = decodeContractPayload(input.intent.assetContractId);
    const assetField = computeAssetField({ kind: 1, payload: assetPayload });
    if (!equalBytes(computeCommitment(input.keyContext.contextField, assetField, ownerCommitment, value, rho), commitment)) {
      throw new Error('Selected private note commitment is invalid');
    }
    const path = await store.getPath(note.leafIndex);
    if (!equalBytes(path.leaf, commitment) || !equalBytes(path.root, input.intent.anchorRoot)) {
      throw new Error('Selected private note Merkle witness is invalid');
    }
    const nullifier = computeNullifier(
      input.keyContext.contextField,
      input.esk.nk,
      rho,
      BigInt(note.leafIndex),
      commitment,
    );
    witnesses.push({
      ownerCommitment,
      diversifier,
      value,
      rho,
      leafIndex: note.leafIndex,
      siblings: path.siblings,
      directionBits: path.directionBits,
      nullifier,
    });
    total += value;
  }
  if (total > MAX_VALUE) throw new Error('Selected private note total is outside the supported range');
  while (witnesses.length < 2) witnesses.push(dummyInput());
  return {
    witnesses: witnesses as [InputWitness, InputWitness],
    selectedNoteIds: [...selectedNoteIds],
    total,
  };
}

export async function preparePrivateAction(
  input: PreparePrivateActionInput,
): Promise<PreparedPrivateAction> {
  const contextHash = computeContextHash(
    input.keyContext.protocolVersion,
    input.keyContext.networkId,
    input.keyContext.realmId,
    input.keyContext.poolId,
  );
  const assetPayload = decodeContractPayload(input.intent.assetContractId);
  const asset = { kind: 1, payload: assetPayload };
  const assetField = computeAssetField(asset);
  const actionNonce = randomBytes32();
  const preparedInputs = await prepareInputs(input);
  let publicValue: bigint;
  let kind: ActionKind;
  let depositSource: PublicAddressPayload | undefined;
  let publicRecipient: PublicAddressPayload | undefined;
  let relayer: PublicAddressPayload | undefined;
  let relayerFee = 0n;
  let outputSpecs: Array<{
    ownerCommitment: Uint8Array;
    hpkePublicKey: Uint8Array;
    diversifier: Uint8Array;
    value: bigint;
    memo?: Uint8Array;
  }>;

  if (input.intent.kind === 'deposit') {
    kind = ActionKind.Deposit;
    publicValue = parseValue(input.intent.publicValue, 'Deposit value');
    depositSource = input.intent.depositSource;
    outputSpecs = [{
      ownerCommitment: input.esk.ownerCommitment,
      hpkePublicKey: input.esk.hpkePublicKey,
      diversifier: ZERO_DIVERSIFIER,
      value: publicValue,
      memo: input.intent.memo,
    }];
  } else if (input.intent.kind === 'transfer') {
    kind = ActionKind.PrivateTransfer;
    publicValue = 0n;
    const amount = parseValue(input.intent.amount, 'Private transfer value');
    relayerFee = input.intent.relayerFee === '0'
      ? 0n
      : parseValue(input.intent.relayerFee, 'Relayer fee');
    relayer = input.intent.relayer;
    if (preparedInputs.total < amount + relayerFee) throw new Error('Private balance is insufficient');
    const recipient = await decodePrivateAddress(
      input.intent.recipientAddress,
      input.keyContext.addressPrefix,
    );
    outputSpecs = [{
      ownerCommitment: recipient.ownerCommitment,
      hpkePublicKey: recipient.hpkePublicKey,
      diversifier: recipient.diversifier,
      value: amount,
      memo: input.intent.memo,
    }];
    const change = preparedInputs.total - amount - relayerFee;
    if (change > 0n) {
      outputSpecs.push({
        ownerCommitment: input.esk.ownerCommitment,
        hpkePublicKey: input.esk.hpkePublicKey,
        diversifier: ZERO_DIVERSIFIER,
        value: change,
      });
    }
  } else {
    kind = ActionKind.Withdraw;
    publicValue = parseValue(input.intent.publicValue, 'Withdrawal value');
    if (preparedInputs.total < publicValue) throw new Error('Private balance is insufficient');
    publicRecipient = input.intent.publicRecipient;
    relayerFee = input.intent.relayerFee === '0'
      ? 0n
      : parseValue(input.intent.relayerFee, 'Relayer fee');
    relayer = input.intent.relayer;
    if (preparedInputs.total < publicValue + relayerFee) throw new Error('Private balance is insufficient');
    const change = preparedInputs.total - publicValue - relayerFee;
    outputSpecs = change > 0n ? [{
      ownerCommitment: input.esk.ownerCommitment,
      hpkePublicKey: input.esk.hpkePublicKey,
      diversifier: ZERO_DIVERSIFIER,
      value: change,
    }] : [];
  }

  const outputWitnesses: OutputWitness[] = [];
  for (const [outputIndex, spec] of outputSpecs.entries()) {
    outputWitnesses.push(await createRealOutput({
      recipientOwnerCommitment: spec.ownerCommitment,
      recipientHpkePublicKey: spec.hpkePublicKey,
      diversifier: spec.diversifier,
      value: spec.value,
      memo: spec.memo,
      contextHash,
      contextField: input.keyContext.contextField,
      assetField,
      actionNonce,
      outputIndex,
      priorCommitments: outputWitnesses.map(output => output.commitment),
    }));
  }
  while (outputWitnesses.length < 2) outputWitnesses.push(dummyOutput());
  const outputs = outputWitnesses as [OutputWitness, OutputWitness];
  const anchorRoot = input.intent.kind === 'deposit' ? ZERO_32.slice() : input.intent.anchorRoot.slice();
  const action: ActionModel = {
    protocolVersion: input.keyContext.protocolVersion,
    kind,
    asset,
    actionNonce,
    anchorRoot,
    nullifiers: [
      preparedInputs.witnesses[0].nullifier,
      preparedInputs.witnesses[1].nullifier,
    ],
    outputs: [
      { cm: outputs[0].commitment, recipientEnvelope: outputs[0].recipientEnvelope },
      { cm: outputs[1].commitment, recipientEnvelope: outputs[1].recipientEnvelope },
    ],
    publicValue,
    depositSource,
    publicRecipient,
    relayerFee,
    relayer,
  };
  const publicSignalBytes = await computePublicSignals(
    action,
    input.keyContext.contextField,
    input.keyContext.networkId,
    input.keyContext.realmId,
    input.keyContext.poolId,
  );
  const publicSignals = publicSignalBytes.map(fieldString);
  const selectedInputTotal = preparedInputs.total;
  const privateOutputTotal = outputs[0].value + outputs[1].value;
  const changeValue = input.intent.kind === 'transfer'
    ? selectedInputTotal - parseValue(input.intent.amount, 'Private transfer value') - relayerFee
    : input.intent.kind === 'withdraw'
      ? selectedInputTotal - publicValue - relayerFee
      : 0n;
  const circuitInputs: CircuitInputs = {
    contextField: publicSignals[0],
    assetField: publicSignals[1],
    actionKindField: publicSignals[2],
    anchorRoot: publicSignals[3],
    publicValueField: publicSignals[4],
    relayerFeeField: publicSignals[5],
    relayerField: publicSignals[6],
    actionField: publicSignals[7],
    actionBinding: publicSignals[8],
    nullifier: [publicSignals[9], publicSignals[10]],
    outputCommitment: [publicSignals[11], publicSignals[12]],
    ask: kind === ActionKind.Deposit ? '0' : fieldString(input.esk.ask),
    nk: kind === ActionKind.Deposit ? '0' : fieldString(input.esk.nk),
    inputEnabled: preparedInputs.witnesses.map(witness => witness.value === 0n ? '0' : '1'),
    inputOwnerCommitment: preparedInputs.witnesses.map(witness => fieldString(witness.ownerCommitment)),
    inputDiversifier: preparedInputs.witnesses.map(witness => bytesToBigint(witness.diversifier).toString()),
    inputValue: preparedInputs.witnesses.map(witness => witness.value.toString()),
    inputRho: preparedInputs.witnesses.map(witness => fieldString(witness.rho)),
    inputLeafIndex: preparedInputs.witnesses.map(witness => witness.leafIndex.toString()),
    inputSiblings: preparedInputs.witnesses.map(witness => witness.siblings.map(fieldString)),
    inputDirectionBits: preparedInputs.witnesses.map(witness => witness.directionBits.map(String)),
    outputEnabled: outputs.map(output => output.value === 0n ? '0' : '1'),
    outputOwnerCommitment: outputs.map(output => fieldString(output.ownerCommitment)),
    outputValue: outputs.map(output => output.value.toString()),
    outputRho: outputs.map(output => fieldString(output.rho)),
  };
  if (selectedInputTotal + (kind === ActionKind.Deposit ? publicValue : 0n) !==
      privateOutputTotal + (kind === ActionKind.Withdraw ? publicValue : 0n) + relayerFee) {
    throw new Error('Private action value conservation failed');
  }

  return {
    action,
    actionField: publicSignalBytes[7],
    actionBinding: publicSignalBytes[8],
    publicSignals,
    circuitInputs,
    reservedNoteIds: preparedInputs.selectedNoteIds,
    inputValue: selectedInputTotal.toString(),
    changeValue: changeValue.toString(),
    anchorExpiresAtLedger: input.intent.kind === 'deposit' ? 0 : input.intent.anchorExpiresAtLedger,
  };
}
