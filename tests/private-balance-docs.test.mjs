import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = name => readFileSync(new URL(`../docs/${name}`, import.meta.url), 'utf8');

test('private balance documentation states exact privacy, recovery, and support boundaries', () => {
  const product = read('private-balance.md');
  const recovery = read('private-balance-recovery.md');
  const incident = read('private-balance-incident-response.md');
  const support = read('private-balance-support.md');
  const combined = `${product}\n${recovery}\n${incident}\n${support}`;

  assert.match(product, /development-only|not deployed/i);
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
