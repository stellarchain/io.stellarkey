import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

test('the printable whitepaper stays synchronized with the maintained paper and application release', () => {
  const paper = read('private-balance.md');
  const latex = read('whitepaper/private-payments.tex');
  const version = JSON.parse(readSource('package.json')).version;
  const digest = createHash('sha256').update(paper).digest('hex');
  assert.ok(paper.includes(`**Application version:** StellarKey ${version}`));
  assert.ok(latex.includes(`% Markdown SHA-256: ${digest}`), 'Regenerate the printable whitepaper with docs/whitepaper/build.py');
  assert.ok(latex.includes(`pdfsubject={StellarKey ${version};`));
  assert.ok(latex.includes('pdfauthor={DRAFT}'));
  assert.ok(latex.includes('support@stellarkey.io'));
  assert.ok(latex.includes('\\begin{thebibliography}{10}'));
  assert.equal((latex.match(/\\bibitem\{/g) ?? []).length, 10);
});

test('private balance documentation states exact privacy, recovery, and support boundaries', () => {
  const product = read('private-balance.md');
  const recovery = read('private-balance-recovery.md');
  const incident = read('private-balance-incident-response.md');
  const support = read('private-balance-support.md');
  const combined = `${product}\n${recovery}\n${incident}\n${support}`;

  assert.match(product, /Live Testnet development deployment/is);
  assert.match(product, /authenticated deployment\s+catalogue.*XLM.*USDC/is);
  assert.match(product, /single-party setup/i);
  assert.match(product, /passes.*pinned Powers-of-Tau transcript/is);
  assert.match(product, /does not make.*safe for real value/is);
  assert.match(product, /Mainnet.*reject/is);
  assert.match(product, /no (?:application|StellarKey) backend/i);
  assert.match(product, /transaction source.*public|public.*transaction source/is);
  assert.match(product, /Direct mode.*user's public Stellar account|user's public Stellar account.*Direct mode/is);
  assert.match(product, /Peer relaying and helper earnings have been removed/is);
  assert.match(product, /stale relayed reviews are rejected/is);
  assert.match(product, /obsolete relay-chain consent.*does\s+not release pending inputs/is);
  assert.match(product, /No public relayer address or fee/is);
  assert.match(product, /never silently fall\s+back/is);
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
  const browserEvidence = JSON.parse(
    readSource('protocol/private-balance/results/mvp-e2e.json'),
  );
  const witnessEvidence = JSON.parse(
    readSource('protocol/private-balance/results/rpc-witness-validation.json'),
  );
  const noteInputs = [...noteCircuit.matchAll(/signal input (\w+);/g)].map(([, input]) => input);
  const constants = manifest.constants;
  const artifacts = manifest.artifacts;
  const circuit = {
    constraints: artifacts.r1csConstraints,
    publicInputs: constants.publicInputs,
    privateInputs: 410,
    capacityLeaves: BigInt(constants.treeArity) ** BigInt(constants.treeDepth),
  };
  const r1csByteLength = statSync(
    new URL('../protocol/private-balance/circuits/build/action.r1cs', import.meta.url),
  ).size;

  assert.equal(artifacts.r1csConstraints, circuit.constraints);
  assert.equal(constants.treeDepth, 64);
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
  assert.match(paper, /two input lanes.*three output lanes/is);
  assert.match(paper, /randomiz(?:e|es|ed|ing).*lane ordering/is);
  assert.match(paper, /randomizes.*input lane ordering.*output lane ordering/is);
  assert.match(paper, /common clear action diversifier/is);
  assert.match(paper, /prevents.*identifying output roles/is);
  assert.match(paper, /reusing a receive\s+address.*link/is);
  assert.match(paper, /checksum.*overwhelmingly\s+likely.*not.*guarantee/is);
  assert.doesNotMatch(paper, /diversifiers prevent change from reusing/i);
  assert.match(paper, /zero-value dummy notes/i);
  assert.match(paper, /at least one output is real.*private outputs sum to.*deposited value/is);
  assert.doesNotMatch(paper, /at least one output has the deposited value/i);
  assert.match(paper, /128-node frontier/i);
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
  assert.match(paper, /append-only asset registry/i);
  assert.match(paper, /`Active` and `ExitOnly`/i);
  assert.match(paper, /Internal transfers publish neither the\s+asset contract nor registry index/is);
  assert.match(paper, /routine.*witness.*enabled by default/is);
  assert.match(paper, /routine.*witness.*disabled/is);
  assert.match(paper, /seed recovery.*full history.*always\s+require.*witness/is);
  assert.match(paper, /different-origin RPC.*overlapping ledger hash/is);
  assert.match(paper, /cannot prove operator\s+independence.*custom primary/is);
  assert.equal(witnessEvidence.ankrCorroboration.witnessRpc, manifest.witnessRpcUrl);
  assert.equal(witnessEvidence.ankrCorroboration.rateLimitFailures, 0);
  assert.equal(witnessEvidence.ankrCorroboration.attempts.length, 5);
  assert.ok(
    witnessEvidence.ankrCorroboration.attempts.every(
      attempt => attempt.assetCount === manifest.assets.length,
    ),
  );
  assert.ok(paper.includes('rpc-witness-validation.json'));
  assert.match(paper, /deployment checkpoint.*aged out.*current overlapping ledger.*contract head/is);
  assert.match(paper, /largest safe.*contiguous.*batch/is);
  assert.match(paper, /confirmed.*durable on-chain.*sync.*rereads.*encrypted.*checkpoint/is);
  assert.match(paper, /interruption before.*sync.*rescan/is);
  assert.doesNotMatch(paper, /stores an encrypted resume cursor/i);
  assert.match(paper, /no\s+backward-compatible.*migration/is);
  assert.match(paper, /Legacy relayed or unknown-route records are\s+reconcile-only/is);
  assert.match(paper, /historical.*fee notes remain readable/is);
  assert.doesNotMatch(paper, /## 13\. Optional browser peer relay/);
  assert.match(paper, /authenticated deployment\s+catalogue.*XLM.*USDC/is);
  assert.match(paper, /one live XLM\/USDC development pool on Testnet/is);
  assert.match(paper, /does not contain a deployment\s+transaction hash.*on-chain executable/is);
  assert.match(paper, /passed.*full `snarkjs powersoftau verify`/is);
  assert.match(paper, /does not attest participants.*secret erasure/is);
  assert.match(paper, /Testnet reset.*redeploy/is);
  assert.equal(browserEvidence.passed, true);
  assert.ok(paper.includes(browserEvidence.sourceCommit.slice(0, 7)));
  assert.ok(paper.includes(browserEvidence.fixtureManifestSha256));
  assert.match(paper, /ten.*desktop Chromium.*four.*browser smoke/is);
  assert.match(paper, /iPhone.*iPad.*emulation.*not physical-device/is);
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

test('the public private-payments page describes the live development Testnet deployment consistently', () => {
  const page = readSource('src/app/private/page.tsx');
  assert.match(page, /live.*Testnet.*XLM.*USDC/is);
  assert.match(page, /development.*single-party/is);
  assert.doesNotMatch(page, /current key fails.*production availability is off/is);
});

test('the whitepaper distinguishes issued receive addresses, dummy lanes, and recipient recovery metadata', () => {
  const paper = read('private-balance.md');
  const storage = readSource('src/features/private-balance/runtime/storage.ts');
  const issuanceBound = Number(storage.match(/MAX_ISSUED_PRIVATE_DIVERSIFIERS = ([\d_]+)/)?.[1].replaceAll('_', ''));
  assert.equal(issuanceBound, 65_536);
  assert.ok(paper.includes(formatNumber(issuanceBound)));
  assert.match(paper, /First setup generates a random non-zero receive diversifier/);
  assert.match(paper, /replaces a stored legacy zero-diversifier address once/);
  assert.match(paper, /preserving an existing diversified address exactly/);
  assert.match(paper, /records.*old diversifier.*before publishing/is);
  assert.doesNotMatch(paper, /retains the current legacy address/i);
  assert.match(paper, /Dummy lanes\s+share the same clear action diversifier/);
  assert.match(paper, /Scalar-field elements.*below `Fr`.*proof coordinates.*`Fq`/s);
  assert.match(paper, /wrong redundant asset index.*does not discard that note/is);
  assert.match(paper, /canonical archive, registry, transcript, or tree\s+corruption.*fails closed/is);
  assert.match(paper, /Neither a recipient-metadata failure nor\s+a canonical validation failure releases/is);
});

test('the whitepaper keeps contract restoration distinct from getters and the private action fee cap', () => {
  const paper = read('private-balance.md');
  const feePolicy = readSource('src/features/private-balance/runtime/fee-policy.ts');
  const cap = BigInt(feePolicy.match(/MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS = ([\d_]+)n/)?.[1].replaceAll('_', ''));
  assert.equal(cap, 10_000_000n);
  assert.ok(paper.includes(`${formatNumber(cap)} stroops (1 XLM)`));
  assert.match(paper, /separate from the reviewed classic inclusion fee/);
  assert.match(paper, /unsigned review rejects fee-bump envelopes supplied by another party/);
  assert.match(paper, /resource fee is charged once/);
  assert.match(paper, /submitted outer hash together with the reviewed inner hash/);
  assert.match(paper, /fee sponsorship does not hide either identity/);
  assert.match(paper, /does not verify a Stellar Asset Contract\s+executable or attest token behavior/);
  assert.match(paper, /does not extend its own code\/instance TTL/);
  assert.match(paper, /`touch_root` extends only the\s+temporary known-root entry/);
  assert.match(paper, /no automatic keepalive service or in-wallet shared-code\/instance\s+restoration workflow/);
  assert.match(paper, /match fresh archived ledger data byte-for-byte/);
  assert.match(paper, /does not sign, submit, pay for restoration/);
  assert.match(paper, /readable getter is not\s+proof.*fee cap/is);
  assert.match(paper, /resource fee above that cap is rejected before signing/);
  assert.match(paper, /expired deposit\s+review.*does not submit it automatically/is);
});

test('the whitepaper describes competing held-input recovery and the scope of current evidence', () => {
  const paper = read('private-balance.md');
  const recovery = readSource('src/features/private-balance/runtime/spend-recovery.ts');
  for (const outcome of ['recovered', 'original-confirmed', 'conflict-confirmed', 'pending']) {
    assert.ok(recovery.includes(`'${outcome}'`));
  }
  assert.match(paper, /direct self-transfer of exactly its one or two reserved inputs/);
  assert.match(paper, /one pending action,\s+no build reservation, and no active chained approval/);
  assert.match(paper, /separately asks for proof-sharing and\s+signing consent/);
  assert.match(paper, /competing spend, not cancellation or instant unlocking/);
  assert.match(paper, /replacement does not revoke the original proof/);
  assert.match(paper, /If neither spend\s+confirms, the balance can remain held/);
  assert.match(paper, /exposed spend proof, absence alone is never sufficient/);
  assert.match(paper, /Worker readiness is distinct from wallet\/session authority/);
  assert.match(paper, /worker recovery does not automatically retry a payment/);
  assert.match(paper, /missing address is\s+not itself evidence of loading/);
  assert.match(paper, /historical browser run.*is not a new end-to-end validation/is);
  assert.match(paper, /does not\s+establish a successful user payment or USDC\s+action/);
  assert.match(paper, /does not renew those dated results or constitute a security audit/);
  assert.match(paper, /Detached outcome watchers also capture revocable\s+wallet\/runtime authority/);
  assert.match(paper, /serialize journal classification with canonical synchronization/);
  assert.match(paper, /September 12.*detached-watcher follow-up.*89 passing/is);
  assert.doesNotMatch(paper, /outstanding detached-reconciliation publisher-ownership follow-up/);
});

test('every local whitepaper source and evidence link resolves to a file', () => {
  const paperUrl = new URL('../docs/private-balance.md', import.meta.url);
  const paper = read('private-balance.md');
  const links = [...paper.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map(([, target]) => target)
    .filter(target => !/^(?:https?:|#)/.test(target));
  assert.ok(links.length > 10);
  for (const target of links) {
    assert.ok(statSync(new URL(target.split('#')[0], paperUrl)).isFile(), target);
  }
});

test('consensus-affecting protocol review decisions are explicit and linked', () => {
  const spec = readSource('protocol/private-balance/docs/protocol-v1.md');
  const decisions = [
    ['0002-private-note-key-agreement.md', /RFC 9180.*retain|retain.*RFC 9180/is],
    ['0004-poseidon2-capacity-domain.md', /Soroban.*host|host.*Soroban/is],
  ];

  for (const [file, expectedDecision] of decisions) {
    const decision = readSource(`protocol/private-balance/docs/decisions/${file}`);
    assert.match(decision, /## Status\s+Rejected/is);
    assert.match(decision, expectedDecision);
    assert.match(spec, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  }

  const operationalDecisions = [
    ['0006-association-sets.md', /4,573.*constraints/is, /Rejected/i],
    ['0007-stealth-subsystem.md', /complementary/is, /Accepted/i],
    ['0008-governed-asset-private-pool.md', /append-only.*asset registry/is, /Accepted/i],
    ['0009-browser-peer-relay.md', /never.*silently.*fall.*back/is, /Superseded by direct-only submission/i],
  ];
  for (const [file, expectedDecision, status] of operationalDecisions) {
    const decision = readSource(`protocol/private-balance/docs/decisions/${file}`);
    assert.match(decision, new RegExp(`## Status\\s+${status.source}`, 'is'));
    assert.match(decision, expectedDecision);
    assert.match(spec, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  }
});


test('the manuscript dates actual V2 ledger confirmation separately from historical browser evidence', () => {
  const paper = read('private-balance.md');
  const evidence = JSON.parse(readSource('protocol/private-balance/results/capacity-testnet-lifecycle.json'));
  const manifest = JSON.parse(readSource('public/protocol/private-balance/v1/manifest.json'));
  assert.equal(evidence.passed, true);
  assert.equal(evidence.poolContractId, manifest.poolContractId);
  assert.equal(evidence.wasmSha256, manifest.release.contractWasmSha256);
  assert.equal(evidence.r1csSha256, manifest.artifacts.r1csSha256);
  assert.deepEqual(evidence.actions.map(action => action.method), ['deposit', 'transfer', 'full_input_exit']);
  assert.deepEqual(evidence.actions.map(action => action.leafAdvance), [3, 3, 0]);
  for (const action of evidence.actions) {
    assert.equal(action.confirmed, true);
    assert.ok(paper.includes(formatNumber(action.ledger)));
    assert.ok(paper.includes(formatNumber(BigInt(action.minimumResourceFeeStroops))));
  }
  assert.match(paper, /command-line synthetic test.*not.*browser-wallet or USDC test/is);
});
