import { encodeDomain, encodeU16Be, encodeU32Be, encodeU64Be } from './encoding.js';
import { fieldId, bigintTo32Bytes, isCanonicalField } from './field.js';
import { equalBytes } from './hash.js';

export const DOMAIN_ACTION = 'SKSB_ACTION_V1';
export const DOMAIN_ASSET = 'SKSB_ASSET_V1';
const MAX_PUBLIC_VALUE = (1n << 63n) - 1n;

export enum ActionKind {
  Deposit = 1,
  PrivateTransfer = 2,
  Withdraw = 3,
  FullInputExit = 4,
}

export interface OutputPackageModel {
  cm: Uint8Array; // 32 bytes
  recipientEnvelope: Uint8Array; // 181 bytes
  outgoingEnvelope: Uint8Array; // 157 bytes
}

export interface ActionModel {
  protocolVersion: number;
  kind: ActionKind;
  assetIndex?: number;
  asset?: { kind: number; payload: Uint8Array };
  actionNonce: Uint8Array;
  anchorRoot: Uint8Array;
  nullifiers: [Uint8Array, Uint8Array];
  outputs: [OutputPackageModel, OutputPackageModel, OutputPackageModel];
  publicValue: bigint;
  depositSource?: { kind: number; payload: Uint8Array };
  publicRecipient?: { kind: number; payload: Uint8Array };
}

function isZero(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0);
}

function requireLength(name: string, bytes: Uint8Array, length: number): void {
  if (bytes.length !== length) throw new Error(`${name} must be ${length} bytes`);
}

function validateAddress(addr: { kind: number; payload: Uint8Array }, name: string): void {
  if (addr.kind !== 0 && addr.kind !== 1) throw new Error(`${name} kind is invalid`);
  requireLength(`${name} payload`, addr.payload, 32);
  if (isZero(addr.payload)) throw new Error(`${name} payload must be nonzero`);
}

function encodeOptionalAddress(addr: { kind: number; payload: Uint8Array } | undefined, out: number[]): void {
  if (!addr) {
    out.push(0); // absent
    for (let i = 0; i < 33; i++) out.push(0);
  } else {
    validateAddress(addr, 'Address');
    out.push(1); // present
    out.push(addr.kind);
    for (const b of addr.payload) out.push(b);
  }
}

function validateAssetBoundary(action: ActionModel): void {
  const hasAsset = action.asset !== undefined;
  const hasIndex = action.assetIndex !== undefined;
  if (hasAsset !== hasIndex) throw new Error('Boundary asset and asset index must appear together');
  if (!hasAsset) return;
  validateAddress(action.asset!, 'Asset');
  if (action.asset!.kind !== 1) throw new Error('Asset must be a contract address');
  if (!Number.isInteger(action.assetIndex) || action.assetIndex! < 0 || action.assetIndex! > 0xffff_ffff) {
    throw new Error('Asset index must be an unsigned 32-bit integer');
  }
}

function validateAction(action: ActionModel): void {
  if (action.protocolVersion !== 2) throw new Error('Unsupported action protocol version');
  if (![ActionKind.Deposit, ActionKind.PrivateTransfer, ActionKind.Withdraw, ActionKind.FullInputExit].includes(action.kind)) {
    throw new Error('Invalid action kind');
  }
  validateAssetBoundary(action);
  requireLength('Action nonce', action.actionNonce, 32);
  requireLength('Anchor root', action.anchorRoot, 32);
  if (!isCanonicalField(action.anchorRoot)) throw new Error('Anchor root is not canonical');
  for (const [index, nullifier] of action.nullifiers.entries()) {
    requireLength(`Nullifier ${index}`, nullifier, 32);
    if (!isCanonicalField(nullifier)) throw new Error(`Nullifier ${index} is not canonical`);
  }
  if (action.outputs.length !== 3) throw new Error('Action must contain exactly three outputs');
  for (const [index, output] of action.outputs.entries()) {
    requireLength(`Output ${index} commitment`, output.cm, 32);
    requireLength(`Output ${index} recipient envelope`, output.recipientEnvelope, 181);
    requireLength(`Output ${index} outgoing envelope`, output.outgoingEnvelope, 157);
    if (!isCanonicalField(output.cm)) throw new Error(`Output ${index} commitment is not canonical`);
    if (isZero(output.cm) || isZero(output.recipientEnvelope) || isZero(output.outgoingEnvelope)) {
      throw new Error(`Output ${index} package must be nonzero`);
    }
  }
  for (let left = 0; left < action.outputs.length; left += 1) {
    for (let right = left + 1; right < action.outputs.length; right += 1) {
      if (equalBytes(action.outputs[left].cm, action.outputs[right].cm)) {
        throw new Error('Output commitments must differ');
      }
    }
  }
  if (action.publicValue < 0n || action.publicValue > MAX_PUBLIC_VALUE) {
    throw new Error('Invalid public value');
  }

  const anchorIsZero = isZero(action.anchorRoot);
  if (action.nullifiers.some(isZero)) throw new Error('Nullifiers must be nonzero');
  if (equalBytes(action.nullifiers[0], action.nullifiers[1])) {
    throw new Error('Nullifiers must differ');
  }
  if (action.kind === ActionKind.Deposit) {
    if (!anchorIsZero) {
      throw new Error('Invalid deposit private slots');
    }
    if (
      action.publicValue === 0n ||
      !action.asset ||
      action.assetIndex === undefined ||
      !action.depositSource ||
      action.publicRecipient
    ) {
      throw new Error('Invalid deposit public boundary');
    }
    validateAddress(action.depositSource, 'Deposit source');
    return;
  }

  if (anchorIsZero) throw new Error('Invalid private spend slots');
  if (action.kind === ActionKind.PrivateTransfer) {
    if (
      action.publicValue !== 0n
      || action.asset
      || action.assetIndex !== undefined
      || action.depositSource
      || action.publicRecipient
    ) {
      throw new Error('Private transfer must not expose a boundary asset or address');
    }
    return;
  }
  if (
    action.publicValue === 0n
    || !action.asset
    || action.assetIndex === undefined
    || action.depositSource
    || !action.publicRecipient
  ) {
    throw new Error('Invalid withdrawal public boundary');
  }
  validateAddress(action.publicRecipient, 'Public recipient');
}

export function serializeCanonicalActionBytes(
  action: ActionModel,
  networkId: Uint8Array,
  realmId: Uint8Array,
  poolId: Uint8Array,
): Uint8Array {
  validateAction(action);
  for (const [name, bytes] of [
    ['Network ID', networkId],
    ['Realm ID', realmId],
    ['Pool ID', poolId],
  ] as const) {
    requireLength(name, bytes, 32);
  }
  const buf: number[] = [];
  encodeDomain(DOMAIN_ACTION, buf);
  encodeU16Be(action.protocolVersion, buf);
  for (const b of networkId) buf.push(b);
  for (const b of realmId) buf.push(b);
  for (const b of poolId) buf.push(b);

  buf.push(action.kind);
  encodeOptionalAddress(action.asset, buf);
  encodeU32Be(action.assetIndex ?? 0, buf);
  for (const b of action.actionNonce) buf.push(b);
  for (const b of action.anchorRoot) buf.push(b);
  for (const b of action.nullifiers[0]) buf.push(b);
  for (const b of action.nullifiers[1]) buf.push(b);

  // outputs[0] (370 bytes)
  for (const b of action.outputs[0].cm) buf.push(b);
  for (const b of action.outputs[0].recipientEnvelope) buf.push(b);
  for (const b of action.outputs[0].outgoingEnvelope) buf.push(b);

  for (let index = 1; index < 3; index += 1) {
    for (const b of action.outputs[index].cm) buf.push(b);
    for (const b of action.outputs[index].recipientEnvelope) buf.push(b);
    for (const b of action.outputs[index].outgoingEnvelope) buf.push(b);
  }

  encodeU64Be(action.publicValue, buf);
  encodeOptionalAddress(action.depositSource, buf);
  encodeOptionalAddress(action.publicRecipient, buf);

  return Uint8Array.from(buf);
}

export function computeAssetField(asset: { kind: number; payload: Uint8Array }): Uint8Array {
  validateAddress(asset, 'Asset');
  if (asset.kind !== 1) throw new Error('Asset must be a contract address');
  const bytes = new Uint8Array(33);
  bytes[0] = asset.kind;
  bytes.set(asset.payload, 1);
  return fieldId(DOMAIN_ASSET, bytes);
}

export function computeActionField(
  action: ActionModel,
  networkId: Uint8Array,
  realmId: Uint8Array,
  poolId: Uint8Array,
): Uint8Array {
  const bytes = serializeCanonicalActionBytes(action, networkId, realmId, poolId);
  return fieldId(DOMAIN_ACTION, bytes);
}

export async function computePublicSignals(
  action: ActionModel,
  contextField: Uint8Array,
  networkId: Uint8Array,
  realmId: Uint8Array,
  poolId: Uint8Array,
): Promise<Uint8Array[]> {
  validateAction(action);
  const assetField = action.asset ? computeAssetField(action.asset) : new Uint8Array(32);
  const actionField = computeActionField(action, networkId, realmId, poolId);

  const kindField = new Uint8Array(32);
  kindField[31] = action.kind;

  const valField = bigintTo32Bytes(action.publicValue);
  return [
    contextField,
    assetField,
    kindField,
    action.anchorRoot,
    valField,
    actionField,
    action.nullifiers[0],
    action.nullifiers[1],
    action.outputs[0].cm,
    action.outputs[1].cm,
    action.outputs[2].cm,
  ];
}
