import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const publicDocs = [
  'dependency-security.md',
  'merchant-mode.md',
  'private-balance-incident-response.md',
  'private-balance-protocol-review-2026-09-02.md',
  'private-balance-recovery.md',
  'private-balance-support.md',
  'private-balance.md',
  'production-deployment.md',
  'release-checklist.md',
  'testing.md',
  'ux-standards.md',
];

test('release documentation excludes internal plans and execution evidence', () => {
  assert.deepEqual(readdirSync(new URL('docs/', root)).filter(name => /\.(?:md|json)$/.test(name)).sort(), publicDocs);
  const plans = new URL('plans/', root);
  assert.equal(existsSync(plans) ? readdirSync(plans).length : 0, 0);
});

test('retained public documentation has no broken relative file links', () => {
  for (const file of ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'docs/whitepaper/README.md', ...publicDocs.map(name => `docs/${name}`)]) {
    for (const [, target] of read(file).matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) continue;
      const local = target.split(/[?#]/)[0];
      if (!local) continue;
      const location = resolve(dirname(new URL(file, root).pathname), decodeURIComponent(local));
      assert.equal(existsSync(location), true, `${file}: ${target}`);
    }
  }
});
