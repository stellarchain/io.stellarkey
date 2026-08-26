import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyStore } from "../src/lib/merchant/defaults.ts";

async function cryptoDomain() {
  try {
    return await import("../src/lib/merchant/crypto.ts");
  } catch (error) {
    assert.fail(`The merchant crypto domain is missing: ${error instanceof Error ? error.message : error}`);
  }
}

test("merchant records are authenticated and absent from stored plaintext", async () => {
  const { decryptMerchantStore, encryptMerchantStore } = await cryptoDomain();
  const key = new Uint8Array(32).fill(7);
  const store = {
    ...emptyStore(),
    settings: {
      ...emptyStore().settings,
      profile: { ...emptyStore().settings.profile, name: "Private Coffee Ltd" },
    },
    customers: [
      {
        address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        name: "Alice Private",
        firstSeenAt: 1,
        lastSeenAt: 2,
        orderCount: 1,
        lifetimeMinor: 100,
        averageMinor: 100,
        preferredAsset: { code: "XLM", issuer: null },
        sourceIds: ["payment-secret"],
        loyalty: null,
        note: "Allergic to nuts",
      },
    ],
  };

  const envelope = encryptMerchantStore(store, key, () => new Uint8Array(24).fill(3));
  const raw = JSON.stringify(envelope);
  assert.doesNotMatch(raw, /Private Coffee|Alice Private|Allergic|payment-secret/);
  assert.deepEqual(decryptMerchantStore(envelope, key), store);

  envelope.crypto.ciphertext = `${envelope.crypto.ciphertext.slice(0, -2)}AA`;
  assert.throws(() => decryptMerchantStore(envelope, key), /decrypt|authentic/i);
});

test("tax records exposes the standalone encrypted operational archive", () => {
  const storage = readFileSync(new URL("../src/lib/merchant/storage.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/components/merchant/TaxRecordsPage.tsx", import.meta.url), "utf8");
  assert.match(storage, /exportEncryptedMerchantArchive/);
  assert.match(page, /Encrypted archive/);
  assert.match(page, /exportEncryptedMerchantArchive/);
});
