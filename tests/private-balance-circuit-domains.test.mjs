import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const domains = [
  ['owner.circom', 'DOMAIN_OWNER', 'SKSB_OWNER_V1'],
  ['owner.circom', 'DOMAIN_DIVERSIFIED_OWNER', 'SKSB_DIVERSIFIED_OWNER_V1'],
  ['note.circom', 'DOMAIN_NOTE_COMMITMENT', 'SKSB_NOTE_COMMITMENT_V1'],
  ['nullifier.circom', 'DOMAIN_NULLIFIER', 'SKSB_NULLIFIER_V1'],
  ['nullifier.circom', 'DOMAIN_DUMMY_NULLIFIER', 'SKSB_DUMMY_NULLIFIER_V1'],
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

test('every arity-three protocol hash except MerkleParent occupies slot zero with a domain', () => {
  const circuitsDir = join(
    process.cwd(),
    'protocol/private-balance/circuits/circom',
  );
  const calls = [];

  for (const file of readdirSync(circuitsDir).filter(name => name.endsWith('.circom'))) {
    const source = readFileSync(join(circuitsDir, file), 'utf8');
    const templates = [...source.matchAll(/template\s+(\w+)\([^)]*\)\s*\{/gu)];
    for (let index = 0; index < templates.length; index += 1) {
      const start = templates[index].index;
      const end = templates[index + 1]?.index ?? source.length;
      const body = source.slice(start, end);
      for (const match of body.matchAll(/component\s+(\w+)\s*=\s*Poseidon2Hash\(3\);/gu)) {
        const component = match[1];
        calls.push({
          file,
          template: templates[index][1],
          domainInSlotZero: new RegExp(
            `${component}\\.in\\[0\\]\\s*<==\\s*DOMAIN_[A-Z0-9_]+`,
            'u',
          ).test(body),
        });
      }
    }
  }

  assert.ok(calls.length > 0, 'arity-three call sites are enumerated');
  assert.deepEqual(
    calls.filter(call => !call.domainInSlotZero),
    [{ file: 'merkle.circom', template: 'MerkleParent', domainInSlotZero: false }],
  );
});

test('protocol docs state that the Poseidon2 length IV separates arities only', () => {
  const protocol = readFileSync(
    join(process.cwd(), 'protocol/private-balance/docs/protocol-v1.md'),
    'utf8',
  );
  const threatModel = readFileSync(
    join(process.cwd(), 'protocol/private-balance/docs/threat-model.md'),
    'utf8',
  );
  const circuit = readFileSync(
    join(process.cwd(), 'protocol/private-balance/circuits/circom/merkle.circom'),
    'utf8',
  );

  for (const source of [protocol, threatModel, circuit]) {
    assert.match(source, /length IV\s+separates\s+(?:hashes\s+)?by\s+arity\s+only/iu);
  }
  assert.match(protocol, /every other arity-three protocol hash/iu);
  assert.match(threatModel, /preimage and collision resistance/iu);
});
