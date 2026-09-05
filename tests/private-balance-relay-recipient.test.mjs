import assert from 'node:assert/strict';
import test from 'node:test';
import { encodePrivateAddress } from '@stellarkey/private-balance';
import { privateRelayRecipientDiversifier } from '../src/features/private-balance/relay/recipient.ts';
import { humanizePrivateError } from '../src/features/private-balance/copy.ts';

function address(diversifier, prefix = 'tskpay_') {
  return encodePrivateAddress({ deploymentTag: new Uint8Array(16).fill(1), diversifier,
    ownerCommitment: new Uint8Array(32).fill(1), hpkePublicKey: new Uint8Array(32).fill(2) }, prefix);
}

test('default relay recipient receives actionable guidance without echoing the address', async () => {
  const recipient = address(new Uint8Array(4));
  await assert.rejects(privateRelayRecipientDiversifier(recipient, 'tskpay_'), cause => {
    const shown = humanizePrivateError(cause);
    assert.equal(shown.title, 'A new recipient address is needed');
    assert.equal(shown.action, 'check-address');
    assert.match(shown.body, /recipient.*Receive.*Private.*Shielded.*New address/u);
    assert.match(shown.body, /replace/u);
    assert.equal(JSON.stringify(shown).includes(recipient), false);
    return true;
  });
});

test('relay recipient accepts canonical nonzero diversifiers on both networks', async () => {
  for (const prefix of ['tskpay_', 'skpay_']) {
    assert.equal(await privateRelayRecipientDiversifier(address(Uint8Array.of(0, 0, 0, 1), prefix), prefix), '00000001');
    assert.equal(await privateRelayRecipientDiversifier(address(Uint8Array.of(1, 2, 3, 4), prefix), prefix), '01020304');
  }
});

test('relay preflight retains malformed and wrong-network address rejection', async () => {
  await assert.rejects(privateRelayRecipientDiversifier('not-an-address', 'tskpay_'));
  await assert.rejects(privateRelayRecipientDiversifier(address(Uint8Array.of(1, 2, 3, 4)), 'skpay_'));
});
