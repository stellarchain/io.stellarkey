import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getAccountHistoryHorizonUrl,
  getHorizonUrl,
  getRpcUrl,
  loadCustomEndpoint,
  normalizeStellarEndpointUrl,
  resetCustomEndpoints,
  saveCustomEndpoint,
  testHorizonEndpoint,
  testRpcEndpoint,
} from "../src/lib/stellar-endpoints.ts";

class MemoryStorage {
  #items = new Map();
  getItem(key) { return this.#items.get(key) ?? null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
  removeItem(key) { this.#items.delete(key); }
}

test("custom Stellar endpoints are HTTPS-only, credential-free, and normalized", () => {
  assert.equal(normalizeStellarEndpointUrl(" https://node.example/rpc/ "), "https://node.example/rpc");
  assert.throws(() => normalizeStellarEndpointUrl("http://node.example"), /HTTPS/i);
  assert.throws(() => normalizeStellarEndpointUrl("https://user:secret@node.example"), /credentials/i);
  assert.throws(() => normalizeStellarEndpointUrl("https://node.example/#fragment"), /fragment/i);
  assert.throws(() => normalizeStellarEndpointUrl("javascript:alert(1)"), /HTTPS/i);
});

test("endpoint preferences are isolated by network and service with safe fallback", () => {
  const storage = new MemoryStorage();
  saveCustomEndpoint("testnet", "horizon", "https://horizon.user.example/", storage);
  saveCustomEndpoint("testnet", "rpc", "https://rpc.user.example/rpc", storage);

  assert.equal(loadCustomEndpoint("testnet", "horizon", storage), "https://horizon.user.example");
  assert.equal(getHorizonUrl("testnet", storage), "https://horizon.user.example");
  assert.equal(getRpcUrl("testnet", storage), "https://rpc.user.example/rpc");
  assert.notEqual(getHorizonUrl("mainnet", storage), "https://horizon.user.example");

  storage.setItem("wallet.endpoint.horizon.mainnet.v1", "http://unsafe.example");
  assert.equal(loadCustomEndpoint("mainnet", "horizon", storage), null);
  assert.match(getHorizonUrl("mainnet", storage), /^https:/);

  resetCustomEndpoints("testnet", storage);
  assert.equal(loadCustomEndpoint("testnet", "horizon", storage), null);
  assert.equal(loadCustomEndpoint("testnet", "rpc", storage), null);
});

test("account history stays on the public Stellar Horizon", () => {
  const storage = new MemoryStorage();
  saveCustomEndpoint("mainnet", "horizon", "https://horizon.user.example", storage);
  saveCustomEndpoint("testnet", "horizon", "https://horizon-test.user.example", storage);

  assert.equal(getAccountHistoryHorizonUrl("mainnet"), "https://horizon.stellar.org");
  assert.equal(getAccountHistoryHorizonUrl("testnet"), "https://horizon-testnet.stellar.org");
  assert.equal(getHorizonUrl("mainnet", storage), "https://horizon.user.example");
});

test("POC Horizon preference keys are ignored and left untouched", () => {
  const storage = new MemoryStorage();
  storage.setItem("wallet.horizon.mainnet.v1", "https://poc.example");

  assert.equal(loadCustomEndpoint("mainnet", "horizon", storage), null);
  saveCustomEndpoint("mainnet", "horizon", "https://current.example", storage);
  assert.equal(storage.getItem("wallet.horizon.mainnet.v1"), "https://poc.example");
  resetCustomEndpoints("mainnet", storage);
  assert.equal(storage.getItem("wallet.horizon.mainnet.v1"), "https://poc.example");
});

test("a failed endpoint preference write restores the previous verified URL", () => {
  const storage = new MemoryStorage();
  saveCustomEndpoint("testnet", "horizon", "https://previous.example", storage);
  const originalSet = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (String(value).includes("replacement")) return;
    originalSet(key, value);
  };

  assert.throws(
    () => saveCustomEndpoint("testnet", "horizon", "https://replacement.example", storage),
    /retain.*endpoint/i,
  );
  assert.equal(loadCustomEndpoint("testnet", "horizon", storage), "https://previous.example");
});

test("resetting both endpoint preferences is failure-atomic", () => {
  const storage = new MemoryStorage();
  saveCustomEndpoint("testnet", "horizon", "https://horizon.previous.example", storage);
  saveCustomEndpoint("testnet", "rpc", "https://rpc.previous.example", storage);
  const originalRemove = storage.removeItem.bind(storage);
  let failed = false;
  storage.removeItem = (key) => {
    if (key === "wallet.endpoint.rpc.testnet.v1" && !failed) {
      failed = true;
      throw new Error("quota database failure");
    }
    originalRemove(key);
  };

  assert.throws(() => resetCustomEndpoints("testnet", storage), /quota|reset/i);
  assert.equal(getHorizonUrl("testnet", storage), "https://horizon.previous.example");
  assert.equal(getRpcUrl("testnet", storage), "https://rpc.previous.example");
});

test("Horizon endpoint health proves the selected network identity", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    network_passphrase: "Test SDF Network ; September 2015",
    history_latest_ledger: 12345,
  }), { status: 200 }));

  const result = await testHorizonEndpoint("testnet", "https://horizon.example", {
    now: (() => { let value = 100; return () => (value += 7); })(),
  });
  assert.deepEqual(result, {
    ok: true,
    kind: "horizon",
    url: "https://horizon.example",
    network: "testnet",
    latencyMs: 7,
    latestLedger: 12345,
  });

  await assert.rejects(
    () => testHorizonEndpoint("mainnet", "https://horizon.example"),
    /serves Testnet.*selected Mainnet/i,
  );
});

test("RPC endpoint health uses getNetwork and rejects a wrong passphrase", async (t) => {
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: bodies.at(-1).id,
      result: {
        passphrase: "Public Global Stellar Network ; September 2015",
        protocolVersion: 25,
      },
    }), { status: 200 });
  });

  const result = await testRpcEndpoint("mainnet", "https://rpc.example", {
    now: (() => { let value = 10; return () => (value += 4); })(),
  });
  assert.equal(bodies[0].method, "getNetwork");
  assert.equal(result.ok, true);
  assert.equal(result.protocolVersion, 25);

  await assert.rejects(
    () => testRpcEndpoint("testnet", "https://rpc.example"),
    /serves Mainnet.*selected Testnet/i,
  );
});

test("network settings expose test, save, and reset controls without bundled keys", () => {
  const settings = readFileSync(new URL("../src/components/SettingsPage.tsx", import.meta.url), "utf8");
  assert.match(settings, /Test & Save Horizon/);
  assert.match(settings, /Test & Save RPC/);
  assert.match(settings, /Reset to Defaults/);
  assert.doesNotMatch(settings, /api[_-]?key|authorization:\s*["']/i);
});
