import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const text = (path) => read(path).toString("utf8");
const sha256 = (path) => createHash("sha256").update(read(path)).digest("hex");

test("private-payment documentation describes the quarantined development prototype", () => {
  const model = text("docs/private-balance.md");
  assert.match(model, /development-only testnet prototype/i);
  assert.match(model, /single-party setup/i);
  assert.match(model, /fails.*pinned Powers-of-Tau transcript/is);
  assert.match(model, /quarantined/i);
  assert.match(model, /Mainnet rejects/i);
  assert.doesNotMatch(model, /deployed testnet preview/i);
});

test("ceremony provenance matches the shipped proving artifacts", () => {
  const ceremony = text("protocol/private-balance/ceremony/README.md");
  const manifest = JSON.parse(text("public/protocol/private-balance/v1/manifest.json"));
  const zkeyHash = sha256("public/protocol/private-balance/v1/circuit.zkey");
  const verifyingKeyHash = sha256("public/protocol/private-balance/v1/verification-key.json");

  assert.equal(zkeyHash, manifest.artifacts.zkeySha256);
  assert.equal(verifyingKeyHash, manifest.artifacts.vkJsonSha256);
  assert.match(ceremony, new RegExp(zkeyHash));
  assert.match(ceremony, new RegExp(verifyingKeyHash));
});
