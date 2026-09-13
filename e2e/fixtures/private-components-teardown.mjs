import { readFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export default async function teardown() {
  const expected = process.env.PRIVATE_COMPONENT_FIXTURE_SHA256;
  if (!expected) throw new Error('Run synthetic component checks through scripts/test-private-components.mjs.');
  const page = new URL('../../src/app/private-component-fixture/page.tsx', import.meta.url);
  const source = await readFile(page);
  if (createHash('sha256').update(source).digest('hex') !== expected) {
    throw new Error('Synthetic fixture changed during testing; preserving it for inspection.');
  }
  // Global teardown runs before the owned Next server stops. Removing the
  // fixture here lets Next remove its temporary route from generated types.
  await unlink(page);
  const validator = new URL('../../.next-e2e/dev/types/validator.ts', import.meta.url);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const generated = await readFile(validator, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (!generated.includes('private-component-fixture')) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('The browser-test server did not clear temporary fixture route types.');
}
