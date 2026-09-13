import test from 'node:test';
import assert from 'node:assert/strict';
import { Forest, recover, rootFromPath, hash } from './model.mjs';
import {
  createOutputPackage, openRecipientEnvelope, deriveKeysFromSeed,
  encodeNotePlaintext, computeCommitment,
} from '../../packages/browser/dist/index.js';

const bytes = n => { const b = new Uint8Array(32); b[31] = n; return b; };
const integer = b => BigInt(`0x${Buffer.from(b).toString('hex')}`);
const NF_DOMAIN = 18852096319358378764148341035066066019156424927623416075041018694204746208236n;

test('synthetic seed recovery decrypts notes across rollover and filters a spent note', async () => {
  // Reuse the v1 envelope codec for compatibility research only. This is not a
  // finalized v2 note/address format or a production scanner implementation.
  const seed = bytes(101), context = bytes(42), contextHash = bytes(43), asset = bytes(84);
  const derive = () => deriveKeysFromSeed(seed, 1, bytes(2), bytes(3), bytes(4), bytes(5), context);
  const original = await derive();
  const tree = new Forest(1, 2), records = [];
  let spentNullifier;
  for (let batch = 0; batch < 2; batch++) {
    const commitments = [], payload = [];
    for (let lane = 0; lane < 3; lane++) {
      const rho = bytes(10 + batch * 3 + lane), nonce = bytes(20 + batch);
      const value = lane === 0 ? 25n : 0n;
      const cm = computeCommitment(context, asset, original.ownerCommitment, value, rho);
      const plaintext = encodeNotePlaintext({ protocolVersion: 1, flags: lane === 0 ? 0 : 1, value,
        diversifier: new Uint8Array(4), ownerCommitment: original.ownerCommitment, rho,
        memoLength: 0, memo: new Uint8Array(32), assetIndex: 0, reserved: new Uint8Array(11) });
      const sealed = await createOutputPackage(original.hpkePublicKey, new Uint8Array(4), plaintext, contextHash, cm, nonce, lane);
      plaintext.fill(0);
      commitments.push(integer(cm));
      payload.push(Buffer.concat([nonce, sealed.recipientEnvelope]).toString('hex'));
      if (batch === 0 && lane === 0) spentNullifier = hash([NF_DOMAIN, integer(context), integer(original.nk), integer(rho), 0n, integer(cm)]);
    }
    records.push(tree.record(1, commitments, [BigInt(91 + batch * 2), BigInt(92 + batch * 2)], payload));
  }
  records.push(tree.record(4, [], [spentNullifier, 99n]));
  for (const value of Object.values(original)) if (value instanceof Uint8Array) value.fill(0);
  const restored = await derive();
  try {
    const replayed = recover(1, 2, records, tree.checkpoint());
    const unspentPositions = [];
    for (const record of records) {
      for (let lane = 0; lane < record.payload.length; lane++) {
        const packed = Buffer.from(record.payload[lane], 'hex');
        const commitment = BigInt(record.commitments[lane]);
        const cm = Uint8Array.from(Buffer.from(commitment.toString(16).padStart(64, '0'), 'hex'));
        const opened = await openRecipientEnvelope(restored.hpkePrivateKey, packed.subarray(32), contextHash, context, asset, cm, packed.subarray(0, 32), lane, restored.baseOwnerCommitment);
        assert.ok(opened !== null, 'synthetic envelope must be recoverable');
        if (opened.flags !== 0) continue;
        const position = BigInt(record.start) + BigInt(lane);
        const nf = hash([NF_DOMAIN, integer(context), integer(restored.nk), integer(opened.rho), position, commitment]);
        if (!replayed.spent.has(nf)) {
          const path = replayed.path(position);
          assert.equal(rootFromPath(commitment, position, path.siblings), replayed.root);
          unspentPositions.push(position);
        }
      }
    }
    assert.deepEqual(unspentPositions, [3n]);
    const corrupt = structuredClone(records);
    corrupt[0].payload[0] = '00' + corrupt[0].payload[0].slice(2);
    // Alter a ciphertext byte (the nonce begins with zero in this fixture).
    corrupt[0].payload[0] = corrupt[0].payload[0].slice(0, -2) + (corrupt[0].payload[0].endsWith('00') ? '01' : '00');
    assert.throws(() => recover(1, 2, corrupt, tree.checkpoint()), /archive/);
  } finally {
    seed.fill(0);
    for (const value of Object.values(restored)) if (value instanceof Uint8Array) value.fill(0);
  }
});
