import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applicationVerificationCommand } from './helpers/application-verification.mjs';

const require = createRequire(import.meta.url);
const { load } = require('js-yaml');
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const scripts = JSON.parse(read('package.json')).scripts;
const workflow = name => load(read(`.github/workflows/${name}.yml`));
const commands = job => job.steps.flatMap(step => step.run ? [step.run.trim()] : []);

test('splitting application verification preserves the complete ordered local gate', () => {
  assert.equal(applicationVerificationCommand(scripts),
    'npm run private:check-generated && npm run typecheck && npm test && npm run test:private-protocol && npm run lint && npm run audit:prod && npm run audit:all && npm run test:e2e:reporter && npm run test:e2e:private-ui && npm run test:e2e:private-components && npm run check:fixture-clean && npm run build && npm run check:fixture-clean && npm run test:bundle && npm run check:bundle && playwright test');
  assert.equal(scripts['verify:application'],
    'npm run verify:application:core && npm run verify:application:private && npm run verify:application:production');
  assert.equal(scripts['release:verify'], 'node scripts/assert-clean-release.mjs && npm run verify:application');
});

test('hosted application and private UI stages run independently in owned checkouts', async () => {
  const { default: components } = await import('../playwright.private-components.config.ts');
  for (const name of ['ci', 'release']) {
    const { jobs } = workflow(name);
    for (const id of ['application', 'private-ui']) {
      const job = jobs[id];
      assert.ok(job, `${name}: ${id} must be a separate job`);
      assert.equal(job.needs, undefined, `${id} must not wait on another verification lane`);
      assert.equal(job.if, undefined);
      assert.equal(job['continue-on-error'], undefined);
      assert.deepEqual(job.permissions, { contents: 'read' });
      assert.match(job.steps[0].uses, /^actions\/checkout@[a-f0-9]{40}$/);
      assert.ok(commands(job).includes('corepack npm ci'));
      assert.ok(commands(job).includes('corepack npm --prefix protocol/private-balance/circuits ci'));
      assert.ok(job.steps.some(step => step.uses === './.github/actions/setup-stellar-cli'));
      assert.ok(commands(job).includes('npx playwright install --with-deps chromium webkit'));
    }
    const application = commands(jobs.application);
    assert.ok(application.includes('npm run verify:application:core'));
    assert.ok(application.includes('npm run verify:application:production'));
    assert.ok(application.indexOf('npm run verify:application:core') < application.indexOf('npm run verify:application:production'));
    const privateUi = commands(jobs['private-ui']);
    assert.deepEqual(jobs['private-ui'].strategy, {
      'fail-fast': false,
      matrix: { browser: components.projects.map(project => project.name) },
    }, 'every required browser must have an isolated runner, without exclusions or optional failures');
    assert.ok(privateUi.includes('npm run private:check-generated'));
    assert.ok(privateUi.includes('npm run test:e2e:private-ui'));
    const componentCommand = 'npm run test:e2e:private-components -- --project="$BROWSER_PROJECT" && npm run check:fixture-clean';
    const componentStep = jobs['private-ui'].steps.find(step => step.run === componentCommand);
    assert.deepEqual(componentStep?.env, { BROWSER_PROJECT: '${{ matrix.browser }}' });
    assert.equal(componentStep?.if, undefined);
    assert.equal(componentStep?.['continue-on-error'], undefined);
    assert.ok(privateUi.indexOf('npm run private:check-generated') < privateUi.indexOf('npm run test:e2e:private-ui'));
    assert.ok(privateUi.indexOf('npm run test:e2e:private-ui') < privateUi.indexOf(componentCommand));
  }
});

test('lint rejects warnings as well as errors without suppressing rules', () => {
  assert.equal(scripts.lint, 'eslint --max-warnings=0');
});

test('the existing required verify status rejects every non-successful application lane', () => {
  const gate = workflow('ci').jobs.verify;
  assert.deepEqual(gate.needs, ['application', 'private-ui']);
  assert.equal(gate.if, '${{ always() }}');
  const [step] = gate.steps;
  assert.deepEqual(step.env, {
    APPLICATION_RESULT: '${{ needs.application.result }}',
    PRIVATE_UI_RESULT: '${{ needs.private-ui.result }}',
  });
  for (const application of ['success', 'failure', 'cancelled', 'skipped', '']) {
    for (const privateUi of ['success', 'failure', 'cancelled', 'skipped', '']) {
      const result = spawnSync('bash', ['-e', '-c', step.run], {
        env: { ...process.env, APPLICATION_RESULT: application, PRIVATE_UI_RESULT: privateUi },
        encoding: 'utf8',
      });
      assert.equal(result.status === 0, application === 'success' && privateUi === 'success');
    }
  }
});

test('publication joins every release gate and receives only the exact staged public bundle', () => {
  const { jobs } = workflow('release');
  assert.deepEqual(jobs.release.needs, ['private-gate-a', 'application', 'private-ui']);
  assert.equal(jobs.release.if, undefined, 'default success() must gate publication');
  assert.equal(jobs.deploy.needs, 'release');
  const application = jobs.application;
  const upload = application.steps.find(step => step.id === 'bundle');
  assert.match(upload.uses, /^actions\/upload-artifact@[a-f0-9]{40}$/);
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.equal(upload.with.overwrite, undefined);
  assert.equal(upload.with['compression-level'], 0);
  assert.equal(upload.with.name, 'release-${{ github.sha }}-${{ github.run_attempt }}');
  assert.equal(upload.with.path.trim(), 'release-artifacts/*.tar.gz\nrelease-artifacts/*.cdx.json\nrelease-artifacts/release-files.json\nrelease-artifacts/SHA256SUMS');
  assert.deepEqual(application.outputs, { 'artifact-id': '${{ steps.bundle.outputs.artifact-id }}' });
  const runs = commands(application);
  assert.ok(runs.indexOf('npm run verify:application:production') < runs.findIndex(run => run.startsWith('node scripts/create-release-artifact.mjs')));
  assert.ok(runs.some(run => run === 'node scripts/assert-clean-release.mjs --commit "$GITHUB_SHA" --tag "$GITHUB_REF_NAME"'));
  const privateCommands = commands(jobs['private-ui']);
  assert.equal(privateCommands.at(-1), 'node scripts/assert-clean-release.mjs --commit "$GITHUB_SHA" --tag "$GITHUB_REF_NAME"',
    'the isolated private runner must also reject tracked or untracked source changes after testing');
  const download = jobs.release.steps.find(step => step.uses?.startsWith('actions/download-artifact@'));
  assert.equal(download.with['artifact-ids'], '${{ needs.application.outputs.artifact-id }}');
  assert.equal(download.with['digest-mismatch'], 'error');
  assert.equal(download.with.path, 'release-artifacts');
  assert.equal(download.with['run-id'], undefined, 'only download from this workflow run');
  assert.equal(download.with['github-token'], undefined);
  assert.equal(download.with['merge-multiple'], true);
  assert.equal(jobs.release.steps[0].env.ARTIFACT_ID, '${{ needs.application.outputs.artifact-id }}');
  assert.ok(commands(jobs.release).some(run => run.includes('sha256sum --check SHA256SUMS')));
  assert.ok(jobs.release.steps.some(step => step.uses?.startsWith('actions/attest-build-provenance@')));
  assert.ok(commands(jobs.release).some(run => run.startsWith('gh release create')));
  assert.doesNotMatch(commands(jobs.release).join('\n'), /npm (?:ci|run build|run verify)/);
});

test('publication rejects missing artifact IDs, changed bundle bytes and mismatched source identity', t => {
  const job = workflow('release').jobs.release;
  for (const id of ['', ' ', '0', '../other-run', '12,34', '12345']) {
    const result = spawnSync('bash', ['-e', '-c', job.steps[0].run], {
      env: { ...process.env, ARTIFACT_ID: id }, encoding: 'utf8',
    });
    assert.equal(result.status === 0, id === '12345');
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'stellarkey-staged-bundle-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const commit = 'a'.repeat(40);
  const version = '1.0.3';
  const inventory = JSON.stringify({ commit, version });
  const payload = 'Synthetic public release fixture';
  const hash = value => createHash('sha256').update(value).digest('hex');
  const archive = `stellarkey-${version}.tar.gz`;
  writeFileSync(path.join(directory, 'release-files.json'), inventory);
  writeFileSync(path.join(directory, archive), payload);
  writeFileSync(path.join(directory, 'SHA256SUMS'), `${hash(inventory)}  release-files.json\n${hash(payload)}  ${archive}\n`);
  const check = job.steps.find(step => step.name === 'Verify staged checksums and source identity');
  assert.equal(check['working-directory'], 'release-artifacts');
  const verify = (sha = commit, tag = `v${version}`) => spawnSync('bash', ['-e', '-c', check.run], {
    cwd: directory, env: { ...process.env, GITHUB_SHA: sha, GITHUB_REF_NAME: tag }, encoding: 'utf8',
  });
  assert.equal(verify().status, 0);
  assert.notEqual(verify('b'.repeat(40)).status, 0);
  assert.notEqual(verify(commit, 'v0.0.0').status, 0);
  writeFileSync(path.join(directory, archive), 'Changed public fixture');
  assert.notEqual(verify().status, 0);
});
