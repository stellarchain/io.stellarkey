import { copyFile, mkdir, readFile, unlink, rmdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { assertNoPrivateComponentFixture } from './testing/wallet-test-policy.mjs';

// Never overwrite a real route. Only an exclusively created, fixed fixture
// directory is removed on exit; all fixture values are synthetic.
const route = new URL('../src/app/private-component-fixture/', import.meta.url);
const page = new URL('page.tsx', route);
assertNoPrivateComponentFixture();
await mkdir(route);
let copied = false;
let fingerprint;
try {
  await copyFile(new URL('../e2e/fixtures/private-components.tsx', import.meta.url), page, constants.COPYFILE_EXCL);
  copied = true;
  fingerprint = createHash('sha256').update(await readFile(page)).digest('hex');
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.private-components.config.ts', ...process.argv.slice(2)], {
      stdio: 'inherit', env: { ...process.env, E2E_NEXT_DEV: '1', PRIVATE_COMPONENT_FIXTURE_SHA256: fingerprint },
    });
    const stop = () => child.kill('SIGTERM');
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    child.once('error', reject);
    child.once('exit', code => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      resolve(code ?? 1);
    });
  });
  process.exitCode = code;
} finally {
  if (copied) {
    const remaining = await readFile(page).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (remaining) {
      if (createHash('sha256').update(remaining).digest('hex') !== fingerprint) throw new Error('Fixture changed; preserving it.');
      await unlink(page);
    }
  }
  await rmdir(route);
  assertNoPrivateComponentFixture();
}
