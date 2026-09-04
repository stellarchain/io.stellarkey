import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const text = (path) => read(path).toString("utf8");
const sha256 = (path) => createHash("sha256").update(read(path)).digest("hex");

test("private-payment documentation describes the live Testnet development deployment", () => {
  const model = text("docs/private-balance.md");
  assert.match(model, /Live Testnet development deployment/is);
  assert.match(
    model,
    /catalogue advertises one live XLM\/USDC development pool on Testnet/is,
  );
  assert.match(model, /single-party setup/i);
  assert.match(model, /passes.*pinned Powers-of-Tau transcript/is);
  assert.match(model, /does not make.*safe for real value/is);
  assert.match(model, /deliberately Testnet-only/is);
  assert.match(model, /Mainnet.*reject/is);
});

test("HPKE operations clear locally owned secret and plaintext buffers", () => {
  const encryption = text("protocol/private-balance/packages/browser/src/encryption.ts");
  assert.match(encryption, /ephemeralPrivateKey\?\.fill\(0\)/);
  assert.match(encryption, /sharedSecret\?\.fill\(0\)/);
  assert.match(encryption, /plaintextBytes\?\.fill\(0\)/);
  assert.match(encryption, /diversified\?\.hpkePrivateKey\.fill\(0\)/);
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
