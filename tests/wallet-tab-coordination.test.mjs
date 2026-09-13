import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

async function tabDomain() {
  try {
    return await import("../src/lib/tab-coordination.ts");
  } catch (error) {
    assert.fail(`The tab coordination domain is missing: ${error instanceof Error ? error.message : error}`);
  }
}

test("wallet coordination accepts only lock and reset signals from another tab", async () => {
  const { decodeWalletSignal } = await tabDomain();
  assert.deepEqual(
    decodeWalletSignal(JSON.stringify({ type: "wallet-lock", senderId: "tab-a", nonce: "one" })),
    { type: "wallet-lock", senderId: "tab-a", nonce: "one" },
  );
  assert.deepEqual(
    decodeWalletSignal(JSON.stringify({ type: "wallet-reset", senderId: "tab-b", nonce: "two" })),
    { type: "wallet-reset", senderId: "tab-b", nonce: "two" },
  );
  assert.equal(decodeWalletSignal('{"type":"wallet-unlock"}'), null);
  assert.equal(decodeWalletSignal("broken"), null);
});

test("wallet lock and reset are broadcast while unlock remains tab-local", () => {
  const wallet = readFileSync(new URL("../src/hooks/useWallet.tsx", import.meta.url), "utf8");
  assert.match(wallet, /openWalletCoordination/);
  assert.match(wallet, /post\("wallet-lock"\)/);
  assert.match(wallet, /post\("wallet-reset"\)/);
  assert.doesNotMatch(wallet, /post\("wallet-unlock"\)/);
});
