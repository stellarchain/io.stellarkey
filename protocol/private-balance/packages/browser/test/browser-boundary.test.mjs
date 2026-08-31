import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sourceDirectory = join(import.meta.dirname, '../src');
const packageJson = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8'));

test('browser package has no Node-only runtime dependencies', () => {
  for (const name of readdirSync(sourceDirectory).filter((entry) => entry.endsWith('.ts'))) {
    const source = readFileSync(join(sourceDirectory, name), 'utf8');
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()['"]node:/, `${name} imports a Node builtin`);
    assert.doesNotMatch(source, /\bBuffer\b/, `${name} relies on Node Buffer`);
    assert.doesNotMatch(source, /\bprocess\b/, `${name} relies on Node process`);
    assert.doesNotMatch(source, /\bfetch\s*\(/, `${name} performs a network fetch`);
    assert.doesNotMatch(source, /\bXMLHttpRequest\b/, `${name} uses XMLHttpRequest`);
    assert.doesNotMatch(source, /\bWebSocket\b/, `${name} opens a WebSocket`);
    assert.doesNotMatch(source, /\bEventSource\b/, `${name} opens an EventSource`);
  }
});

test('browser cryptography and proving dependencies remain exact reviewed versions', () => {
  assert.deepEqual(packageJson.dependencies, {
    '@hpke/core': '1.9.0',
    '@hpke/dhkem-x25519': '1.8.0',
    '@noble/curves': '2.3.0',
    '@noble/hashes': '2.4.0',
    snarkjs: '0.7.6',
  });
});
