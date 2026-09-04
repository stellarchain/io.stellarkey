import {
  ActionKind,
  TREE_DEPTH,
  bytesToBigint,
  computeCommitment,
  computeContextHash,
  computeAssetField,
  computeDummyNullifier,
  computeNullifier,
  computePublicSignals,
  createOutputPackage,
  decodePrivateAddress,
  deriveDiversifiedAddressKeys,
  deriveOutgoingAad,
  deriveX25519PublicKey,
  encodeNotePlaintext,
  encodeOutgoingPlaintext,
  hashMerkleNode,
  randomBytes32,
  sampleNonzeroField,
  type ActionModel,
  type ExpandedSpendingKey,
  type MerklePathWitness,
} from '@stellarkey/private-balance';
import { StrKey } from '@stellar/stellar-sdk';
import type { ShieldedNoteRecord } from '../runtime/types';
import type { PrivateBalanceKeyContext } from './messages';
import { privateOutgoingHistoryMode, type PrivateOutgoingHistoryMode } from '../runtime/outgoing-history';
import { createPrivateOutgoingEnvelope } from './outgoing-envelope';

const MAX_VALUE = (1n << 63n) - 1n;
const ZERO_32 = new Uint8Array(32);
const ZERO_DIVERSIFIER = new Uint8Array(4);

export interface PublicAddressPayload {
  kind: number;
  payload: Uint8Array;
}

interface DepositIntent {
  kind: 'deposit';
  assetIndex: number;
  assetContractId: string;
  publicValue: string;
  depositSource: PublicAddressPayload;
  memo?: Uint8Array;
}

interface TransferIntent {
  kind: 'transfer';
  assetIndex: number;
  assetContractId: string;
  amount: string;
  recipientAddress: string;
  selectedNoteIds: string[];
  anchorRoot: Uint8Array;
  anchorExpiresAtLedger: number;
  memo?: Uint8Array;
  peerFee?: { amount: string; recipientAddress: string };
}

interface WithdrawIntent {
  kind: 'withdraw';
  assetIndex: number;
  assetContractId: string;
  publicValue: string;
  publicRecipient: PublicAddressPayload;
  selectedNoteIds: string[];
  anchorRoot: Uint8Array;
  anchorExpiresAtLedger: number;
  peerFee?: { amount: string; recipientAddress: string };
}

export type BuildActionIntent = (DepositIntent | TransferIntent | WithdrawIntent) & {
  outgoingHistory?: PrivateOutgoingHistoryMode;
};

type CircuitInputs = Record<string, string | string[] | string[][] | string[][][]>;

export interface PreparedPrivateAction {
  action: ActionModel;
  actionField: Uint8Array;
  publicSignals: string[];
  circuitInputs: CircuitInputs;
  reservedNoteIds: string[];
  inputValue: string;
  changeValue: string;
  recipientOutputCommitment?: string;
  anchorExpiresAtLedger: number;
}

export interface PreparePrivateActionInput {
  esk: ExpandedSpendingKey;
  keyContext: PrivateBalanceKeyContext;
  availableNotes: ShieldedNoteRecord[];
  merklePaths: MerklePathWitness[];
  intent: BuildActionIntent;
}

interface InputWitness {
  real: boolean;
  dummySecret: Uint8Array;
  ownerCommitment: Uint8Array;
  diversifier: Uint8Array;
  value: bigint;
  rho: Uint8Array;
  leafIndex: number;
  siblings: [Uint8Array, Uint8Array][];
  positions: number[];
  nullifier: Uint8Array;
}

interface OutputWitness {
  real: boolean;
  ownerCommitment: Uint8Array;
  diversifier: Uint8Array;
  value: bigint;
  rho: Uint8Array;
  commitment: Uint8Array;
  recipientEnvelope: Uint8Array;
  outgoingEnvelope: Uint8Array;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function merklePathRoot(path: MerklePathWitness): Uint8Array {
  let current: Uint8Array = path.leaf.slice();
  for (let level = 0; level < path.siblings.length; level += 1) {
    const position = path.positions[level];
    const siblings = path.siblings[level];
    current = position === 0
      ? hashMerkleNode([current, siblings[0], siblings[1]])
      : position === 1
        ? hashMerkleNode([siblings[0], current, siblings[1]])
        : hashMerkleNode([siblings[0], siblings[1], current]);
  }
  return current;
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

function randomBit(): number {
  const entropy = randomBytes32();
  try {
    return entropy[0] & 1;
  } finally {
    entropy.fill(0);
  }
}

function randomDiversifier(): Uint8Array {
  for (;;) {
    const entropy = randomBytes32();
    try {
      const diversifier = entropy.slice(0, 4);
      if (!isZero(diversifier)) return diversifier;
    } finally {
      entropy.fill(0);
    }
  }
}

function shuffled<T>(values: [T, T]): [T, T] {
  return randomBit() === 0 ? values : [values[1], values[0]];
}

function randomBelow(limit: number): number {
  const cutoff = 256 - (256 % limit);
  for (;;) {
    const entropy = randomBytes32();
    try {
      if (entropy[0] < cutoff) return entropy[0] % limit;
    } finally {
      entropy.fill(0);
    }
  }
}

function shuffledThree<T>(values: [T, T, T]): [T, T, T] {
  const result: [T, T, T] = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomBelow(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function dummyInput(contextField: Uint8Array): InputWitness {
  const dummySecret = sampleNonzeroField();
  return {
    real: false,
    dummySecret,
    ownerCommitment: ZERO_32.slice(),
    diversifier: ZERO_DIVERSIFIER.slice(),
    value: 0n,
    rho: ZERO_32.slice(),
    leafIndex: 0,
    siblings: Array.from(
      { length: TREE_DEPTH },
      () => [ZERO_32.slice(), ZERO_32.slice()] as [Uint8Array, Uint8Array],
    ),
    positions: Array.from({ length: TREE_DEPTH }, () => 0),
    nullifier: computeDummyNullifier(contextField, dummySecret),
  };
}

async function createOutput(input: {
  real: boolean;
  recipientOwnerCommitment: Uint8Array;
  recipientHpkePublicKey: Uint8Array;
  diversifier: Uint8Array;
  value: bigint;
  memo?: Uint8Array;
  contextHash: Uint8Array;
  contextField: Uint8Array;
  assetField: Uint8Array;
  assetIndex: number;
  actionNonce: Uint8Array;
  deploymentBindingHash: Uint8Array;
  outgoingViewingKey: Uint8Array;
  outgoingHistory: PrivateOutgoingHistoryMode;
  outputIndex: number;
  priorCommitments: Uint8Array[];
  selfIdentity?: {
    baseOwnerCommitment: Uint8Array;
    incomingViewingKey: Uint8Array;
  };
}): Promise<OutputWitness> {
  if (input.selfIdentity) {
    const expected = await deriveDiversifiedAddressKeys(
      input.selfIdentity.baseOwnerCommitment,
      input.selfIdentity.incomingViewingKey,
      input.diversifier,
    );
    try {
      if (
        !equalBytes(input.recipientOwnerCommitment, expected.ownerCommitment) ||
        !equalBytes(input.recipientHpkePublicKey, expected.hpkePublicKey)
      ) {
        throw new Error('Private self-output keys do not match the stamped diversifier');
      }
    } finally {
      expected.hpkePrivateKey.fill(0);
    }
  }
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
      flags: input.real ? 0 : 1,
      value: input.value,
      diversifier: input.diversifier,
      ownerCommitment: input.recipientOwnerCommitment,
      rho,
      memoLength: memo.length,
      memo: memo.bytes,
      assetIndex: input.assetIndex,
      reserved: new Uint8Array(11),
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
    const outgoingAad = deriveOutgoingAad(
      input.deploymentBindingHash,
      input.contextHash,
      input.assetField,
      commitment,
      input.actionNonce,
      input.outputIndex,
    );
    let outgoingEnvelope: Uint8Array;
    try {
      outgoingEnvelope = await createPrivateOutgoingEnvelope({
        mode: input.outgoingHistory,
        outgoingViewingKey: input.outgoingViewingKey,
        ephemeralPublicKey: output.recipientEnvelope.slice(5, 37),
        aad: outgoingAad,
        plaintext: () => encodeOutgoingPlaintext({
          protocolVersion: 1, flags: input.real ? 0 : 1, value: input.value,
          diversifier: input.diversifier, ownerCommitment: input.recipientOwnerCommitment,
          recipientHpkePublicKey: input.recipientHpkePublicKey, memoLength: memo.length,
          memo: memo.bytes, assetIndex: input.assetIndex, reserved: new Uint8Array(11),
        }),
      });
    } finally {
      noteBytes.fill(0);
      output.outputPackage.fill(0);
    }
    return {
      real: input.real,
      ownerCommitment: input.recipientOwnerCommitment.slice(),
      diversifier: input.diversifier.slice(),
      value: input.value,
      rho,
      commitment,
      recipientEnvelope: output.recipientEnvelope,
      outgoingEnvelope,
    };
  }
}

async function prepareInputs(input: PreparePrivateActionInput): Promise<{
  witnesses: [InputWitness, InputWitness];
  selectedNoteIds: string[];
  total: bigint;
}> {
  if (input.intent.kind === 'deposit') {
    if (input.merklePaths.length !== 0) {
      throw new Error('Private deposit must not include Merkle paths');
    }
    return {
      witnesses: [dummyInput(input.keyContext.contextField), dummyInput(input.keyContext.contextField)],
      selectedNoteIds: [],
      total: 0n,
    };
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

  if (input.merklePaths.length !== selectedNoteIds.length) {
    throw new Error('Private action must include one Merkle path per selected note');
  }
  const pathsByLeafIndex = new Map(input.merklePaths.map(path => [path.leafIndex, path]));
  if (pathsByLeafIndex.size !== input.merklePaths.length) {
    throw new Error('Private action Merkle paths must be distinct');
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
    if (note.assetIndex !== input.intent.assetIndex) {
      throw new Error('Selected private note belongs to another asset index');
    }
    if (note.id !== noteId || !/^[0-9a-f]{64}$/.test(note.id)) {
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
    const path = pathsByLeafIndex.get(note.leafIndex);
    if (
      !path ||
      path.siblings.length !== TREE_DEPTH ||
      path.siblings.some(level => level.length !== 2 || level.some(node => node.length !== 32)) ||
      path.positions.length !== TREE_DEPTH ||
      path.positions.some(position => !Number.isInteger(position) || position < 0 || position > 2) ||
      !equalBytes(path.leaf, commitment) ||
      !equalBytes(merklePathRoot(path), path.root) ||
      !equalBytes(path.root, input.intent.anchorRoot)
    ) {
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
      real: true,
      dummySecret: ZERO_32.slice(),
      ownerCommitment,
      diversifier,
      value,
      rho,
      leafIndex: note.leafIndex,
      siblings: path.siblings,
      positions: path.positions,
      nullifier,
    });
    total += value;
  }
  if (total > MAX_VALUE) throw new Error('Selected private note total is outside the supported range');
  let arranged: [InputWitness, InputWitness];
  if (witnesses.length === 1) {
    const realLane = randomBit();
    arranged = realLane === 0
      ? [witnesses[0], dummyInput(input.keyContext.contextField)]
      : [dummyInput(input.keyContext.contextField), witnesses[0]];
  } else {
    arranged = shuffled(witnesses as [InputWitness, InputWitness]);
  }
  return {
    witnesses: arranged,
    selectedNoteIds: [...selectedNoteIds],
    total,
  };
}

export async function preparePrivateAction(
  input: PreparePrivateActionInput,
): Promise<PreparedPrivateAction> {
  const outgoingHistory = privateOutgoingHistoryMode(input.intent.outgoingHistory);
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
  if (!Number.isSafeInteger(input.intent.assetIndex) || input.intent.assetIndex < 0 || input.intent.assetIndex > 0xffff_ffff) {
    throw new Error('Private asset index is invalid');
  }
  const preparedInputs = await prepareInputs(input);
  let publicValue: bigint;
  let kind: ActionKind;
  let depositSource: PublicAddressPayload | undefined;
  let publicRecipient: PublicAddressPayload | undefined;
  let peerFee = 0n;
  let outputSpecs: Array<{
    real: boolean;
    ownerCommitment: Uint8Array;
    hpkePublicKey: Uint8Array;
    diversifier: Uint8Array;
    value: bigint;
    memo?: Uint8Array;
    selfIdentity?: {
      baseOwnerCommitment: Uint8Array;
      incomingViewingKey: Uint8Array;
    };
  }>;

  let actionDiversifier: Uint8Array | null = null;
  const selfOutput = async (value: bigint, memo?: Uint8Array) => {
    const diversifier = actionDiversifier ?? randomDiversifier();
    actionDiversifier = diversifier;
    const identity = await deriveDiversifiedAddressKeys(
      input.esk.baseOwnerCommitment,
      input.esk.hpkePrivateKey,
      diversifier,
    );
    try {
      return {
        real: true,
        ownerCommitment: identity.ownerCommitment,
        hpkePublicKey: identity.hpkePublicKey,
        diversifier,
        value,
        memo,
        selfIdentity: {
          baseOwnerCommitment: input.esk.baseOwnerCommitment,
          incomingViewingKey: input.esk.hpkePrivateKey,
        },
      };
    } finally {
      identity.hpkePrivateKey.fill(0);
    }
  };
  const dummyOutput = () => {
    const privateKey = randomBytes32();
    try {
      return {
        real: false,
        ownerCommitment: sampleNonzeroField(),
        hpkePublicKey: deriveX25519PublicKey(privateKey),
        diversifier: (actionDiversifier ??= randomDiversifier()),
        value: 0n,
      };
    } finally {
      privateKey.fill(0);
    }
  };

  if (input.intent.kind === 'deposit') {
    kind = ActionKind.Deposit;
    publicValue = parseValue(input.intent.publicValue, 'Deposit value');
    depositSource = input.intent.depositSource;
    outputSpecs = [await selfOutput(publicValue, input.intent.memo)];
  } else if (input.intent.kind === 'transfer') {
    kind = ActionKind.PrivateTransfer;
    publicValue = 0n;
    const amount = parseValue(input.intent.amount, 'Private transfer value');
    peerFee = input.intent.peerFee ? parseValue(input.intent.peerFee.amount, 'Peer relay fee') : 0n;
    if (preparedInputs.total < amount + peerFee) throw new Error('Private balance is insufficient');
    const recipient = await decodePrivateAddress(
      input.intent.recipientAddress,
      input.keyContext.addressPrefix,
      input.keyContext.deploymentBindingHash,
    );
    actionDiversifier = recipient.diversifier;
    outputSpecs = [{
      real: true,
      ownerCommitment: recipient.ownerCommitment,
      hpkePublicKey: recipient.hpkePublicKey,
      diversifier: recipient.diversifier,
      value: amount,
      memo: input.intent.memo,
    }];
    const change = preparedInputs.total - amount - peerFee;
    if (change > 0n) {
      outputSpecs.push(await selfOutput(change));
    }
  } else {
    kind = ActionKind.Withdraw;
    publicValue = parseValue(input.intent.publicValue, 'Withdrawal value');
    if (preparedInputs.total < publicValue) throw new Error('Private balance is insufficient');
    publicRecipient = input.intent.publicRecipient;
    peerFee = input.intent.peerFee ? parseValue(input.intent.peerFee.amount, 'Peer relay fee') : 0n;
    if (preparedInputs.total < publicValue + peerFee) throw new Error('Private balance is insufficient');
    if (input.intent.peerFee) {
      const relayRecipient = await decodePrivateAddress(
        input.intent.peerFee.recipientAddress,
        input.keyContext.addressPrefix,
        input.keyContext.deploymentBindingHash,
      );
      actionDiversifier = relayRecipient.diversifier;
    }
    const change = preparedInputs.total - publicValue - peerFee;
    outputSpecs = change > 0n ? [await selfOutput(change)] : [];
  }

  if (input.intent.kind !== 'deposit' && input.intent.peerFee) {
    const relayRecipient = await decodePrivateAddress(
      input.intent.peerFee.recipientAddress,
      input.keyContext.addressPrefix,
      input.keyContext.deploymentBindingHash,
    );
    if (actionDiversifier && !equalBytes(actionDiversifier, relayRecipient.diversifier)) {
      throw new Error('Peer relay quote is bound to another action diversifier');
    }
    actionDiversifier = relayRecipient.diversifier;
    outputSpecs.push({
      real: true,
      ownerCommitment: relayRecipient.ownerCommitment,
      hpkePublicKey: relayRecipient.hpkePublicKey,
      diversifier: relayRecipient.diversifier,
      value: peerFee,
    });
  }

  while (outputSpecs.length < 3) outputSpecs.push(dummyOutput());
  if (outputSpecs.length !== 3) throw new Error('Private action exceeds its three output lanes');
  const recipientSpec = input.intent.kind === 'transfer' ? outputSpecs[0] : null;
  const arrangedOutputSpecs = shuffledThree(outputSpecs as [
    typeof outputSpecs[number], typeof outputSpecs[number], typeof outputSpecs[number],
  ]);

  const outputWitnesses: OutputWitness[] = [];
  for (const [outputIndex, spec] of arrangedOutputSpecs.entries()) {
    outputWitnesses.push(await createOutput({
      real: spec.real,
      recipientOwnerCommitment: spec.ownerCommitment,
      recipientHpkePublicKey: spec.hpkePublicKey,
      diversifier: spec.diversifier,
      value: spec.value,
      memo: spec.memo,
      contextHash,
      contextField: input.keyContext.contextField,
      assetField,
      assetIndex: input.intent.assetIndex,
      actionNonce,
      deploymentBindingHash: input.keyContext.deploymentBindingHash,
      outgoingViewingKey: input.esk.outgoingViewingKey,
      outgoingHistory,
      outputIndex,
      priorCommitments: outputWitnesses.map(output => output.commitment),
      selfIdentity: spec.selfIdentity,
    }));
  }
  const outputs = outputWitnesses as [OutputWitness, OutputWitness, OutputWitness];
  const anchorRoot = input.intent.kind === 'deposit' ? ZERO_32.slice() : input.intent.anchorRoot.slice();
  const action: ActionModel = {
    protocolVersion: input.keyContext.protocolVersion,
    kind,
    ...(kind === ActionKind.PrivateTransfer ? {} : { assetIndex: input.intent.assetIndex, asset }),
    actionNonce,
    anchorRoot,
    nullifiers: [
      preparedInputs.witnesses[0].nullifier,
      preparedInputs.witnesses[1].nullifier,
    ],
    outputs: [
      {
        cm: outputs[0].commitment,
        recipientEnvelope: outputs[0].recipientEnvelope,
        outgoingEnvelope: outputs[0].outgoingEnvelope,
      },
      {
        cm: outputs[1].commitment,
        recipientEnvelope: outputs[1].recipientEnvelope,
        outgoingEnvelope: outputs[1].outgoingEnvelope,
      },
      {
        cm: outputs[2].commitment,
        recipientEnvelope: outputs[2].recipientEnvelope,
        outgoingEnvelope: outputs[2].outgoingEnvelope,
      },
    ],
    publicValue,
    depositSource,
    publicRecipient,
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
  const privateOutputTotal = outputs.reduce((sum, output) => sum + output.value, 0n);
  const changeValue = input.intent.kind === 'transfer'
    ? selectedInputTotal - parseValue(input.intent.amount, 'Private transfer value') - peerFee
    : input.intent.kind === 'withdraw'
      ? selectedInputTotal - publicValue - peerFee
      : 0n;
  const circuitInputs: CircuitInputs = {
    contextField: publicSignals[0],
    assetField: publicSignals[1],
    actionAssetField: fieldString(assetField),
    actionKindField: publicSignals[2],
    anchorRoot: publicSignals[3],
    publicValueField: publicSignals[4],
    actionField: publicSignals[5],
    nullifier: [publicSignals[6], publicSignals[7]],
    outputCommitment: [publicSignals[8], publicSignals[9], publicSignals[10]],
    ask: kind === ActionKind.Deposit ? '0' : fieldString(input.esk.ask),
    nk: kind === ActionKind.Deposit ? '0' : fieldString(input.esk.nk),
    inputReal: preparedInputs.witnesses.map(witness => witness.real ? '1' : '0'),
    inputDummySecret: preparedInputs.witnesses.map(witness => fieldString(witness.dummySecret)),
    inputOwnerCommitment: preparedInputs.witnesses.map(witness => fieldString(witness.ownerCommitment)),
    inputDiversifier: preparedInputs.witnesses.map(witness => bytesToBigint(witness.diversifier).toString()),
    inputValue: preparedInputs.witnesses.map(witness => witness.value.toString()),
    inputRho: preparedInputs.witnesses.map(witness => fieldString(witness.rho)),
    inputLeafIndex: preparedInputs.witnesses.map(witness => witness.leafIndex.toString()),
    inputSiblings: preparedInputs.witnesses.map(witness => (
      witness.siblings.map(level => level.map(fieldString))
    )),
    inputPositions: preparedInputs.witnesses.map(witness => witness.positions.map(String)),
    outputOwnerCommitment: outputs.map(output => fieldString(output.ownerCommitment)),
    outputValue: outputs.map(output => output.value.toString()),
    outputRho: outputs.map(output => fieldString(output.rho)),
  };
  if (selectedInputTotal + (kind === ActionKind.Deposit ? publicValue : 0n) !==
      privateOutputTotal + (kind === ActionKind.Withdraw ? publicValue : 0n)) {
    throw new Error('Private action value conservation failed');
  }

  return {
    action,
    actionField: publicSignalBytes[5],
    publicSignals,
    circuitInputs,
    reservedNoteIds: preparedInputs.selectedNoteIds,
    inputValue: selectedInputTotal.toString(),
    changeValue: changeValue.toString(),
    ...(recipientSpec ? { recipientOutputCommitment: Array.from(outputs[arrangedOutputSpecs.indexOf(recipientSpec)].commitment, byte => byte.toString(16).padStart(2, '0')).join('') } : {}),
    anchorExpiresAtLedger: input.intent.kind === 'deposit' ? 0 : input.intent.anchorExpiresAtLedger,
  };
}
