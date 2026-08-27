import assert from "node:assert/strict";
import test from "node:test";

import {
  entropyToMnemonic,
  generateMnemonic,
  keypairFromMnemonicIndex,
  mnemonicToSeed,
  slip10Ed25519Derive,
  validateMnemonic,
} from "../src/lib/hd.ts";

function bytes(hex) {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function hex(value) {
  return Buffer.from(value).toString("hex");
}

// Canonical Trezor/python-mnemonic vectors. Seed vectors use passphrase TREZOR.
// https://github.com/trezor/python-mnemonic/blob/master/vectors.json
const BIP39_VECTORS = [
  {
    entropy: "00000000000000000000000000000000",
    mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    seed: "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04",
  },
  {
    entropy: "0000000000000000000000000000000000000000000000000000000000000000",
    mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
    seed: "bda85446c68413707090a52022edd26a1c9462295029f2e60cd7c4f2bbd3097170af7a4d73245cafa9c3cca8d561a7c3de6f5d4a10be8ed2a5e608d68f92fcc8",
  },
];

test("BIP-39 entropy, checksum, and PBKDF2 output match published vectors", async () => {
  for (const vector of BIP39_VECTORS) {
    assert.equal(await entropyToMnemonic(bytes(vector.entropy)), vector.mnemonic);
    assert.equal(await validateMnemonic(vector.mnemonic), true);
    assert.equal(hex(await mnemonicToSeed(vector.mnemonic, "TREZOR")), vector.seed);
  }
});

test("every standard BIP-39 word count can be generated and restored", async () => {
  for (const words of [12, 15, 18, 21, 24]) {
    const mnemonic = await generateMnemonic(words);
    assert.equal(mnemonic.split(" ").length, words);
    assert.equal(await validateMnemonic(mnemonic), true);
  }
  await assert.rejects(() => generateMnemonic(13), /word count/i);
});

// Final SLIP-0010 ed25519 vectors, independent of Stellar encoding.
// https://github.com/satoshilabs/slips/blob/master/slip-0010.md
test("SLIP-0010 ed25519 hardened derivation matches the published private keys", async () => {
  const seed = bytes("000102030405060708090a0b0c0d0e0f");
  assert.equal(
    hex(await slip10Ed25519Derive(seed, "m")),
    "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7",
  );
  assert.equal(
    hex(await slip10Ed25519Derive(seed, "m/0'")),
    "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3",
  );
  assert.equal(
    hex(await slip10Ed25519Derive(seed, "m/0'/1'/2'/2'/1000000000'")),
    "8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793",
  );
  await assert.rejects(
    () => slip10Ed25519Derive(seed, "m/0'/1"),
    /only supports hardened/i,
  );
});

// Final Stellar SEP-0005 vectors exercise BIP-39 + SLIP-0010 + StrKey together.
// https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0005.md
test("SEP-0005 mnemonic indices recover the canonical Stellar accounts", async () => {
  const mnemonic = "illness spike retreat truth genius clock brain pass fit cave bargain toe";
  assert.equal(
    hex(await mnemonicToSeed(mnemonic)),
    "e4a5a632e70943ae7f07659df1332160937fad82587216a4c64315a0fb39497ee4a01f76ddab4cba68147977f3a147b6ad584c41808e8238a07f6cc4b582f186",
  );
  const expected = [
    [0, "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6", "SBGWSG6BTNCKCOB3DIFBGCVMUPQFYPA2G4O34RMTB343OYPXU5DJDVMN"],
    [1, "GBAW5XGWORWVFE2XTJYDTLDHXTY2Q2MO73HYCGB3XMFMQ562Q2W2GJQX", "SCEPFFWGAG5P2VX5DHIYK3XEMZYLTYWIPWYEKXFHSK25RVMIUNJ7CTIS"],
    [9, "GBTVYYDIYWGUQUTKX6ZMLGSZGMTESJYJKJWAATGZGITA25ZB6T5REF44", "SCJGVMJ66WAUHQHNLMWDFGY2E72QKSI3XGSBYV6BANDFUFE7VY4XNXXR"],
  ];
  for (const [index, publicKey, secret] of expected) {
    const keypair = await keypairFromMnemonicIndex(mnemonic, index);
    assert.equal(keypair.publicKey(), publicKey);
    assert.equal(keypair.secret(), secret);
  }
});

test("SEP-0005's standard 15-word mnemonic is accepted for wallet recovery", async () => {
  const mnemonic = "resource asthma orphan phone ice canvas fire useful arch jewel impose vague theory cushion top";
  assert.equal(await validateMnemonic(mnemonic), true);
  assert.equal(
    (await keypairFromMnemonicIndex(mnemonic, 0)).publicKey(),
    "GAVXVW5MCK7Q66RIBWZZKZEDQTRXWCZUP4DIIFXCCENGW2P6W4OA34RH",
  );
});
