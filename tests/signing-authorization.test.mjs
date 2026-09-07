import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SigningAuthorizationCancelledError,
  createSigningAuthorizationGate,
  captureSigningContextAuthorization,
} from "../src/lib/signing-authorization.ts";

test('captured signing context checks live ownership at capture and every continuation', () => {
  let current = true;
  let checks = 0;
  const guard = captureSigningContextAuthorization(() => { checks++; return current; });
  guard();
  assert.equal(checks, 2);
  current = false;
  assert.throws(guard, SigningAuthorizationCancelledError);
  assert.throws(() => captureSigningContextAuthorization(() => false), SigningAuthorizationCancelledError);
});

test("a signing approval is single-use and publishes one stable pending request", async () => {
  const snapshots = [];
  const gate = createSigningAuthorizationGate((request) => snapshots.push(request));

  const approval = gate.request("Send payment");
  assert.deepEqual(gate.pending, { id: 1, label: "Send payment" });
  assert.deepEqual(snapshots, [{ id: 1, label: "Send payment" }]);

  gate.approve(1);
  await approval;
  assert.equal(gate.pending, null);
  assert.equal(snapshots.at(-1), null);
  assert.throws(() => gate.approve(1), /no signing approval/i);
});

test("a signing approval cannot be replaced while it is awaiting a password", async () => {
  const gate = createSigningAuthorizationGate(() => undefined);
  const first = gate.request("Swap assets");

  await assert.rejects(
    () => gate.request("Send payment"),
    /finish the current signing approval/i,
  );
  assert.deepEqual(gate.pending, { id: 1, label: "Swap assets" });

  gate.cancel();
  await assert.rejects(first, SigningAuthorizationCancelledError);
});

test("locking or closing rejects pending authorization and clears its label", async () => {
  const snapshots = [];
  const gate = createSigningAuthorizationGate((request) => snapshots.push(request));
  const approval = gate.request("Private payment");

  gate.cancel("Wallet locked before signing.");
  await assert.rejects(approval, /wallet locked before signing/i);
  assert.equal(gate.pending, null);
  assert.equal(snapshots.at(-1), null);
});

test("hardware signing can request a fresh post-verification user gesture", async () => {
  const gate = createSigningAuthorizationGate(() => undefined);
  const approval = gate.request("Send payment", {
    requiresUserGestureContinuation: true,
  });

  assert.deepEqual(gate.pending, {
    id: 1,
    label: "Send payment",
    requiresUserGestureContinuation: true,
  });
  gate.approve(1);
  await approval;
});

test("a sensitive setting approval is distinguished from transaction signing", async () => {
  const gate = createSigningAuthorizationGate(() => undefined);
  const approval = gate.request("Change merchant receiving account", {
    purpose: "sensitive-setting",
  });

  assert.deepEqual(gate.pending, {
    id: 1,
    label: "Change merchant receiving account",
    purpose: "sensitive-setting",
  });
  gate.approve(1);
  await approval;
});

test("every wallet transaction signer passes through the shared authorization boundary", () => {
  const wallet = readFileSync(new URL("../src/hooks/useWallet.tsx", import.meta.url), "utf8");
  const prompt = readFileSync(
    new URL("../src/components/SigningPasswordPrompt.tsx", import.meta.url),
    "utf8",
  );

  assert.equal((wallet.match(/withSigningSecret\(/g) ?? []).length, 1);
  assert.ok((wallet.match(/withAuthorizedSigningSecret\(/g) ?? []).length >= 12);
  assert.match(
    wallet,
    /requestSigningAuthorization\("Sign private balance transaction"\)[\s\S]{0,300}signExactPrivateBalanceEnvelope/,
  );
  assert.match(wallet, /cancelSigningAuthorization\("Wallet locked before signing\."\)/);
  assert.match(prompt, /setPassword\(""\)/);
  assert.match(prompt, /autoComplete="current-password"/);
  assert.match(prompt, />\s*Continue on Trezor\s*</);
  assert.match(wallet, /requestSigningAuthorization\(label, Boolean\(hardwareSigner\)\)/);
  assert.match(
    wallet,
    /requestSigningAuthorization[\s\S]{0,500}isSigningPasswordRequired\(\)/,
    "authorization must re-read the persisted cross-tab policy",
  );
  assert.match(wallet, /authorizeTransactionSigning/);

  const privateProvider = readFileSync(
    new URL("../src/features/private-balance/runtime/provider.tsx", import.meta.url),
    "utf8",
  );
  const sweep = privateProvider.split("const submitStealthSweep = useCallback")[1]
    ?.split("const prepareChainedSend")[0] ?? "";
  assert.match(sweep, /authorizeTransactionSigning\("Move reusable private receipt"\)/);
});
