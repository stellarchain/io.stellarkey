import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readSource = relativePath => readFileSync(
  new URL(`../${relativePath}`, import.meta.url),
  'utf8',
);

test('reusable receipts expose one bound sweep through the private runtime', () => {
  const hook = readSource('src/hooks/usePrivateBalanceRuntime.tsx');
  const provider = readSource('src/features/private-balance/runtime/provider.tsx');
  const actionFlow = readSource('src/features/private-balance/runtime/action-flow.ts');

  assert.match(actionFlow, /actionField:\s*prepared\.actionFieldHex/);
  assert.match(hook, /prepareStealthSweep\(/);
  assert.match(hook, /submitStealthSweep\(sweep: PreparedStealthSweep\)/);

  assert.match(
    provider,
    /prepareActionInternal\([\s\S]*current\.destinationPublicKey,[\s\S]*\)/,
    'the reviewed deposit must use the discovered one-time account as its source',
  );
  assert.match(
    provider,
    /beforeSign:[\s\S]*markStealthPaymentSweeping[\s\S]*sweep\.review\.actionField/,
    'the encrypted receipt journal must be durable before any signature exists',
  );
  assert.match(
    provider,
    /const stealthRoot = deriveStealthRootKey\(sessionRoot\);[\s\S]*rootKey:\s*stealthRoot[\s\S]*stealthRoot\.fill\(0\)/,
    'discovery and sweeping must derive and erase a dedicated 32-byte stealth root',
  );
  assert.doesNotMatch(
    provider,
    /rootKey:\s*sessionRoot/,
    'the 64-byte private-balance session root must never cross the stealth boundary',
  );
  assert.match(
    provider,
    /reconcileStealthPaymentSweeps\([\s\S]*durable\.activities[\s\S]*durable\.pendingActions/,
    'canonical private state must reconcile an interrupted receipt sweep',
  );
});
