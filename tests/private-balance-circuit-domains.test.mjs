import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const domains = [
  ['owner.circom', 'DOMAIN_OWNER', 'SKSB_OWNER_V1'],
  ['owner.circom', 'DOMAIN_DIVERSIFIED_OWNER', 'SKSB_DIVERSIFIED_OWNER_V2'],
  ['note.circom', 'DOMAIN_NOTE_COMMITMENT', 'SKSB_NOTE_COMMITMENT_V1'],
  ['nullifier.circom', 'DOMAIN_NULLIFIER', 'SKSB_NULLIFIER_V1'],
  ['merkle.circom', 'DOMAIN_MERKLE_NODE', 'SKSB_MERKLE_NODE_V1'],
  ['action_binding.circom', 'DOMAIN_ACTION_BINDING', 'SKSB_ACTION_BINDING_V1'],
];

function domainField(label) {
  const digest = createHash('sha256').update(label, 'ascii').digest('hex');
  return BigInt(`0x${digest}`) % FIELD_MODULUS;
}

test('Circom domain literals match canonical Rust and browser SHA-256 field derivation', () => {
  for (const [file, variable, label] of domains) {
    const source = readFileSync(join(
      process.cwd(),
      'protocol/private-balance/circuits/circom',
      file,
    ), 'utf8');
    const match = source.match(new RegExp(`var ${variable} = ([0-9]+);`));
    assert.ok(match, `${file} declares ${variable}`);
    assert.equal(BigInt(match[1]), domainField(label), `${file} ${variable}`);
  }
});
