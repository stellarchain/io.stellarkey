import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ActionKind,
  bigintTo32Bytes,
  computeAssetField,
  computeCommitment,
  computeContextField,
  computeContextHash,
  computePublicSignals,
} from '../dist/index.js';

const bytes = value => new Uint8Array(32).fill(value);

test('one pool context supports asset-bound notes and actions', async () => {
  const networkId = bytes(1);
  const realmId = bytes(2);
  const poolId = bytes(3);
  const xlm = { kind: 1, payload: bytes(4) };
  const usdc = { kind: 1, payload: bytes(5) };
  const contextHash = computeContextHash(2, networkId, realmId, poolId);
  const contextField = computeContextField(contextHash);
  const owner = bigintTo32Bytes(6n);
  const rho = bigintTo32Bytes(7n);
  const xlmField = computeAssetField(xlm);
  const usdcField = computeAssetField(usdc);

  assert.notDeepEqual(xlmField, usdcField);
  assert.notDeepEqual(
    computeCommitment(contextField, xlmField, owner, 10n, rho),
    computeCommitment(contextField, usdcField, owner, 10n, rho),
  );

  const zero = new Uint8Array(32);
  const commitment = computeCommitment(contextField, xlmField, owner, 10n, rho);
  const action = {
    protocolVersion: 2,
    kind: ActionKind.Deposit,
    assetIndex: 0,
    asset: xlm,
    actionNonce: bytes(8),
    anchorRoot: zero,
    nullifiers: [bytes(10), bytes(11)],
    outputs: [
      { cm: commitment, recipientEnvelope: new Uint8Array(181).fill(1), outgoingEnvelope: new Uint8Array(157).fill(2) },
      { cm: bytes(12), recipientEnvelope: new Uint8Array(181).fill(3), outgoingEnvelope: new Uint8Array(157).fill(4) },
      { cm: bytes(13), recipientEnvelope: new Uint8Array(181).fill(5), outgoingEnvelope: new Uint8Array(157).fill(6) },
    ],
    publicValue: 10n,
    depositSource: { kind: 0, payload: bytes(9) },
  };
  const signals = await computePublicSignals(
    action,
    contextField,
    networkId,
    realmId,
    poolId,
  );

  assert.equal(signals.length, 11);
  assert.deepEqual(signals[1], xlmField);

  const transferSignals = await computePublicSignals({
    ...action,
    kind: ActionKind.PrivateTransfer,
    asset: undefined,
    assetIndex: undefined,
    anchorRoot: bytes(14),
    publicValue: 0n,
    depositSource: undefined,
  }, contextField, networkId, realmId, poolId);
  assert.deepEqual(transferSignals[1], zero);
});
