import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';

const read = name => readFileSync(new URL(`../docs/${name}`, import.meta.url), 'utf8');
const readSource = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const formatNumber = value => new Intl.NumberFormat('en-US', { useGrouping: true }).format(value);
const formatMicroseconds = value => new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
}).format(value);
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('private balance documentation states exact privacy, recovery, and support boundaries', () => {
  const product = read('private-balance.md');
  const recovery = read('private-balance-recovery.md');
  const incident = read('private-balance-incident-response.md');
  const support = read('private-balance-support.md');
  const combined = `${product}\n${recovery}\n${incident}\n${support}`;

  assert.match(product, /Testnet-only development candidate/is);
  assert.match(product, /catalogue is\s+empty/is);
  assert.match(product, /single-party setup/i);
  assert.match(product, /passes.*pinned Powers-of-Tau transcript/is);
  assert.match(product, /does not make.*safe for real value/is);
  assert.match(product, /Mainnet.*reject/is);
  assert.match(product, /no application backend/i);
  assert.match(product, /fee-paying.*public|public.*fee-paying/is);
  assert.match(product, /timing.*pool activity|pool activity.*timing/is);
  assert.match(product, /RPC.*IP|IP.*RPC/is);
  assert.match(recovery, /encrypted backup/i);
  assert.match(recovery, /seed-only/i);
  assert.match(recovery, /restoration.*fee|fee.*restoration/is);
  assert.match(incident, /guardian.*pause|pause.*guardian/is);
  assert.match(incident, /manifest|artifact/i);
  assert.match(support, /never ask/i);
  for (const secret of ['recovery phrase', 'private address', 'viewing key', 'note plaintext', 'backup']) {
    assert.match(support, new RegExp(secret, 'i'));
  }
  assert.doesNotMatch(combined, /anonymous|untraceable|guaranteed private/i);
});

test('the Private Balance whitepaper matches the implemented replacement protocol', () => {
  const paper = read('private-balance.md');
  const protocolSpec = readSource('protocol/private-balance/docs/protocol-v1.md');
  const noteCircuit = readSource('protocol/private-balance/circuits/circom/note.circom');
  const manifest = JSON.parse(readSource('public/protocol/private-balance/v1/manifest.json'));
  const evidence = JSON.parse(readSource('protocol/private-balance/results/review-validation.json'));
  const noteInputs = [...noteCircuit.matchAll(/signal input (\w+);/g)].map(([, input]) => input);
  const circuit = evidence.circuit.ternaryDepth17;
  const constants = manifest.constants;
  const artifacts = manifest.artifacts;
  const r1csByteLength = statSync(
    new URL('../protocol/private-balance/circuits/build/action.r1cs', import.meta.url),
  ).size;

  assert.equal(artifacts.r1csConstraints, circuit.constraints);
  assert.equal(constants.treeDepth, 17);
  assert.equal(constants.treeArity, 3);
  assert.equal(constants.publicInputs, circuit.publicInputs);
  assert.deepEqual(noteInputs, ['contextField', 'assetField', 'ownerCommitment', 'value', 'rho']);
  assert.match(paper, /StellarKey Private Balance Whitepaper/i);
  assert.match(paper, /internal\s+transfers.*without publishing.*recipient/is);
  assert.match(paper, /deposits and withdrawals.*public endpoints/is);
  assert.doesNotMatch(paper, /each state transition without publishing.*recipient/is);
  assert.match(paper, /BN254.*Groth16|Groth16.*BN254/is);
  assert.match(paper, /Poseidon2.*width 4.*rate 3/is);
  assert.match(
    paper,
    new RegExp(`\\| Constraints \\| ${escapeRegExp(formatNumber(circuit.constraints))},`, 'i'),
  );
  assert.match(
    paper,
    new RegExp(`${circuit.publicInputs} public\\s+inputs, and ${circuit.privateInputs} private inputs`, 'i'),
  );
  assert.match(paper, new RegExp(`ternary.*depth[- ]${constants.treeDepth}`, 'is'));
  assert.match(
    paper,
    new RegExp(
      `3\\^${constants.treeDepth}.*${escapeRegExp(formatNumber(circuit.capacityLeaves))}`,
      'is',
    ),
  );
  assert.match(paper, /two input lanes.*two output lanes/is);
  assert.match(paper, /randomiz(?:e|es|ed|ing).*lane ordering/is);
  assert.match(paper, /randomizes.*input lane ordering.*output lane ordering/is);
  assert.match(paper, /zero-value dummy notes/i);
  assert.match(paper, /at least one output is real.*private outputs sum to.*deposited value/is);
  assert.doesNotMatch(paper, /at least one output has the deposited value/i);
  assert.match(paper, /34-node frontier/i);
  assert.match(paper, /authenticated incremental.*Merkle/is);
  assert.match(
    paper,
    new RegExp(
      `${constants.recipientEnvelopeBytes}-byte recipient envelope.*${constants.outgoingEnvelopeBytes}-byte outgoing envelope`,
      'is',
    ),
  );
  assert.match(paper, /outgoing.*recipient fingerprint.*memo/is);
  assert.match(paper, /seed-recovered activity.*fingerprint.*not.*full.*address/is);
  assert.match(paper, /ordinary sends.*full private address.*encrypted recent-recipient/is);
  assert.match(paper, /`tskpay_`.*128.*`skpay_`.*127/is);
  assert.match(paper, /asset-pinned pool/i);
  assert.match(paper, /independent RPC.*overlapping ledger hash/is);
  assert.match(paper, /largest safe.*contiguous.*batch/is);
  assert.match(paper, /confirmed.*durable on-chain.*sync.*rereads.*encrypted.*checkpoint/is);
  assert.match(paper, /interruption before.*sync.*rescan/is);
  assert.doesNotMatch(paper, /stores an encrypted resume cursor/i);
  assert.match(paper, /no backward-compatible.*migration/i);
  assert.match(paper, /authenticated deployment catalogue is empty/is);
  assert.match(paper, /BLS12-381.*not selected/is);
  assert.match(paper, /recursive proofs.*not implemented/is);
  assert.match(paper, /protocol\/private-balance\/docs\/protocol-v1\.md/);
  assert.match(protocolSpec, /NoteCommitment.*context.*asset.*owner commitment.*value.*`rho`/is);
  assert.match(protocolSpec, /memo.*authenticated.*envelope.*not.*commitment/is);
  for (const byteLength of [
    r1csByteLength,
    artifacts.wasmByteLength,
    artifacts.zkeyByteLength,
    artifacts.zkeyTransport.byteLength,
    artifacts.zkeyTransport.wireByteLength,
  ].filter(Number.isInteger)) {
    assert.ok(paper.includes(`${formatNumber(byteLength)} bytes`));
  }
  assert.ok(
    paper.includes(`${formatMicroseconds(evidence.x25519.nativeJwk.p50Microseconds)} microseconds`),
  );
  assert.ok(
    paper.includes(
      `${formatMicroseconds(evidence.x25519.nativePkcs8Prototype.p50Microseconds)} microseconds`,
    ),
  );
  assert.ok(paper.includes(`${evidence.x25519.pkcs8MedianImprovementPercent}% median improvement`));
});

test('the public private-payments page describes the undeployed Testnet candidate consistently', () => {
  const page = readSource('src/app/private/page.tsx');
  assert.match(page, /publishes no active Private Payments deployment/is);
  assert.match(page, /fresh Testnet pools/is);
  assert.doesNotMatch(page, /current key fails.*production availability is off/is);
});

test('consensus-affecting protocol review decisions are explicit and linked', () => {
  const spec = readSource('protocol/private-balance/docs/protocol-v1.md');
  const decisions = [
    ['0002-private-note-key-agreement.md', /RFC 9180.*retain|retain.*RFC 9180/is],
    ['0003-multi-asset-pool.md', /asset-pinned.*retain|retain.*asset-pinned/is],
    ['0004-poseidon2-capacity-domain.md', /Soroban.*host|host.*Soroban/is],
  ];

  for (const [file, expectedDecision] of decisions) {
    const decision = readSource(`protocol/private-balance/docs/decisions/${file}`);
    assert.match(decision, /## Status\s+Rejected/is);
    assert.match(decision, expectedDecision);
    assert.match(spec, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  }
});
