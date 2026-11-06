import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const parse = (path) => JSON.parse(read(path));
const baseline = read('protocol/private-balance/parameters/hpke-deployment-lock.json');
const current = parse('protocol/private-balance/packages/browser/package-lock.json');
const application = parse('package-lock.json');
const declared = parse('protocol/private-balance/packages/browser/package.json');
const verifierUrl = new URL('protocol/private-balance/scripts/hpke-lock-provenance.mjs', root);
const deploymentDigest = '312a82fc6626f2bb66b1a24f351f8e13f95bde25fa4de350a8b10d2f4fe7a6b7';

async function verify(lock = current, original = baseline, app = application, manifest = declared) {
  assert.ok(existsSync(verifierUrl), 'dependency maintenance needs a verifier that preserves deployment provenance');
  const { verifyHpkeLockMaintenance } = await import(verifierUrl);
  return verifyHpkeLockMaintenance({
    baselineBytes: original, currentBytes: Buffer.from(JSON.stringify(lock)),
    applicationLock: app, browserPackage: manifest,
  });
}

test('reviewed browser dependency maintenance retains the historical HPKE deployment digest', async () => {
  assert.equal(await verify(), deploymentDigest);
});

test('historical deployment lock corruption fails closed', async () => {
  await assert.rejects(() => verify(current, Buffer.concat([baseline, Buffer.from(' ')])), /deployment lock integrity/);
});

test('changes to any recorded HPKE package fail closed', async () => {
  for (const path of Object.keys(current.packages).filter((path) => path.includes('/@hpke/'))) {
    for (const field of ['version', 'resolved', 'integrity', 'dependencies']) {
      const lock = structuredClone(current);
      lock.packages[path][field] = field === 'dependencies' ? { unexpected: '1.0.0' } : 'changed';
      await assert.rejects(() => verify(lock), /reviewed maintenance/);
    }
  }
});

test('unreviewed package additions, removals and metadata drift fail closed', async () => {
  for (const mutate of [
    (lock) => { lock.packages['node_modules/minimatch'].version = '5.2.0'; },
    (lock) => { delete lock.packages['node_modules/balanced-match']; },
    (lock) => { lock.packages['node_modules/unreviewed'] = { version: '1.0.0' }; },
    (lock) => { lock.packages['node_modules/brace-expansion'].version = '2.1.6'; },
    (lock) => { lock.packages['node_modules/snarkjs'].integrity = 'changed'; },
  ]) {
    const lock = structuredClone(current);
    mutate(lock);
    await assert.rejects(() => verify(lock), /reviewed maintenance/);
  }
});

test('Noble lock repair must retain the application packages and declared dependency', async () => {
  for (const path of ['node_modules/@noble/curves', 'node_modules/@noble/curves/node_modules/@noble/hashes']) {
    const app = structuredClone(application);
    app.packages[path].integrity = 'changed';
    await assert.rejects(() => verify(current, baseline, app), /Noble/);
  }
  const manifest = structuredClone(declared);
  manifest.dependencies['@noble/curves'] = '2.4.0';
  await assert.rejects(() => verify(current, baseline, application, manifest), /Noble/);
});

test('the installed protocol CLI glob adapter preserves ordinary matching and bounds nested expansion', () => {
  const browserRequire = createRequire(new URL('protocol/private-balance/packages/browser/package.json', root));
  const snarkRequire = createRequire(browserRequire.resolve('snarkjs'));
  const ejsRequire = createRequire(snarkRequire.resolve('ejs'));
  const jakeRequire = createRequire(ejsRequire.resolve('jake'));
  const filelistRequire = createRequire(jakeRequire.resolve('filelist'));
  const minimatch = filelistRequire('minimatch');
  assert.equal(minimatch('src/keys.ts', 'src/{address,keys}.ts'), true);
  assert.equal(minimatch('src/other.ts', 'src/{address,keys}.ts'), false);
  assert.deepEqual(minimatch.braceExpand('fixture{1..3}.json'), ['fixture1.json', 'fixture2.json', 'fixture3.json']);
  assert.doesNotThrow(() => minimatch.braceExpand('{'.repeat(6000) + 'a,b' + '}'.repeat(6000)));
  const minimatchRequire = createRequire(filelistRequire.resolve('minimatch'));
  const expand = minimatchRequire('brace-expansion');
  assert.deepEqual(expand('{a},b}'), ['a}', 'b']);
  assert.deepEqual(expand('{a},b}', { maxRewrites: 0 }), ['{a},b}']);
  assert.deepEqual(expand('{a}}},b}', { maxRewrites: 1 }), ['{a}}},b}']);
});
