import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Stellar trademark notices begin on a new line after the independence statement', () => {
  for (const path of ['src/components/PublicFooter.tsx', 'src/components/marketing/MarketingChrome.tsx',
    'src/components/SettingsPage.tsx', 'src/app/about/page.tsx']) {
    assert.ok(/Foundation\.\s*<br\s*\/>\s*“Stellar” is a trademark/.test(read(path)), path);
  }
});

test('homepage copy matches the current circuit and does not overclaim privacy or recovery', () => {
  const landing = read('src/components/marketing/LandingBody.tsx');
  const metadata = read('src/app/page.tsx');
  const manifest = JSON.parse(read('public/protocol/private-balance/v1/manifest.json'));
  assert.ok(landing.includes(`${manifest.artifacts.r1csConstraints.toLocaleString('en-GB')} constraints`));
  assert.match(landing, /Protocol V2.*unaudited.*Testnet-only/);
  assert.match(landing, /public and verifiable.*private witness stays local/);
  assert.match(landing, /Pending-proof holds.*local metadata.*backup/);
  assert.match(landing, /does not process cards/);
  assert.match(landing, /issuer authorization, freeze or clawback/);
  assert.match(metadata, /point of sale/);
  for (const source of [landing, metadata]) {
    assert.doesNotMatch(source, /56,757|readable by no one|Recovery is your phrase alone|the ledger sees none of it|The only thing that crosses is the proof|a card machine/);
  }
});

test('public copy uses the current release identity and preserves Protocol V2 limits', () => {
  const about = read('src/app/about/page.tsx');
  const page = read('src/app/private/page.tsx');
  const security = read('src/app/security/page.tsx');
  for (const source of [about, page, security]) {
    assert.doesNotMatch(source, /\b(?:Release|StellarKey)\s+1\.[2-5]\.\d+\b/i);
    assert.match(source, /APPLICATION_VERSION/);
  }
  assert.match(about, /Protocol V2.*unaudited.*Testnet-only/i);
  assert.match(about, /canonical archive.*encrypted backup/i);
  assert.match(page, /current application release.*1\.0\.0 application baseline/i);
  assert.doesNotMatch(page, /Peer relaying has been removed/i);
  assert.match(security, /For release 1\.0\.2.*deferred.*VoiceOver.*NVDA.*not passed/is);
});

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
  assert.match(page, /application baseline/i);
  assert.match(page, /unsupported records are rejected without being rewritten/i);
  assert.doesNotMatch(page, /legacy|historical fee notes|retired V1/i);
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
