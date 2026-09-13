import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the public explainer matches the shipped V2 circuit and proving artifacts', () => {
  const page = read('src/app/private/page.tsx');
  const manifest = JSON.parse(read('public/protocol/private-balance/v1/manifest.json'));
  const { artifacts, constants } = manifest;
  const number = value => value.toLocaleString('en-GB');
  for (const fact of [
    `Protocol V${manifest.protocolVersion}`,
    `${number(artifacts.r1csConstraints)} constraints`,
    `${constants.publicInputs} public inputs`,
    `depth-${constants.treeDepth} tree`,
    `${number(artifacts.wasmByteLength)}-byte`,
    `${number(artifacts.zkeyTransport.byteLength)} bytes point-compressed`,
    `${number(artifacts.zkeyByteLength)} bytes expanded`,
  ]) assert.ok(page.includes(fact), `Public explainer missing current fact: ${fact}`);
  assert.doesNotMatch(page, /15,114|17 levels|depth-17|129,140,163|9,264,916|154,930/);
  assert.match(page, /no backward-compatible.*migration/is);
  assert.match(page, /September 13, 2026.*SDF.*Ankr/is);
  assert.match(page, /not a browser-wallet or USDC test/i);
  assert.match(page, /Mainnet.*refus|refus.*Mainnet/is);
  assert.match(page, /single-party.*forge proofs/is);
});

test('the public explainer keeps exit, recovery and metadata limits explicit', () => {
  const page = read('src/app/private/page.tsx');
  assert.match(page, /full-input exit.*without appending commitments/is);
  assert.match(page, /partial withdrawal.*change.*capacity/is);
  assert.match(page, /64 steps.*15 minutes/is);
  assert.match(page, /not one atomic.*withdrawal/is);
  assert.match(page, /held.*self-transfer.*free commitment slots/is);
  assert.match(page, /does not revoke the original proof/i);
  assert.match(page, /outgoing recovery.*disabled.*cannot.*recipient.*memo/is);
  assert.match(page, /seed-only recovery cannot reconstruct.*unconfirmed shared proof/is);
  assert.match(page, /fee payer.*does not hide/is);
  assert.match(page, /stealth.*public Stellar accounts/is);
  assert.match(page, /public proving files.*request metadata/is);
  assert.doesNotMatch(page, /readable by no one|Your recovery phrase is enough|None of the proving machinery is taken on trust/);
});
