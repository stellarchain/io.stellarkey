import { encodeDomain, encodeU16Be, encodeU64Be } from './encoding.js';
import { fieldId, bigintTo32Bytes, isCanonicalField } from './field.js';
import { equalBytes } from './hash.js';
import { p2 } from './poseidon2.js';
export const DOMAIN_ACTION = 'SKSB_ACTION_V1';
export const DOMAIN_ACTION_BINDING = 'SKSB_ACTION_BINDING_V1';
export const DOMAIN_ASSET = 'SKSB_ASSET_V1';
export const DOMAIN_RELAYER = 'SKSB_RELAYER_V1';
const MAX_PUBLIC_VALUE = (1n << 63n) - 1n;
export var ActionKind;
(function (ActionKind) {
    ActionKind[ActionKind["Deposit"] = 1] = "Deposit";
    ActionKind[ActionKind["PrivateTransfer"] = 2] = "PrivateTransfer";
    ActionKind[ActionKind["Withdraw"] = 3] = "Withdraw";
})(ActionKind || (ActionKind = {}));
function isZero(bytes) {
    return bytes.every((byte) => byte === 0);
}
function requireLength(name, bytes, length) {
    if (bytes.length !== length)
        throw new Error(`${name} must be ${length} bytes`);
}
function validateAddress(addr, name) {
    if (addr.kind !== 0 && addr.kind !== 1)
        throw new Error(`${name} kind is invalid`);
    requireLength(`${name} payload`, addr.payload, 32);
    if (isZero(addr.payload))
        throw new Error(`${name} payload must be nonzero`);
}
function encodeOptionalAddress(addr, out) {
    if (!addr) {
        out.push(0); // absent
        for (let i = 0; i < 33; i++)
            out.push(0);
    }
    else {
        validateAddress(addr, 'Address');
        out.push(1); // present
        out.push(addr.kind);
        for (const b of addr.payload)
            out.push(b);
    }
}
function validateAction(action) {
    if (action.protocolVersion !== 1)
        throw new Error('Unsupported action protocol version');
    if (![ActionKind.Deposit, ActionKind.PrivateTransfer, ActionKind.Withdraw].includes(action.kind)) {
        throw new Error('Invalid action kind');
    }
    validateAddress(action.asset, 'Asset');
    if (action.asset.kind !== 1)
        throw new Error('Asset must be a contract address');
    requireLength('Action nonce', action.actionNonce, 32);
    requireLength('Anchor root', action.anchorRoot, 32);
    if (!isCanonicalField(action.anchorRoot))
        throw new Error('Anchor root is not canonical');
    for (const [index, nullifier] of action.nullifiers.entries()) {
        requireLength(`Nullifier ${index}`, nullifier, 32);
        if (!isCanonicalField(nullifier))
            throw new Error(`Nullifier ${index} is not canonical`);
    }
    for (const [index, output] of action.outputs.entries()) {
        requireLength(`Output ${index} commitment`, output.cm, 32);
        requireLength(`Output ${index} recipient envelope`, output.recipientEnvelope, 181);
        if (!isCanonicalField(output.cm))
            throw new Error(`Output ${index} commitment is not canonical`);
        if (isZero(output.cm) && !isZero(output.recipientEnvelope)) {
            throw new Error(`Output ${index} dummy envelope must be zero`);
        }
    }
    if (action.kind !== ActionKind.Withdraw && isZero(action.outputs[0].cm)) {
        throw new Error('Output 0 must be real');
    }
    if (!isZero(action.outputs[1].cm) && equalBytes(action.outputs[0].cm, action.outputs[1].cm)) {
        throw new Error('Real output commitments must differ');
    }
    if (action.publicValue < 0n || action.publicValue > MAX_PUBLIC_VALUE) {
        throw new Error('Invalid public value');
    }
    if (action.relayerFee < 0n || action.relayerFee > MAX_PUBLIC_VALUE) {
        throw new Error('Invalid relayer fee');
    }
    const anchorIsZero = isZero(action.anchorRoot);
    const firstNullifierIsZero = isZero(action.nullifiers[0]);
    const secondNullifierIsZero = isZero(action.nullifiers[1]);
    if (action.kind === ActionKind.Deposit) {
        if (!anchorIsZero || !firstNullifierIsZero || !secondNullifierIsZero) {
            throw new Error('Invalid deposit private slots');
        }
        if (action.publicValue === 0n ||
            !action.depositSource ||
            action.publicRecipient ||
            action.relayerFee !== 0n ||
            action.relayer) {
            throw new Error('Invalid deposit public boundary');
        }
        validateAddress(action.depositSource, 'Deposit source');
        return;
    }
    if (anchorIsZero || firstNullifierIsZero)
        throw new Error('Invalid private spend slots');
    if (!secondNullifierIsZero && equalBytes(action.nullifiers[0], action.nullifiers[1])) {
        throw new Error('Real nullifiers must differ');
    }
    if (action.kind === ActionKind.PrivateTransfer) {
        if (action.publicValue !== 0n || action.depositSource || action.publicRecipient || !action.relayer) {
            throw new Error('Invalid transfer public boundary');
        }
        validateAddress(action.relayer, 'Relayer');
        return;
    }
    if (action.publicValue === 0n || action.depositSource || !action.publicRecipient || !action.relayer) {
        throw new Error('Invalid withdrawal public boundary');
    }
    validateAddress(action.publicRecipient, 'Public recipient');
    validateAddress(action.relayer, 'Relayer');
}
export function serializeCanonicalActionBytes(action, networkId, realmId, poolId) {
    validateAction(action);
    for (const [name, bytes] of [
        ['Network ID', networkId],
        ['Realm ID', realmId],
        ['Pool ID', poolId],
    ]) {
        requireLength(name, bytes, 32);
    }
    const buf = [];
    encodeDomain(DOMAIN_ACTION, buf);
    encodeU16Be(action.protocolVersion, buf);
    for (const b of networkId)
        buf.push(b);
    for (const b of realmId)
        buf.push(b);
    for (const b of poolId)
        buf.push(b);
    buf.push(action.kind);
    buf.push(action.asset.kind, ...action.asset.payload);
    for (const b of action.actionNonce)
        buf.push(b);
    for (const b of action.anchorRoot)
        buf.push(b);
    for (const b of action.nullifiers[0])
        buf.push(b);
    for (const b of action.nullifiers[1])
        buf.push(b);
    // outputs[0] (213 bytes)
    for (const b of action.outputs[0].cm)
        buf.push(b);
    for (const b of action.outputs[0].recipientEnvelope)
        buf.push(b);
    // outputs[1] (213 bytes)
    for (const b of action.outputs[1].cm)
        buf.push(b);
    for (const b of action.outputs[1].recipientEnvelope)
        buf.push(b);
    encodeU64Be(action.publicValue, buf);
    encodeU64Be(action.relayerFee, buf);
    encodeOptionalAddress(action.relayer, buf);
    encodeOptionalAddress(action.depositSource, buf);
    encodeOptionalAddress(action.publicRecipient, buf);
    return Uint8Array.from(buf);
}
export function computeRelayerField(action) {
    if (!action.relayer)
        return new Uint8Array(32);
    validateAddress(action.relayer, 'Relayer');
    const bytes = new Uint8Array(33);
    bytes[0] = action.relayer.kind;
    bytes.set(action.relayer.payload, 1);
    return fieldId(DOMAIN_RELAYER, bytes);
}
export function computeAssetField(asset) {
    validateAddress(asset, 'Asset');
    if (asset.kind !== 1)
        throw new Error('Asset must be a contract address');
    const bytes = new Uint8Array(33);
    bytes[0] = asset.kind;
    bytes.set(asset.payload, 1);
    return fieldId(DOMAIN_ASSET, bytes);
}
export function computeActionField(action, networkId, realmId, poolId) {
    const bytes = serializeCanonicalActionBytes(action, networkId, realmId, poolId);
    return fieldId(DOMAIN_ACTION, bytes);
}
export async function computeActionBinding(contextField, actionField) {
    requireLength('Context field', contextField, 32);
    requireLength('Action field', actionField, 32);
    if (!isCanonicalField(contextField) || !isCanonicalField(actionField)) {
        throw new Error('Action binding fields must be canonical');
    }
    return p2(DOMAIN_ACTION_BINDING, [contextField, actionField]);
}
export async function computePublicSignals(action, contextField, networkId, realmId, poolId) {
    const assetField = computeAssetField(action.asset);
    const actionField = computeActionField(action, networkId, realmId, poolId);
    const actionBinding = await computeActionBinding(contextField, actionField);
    const kindField = new Uint8Array(32);
    kindField[31] = action.kind;
    const valField = bigintTo32Bytes(action.publicValue);
    const relayerFeeField = bigintTo32Bytes(action.relayerFee);
    const relayerField = computeRelayerField(action);
    return [
        contextField,
        assetField,
        kindField,
        action.anchorRoot,
        valField,
        relayerFeeField,
        relayerField,
        actionField,
        actionBinding,
        action.nullifiers[0],
        action.nullifiers[1],
        action.outputs[0].cm,
        action.outputs[1].cm,
    ];
}
