import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";

class MemoryStorage {
  #items = new Map();

  getItem(key) {
    return this.#items.get(key) ?? null;
  }

  setItem(key, value) {
    this.#items.set(key, String(value));
  }
}

const balanceId = (byte) => `00000000${byte.repeat(64)}`;

test("dismissed claimable balances persist per account and network", async () => {
  const {
    dismissClaimableBalance,
    loadDismissedClaimableBalanceIds,
  } = await import("../src/lib/claimable-balance-dismissals.ts");
  const storage = new MemoryStorage();
  const alice = Keypair.random().publicKey();
  const bob = Keypair.random().publicKey();
  const first = balanceId("1");
  const second = balanceId("2");

  dismissClaimableBalance(storage, "mainnet", alice, first);
  dismissClaimableBalance(storage, "mainnet", alice, second);
  dismissClaimableBalance(storage, "mainnet", alice, first);

  assert.deepEqual(loadDismissedClaimableBalanceIds(storage, "mainnet", alice), [first, second]);
  assert.deepEqual(loadDismissedClaimableBalanceIds(storage, "testnet", alice), []);
  assert.deepEqual(loadDismissedClaimableBalanceIds(storage, "mainnet", bob), []);
});

test("dismissed claimable balances can be restored without affecting other entries", async () => {
  const {
    dismissClaimableBalance,
    loadDismissedClaimableBalanceIds,
    restoreClaimableBalance,
  } = await import("../src/lib/claimable-balance-dismissals.ts");
  const storage = new MemoryStorage();
  const account = Keypair.random().publicKey();
  const first = balanceId("a");
  const second = balanceId("b");

  dismissClaimableBalance(storage, "testnet", account, first);
  dismissClaimableBalance(storage, "testnet", account, second);
  restoreClaimableBalance(storage, "testnet", account, first);

  assert.deepEqual(loadDismissedClaimableBalanceIds(storage, "testnet", account), [second]);
});

test("malformed local dismissal data fails closed and invalid balance IDs are rejected", async () => {
  const {
    CLAIMABLE_BALANCE_DISMISSALS_KEY,
    dismissClaimableBalance,
    loadDismissedClaimableBalanceIds,
  } = await import("../src/lib/claimable-balance-dismissals.ts");
  const storage = new MemoryStorage();
  const account = Keypair.random().publicKey();

  storage.setItem(CLAIMABLE_BALANCE_DISMISSALS_KEY, "{broken");
  assert.deepEqual(loadDismissedClaimableBalanceIds(storage, "mainnet", account), []);
  assert.throws(
    () => dismissClaimableBalance(storage, "mainnet", account, "not-a-balance-id"),
    /invalid claimable balance/i,
  );
});
