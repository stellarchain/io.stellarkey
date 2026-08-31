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
