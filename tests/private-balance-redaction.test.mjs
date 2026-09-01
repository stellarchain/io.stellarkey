import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitiveData } from '../src/features/private-balance/worker/redaction.ts';

test('redaction: strips 32-byte hex keys and Stellar secret keys', () => {
  const secretKey = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const hexKey = '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';

  const rawMessage = `Error failed to sign with ${secretKey} and secret seed ${hexKey}`;
  const redacted = redactSensitiveData(rawMessage);

  assert.equal(redacted.includes(secretKey), false);
  assert.equal(redacted.includes(hexKey), false);
  assert.equal(redacted.includes('[REDACTED]'), true);
});

test('redaction strips long decimal witness values without hiding ordinary error counts', () => {
  const witness = '21888242871839275222246405745257275088548364400416034343698204186575808495617';
  const redacted = redactSensitiveData(`constraint 12 failed for witness ${witness}`);
  assert.equal(redacted, 'constraint 12 failed for witness [REDACTED]');
});
