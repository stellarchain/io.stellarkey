import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchAccountSnapshot,
  fetchCurrentBaseReserve,
} from "../src/lib/api.ts";

test("one Horizon account response supplies balances and reserve inputs", async (t) => {
  const requested = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requested.push(String(url));
    return new Response(JSON.stringify({
      balances: [{ asset_type: "native", balance: "12.5", selling_liabilities: "0.5" }],
      subentry_count: 3,
      num_sponsoring: 2,
      num_sponsored: 1,
    }), { status: 200 });
  });

  const snapshot = await fetchAccountSnapshot(
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    "mainnet",
  );

  assert.equal(requested.length, 1);
  assert.match(requested[0], /\/accounts\/GAAA/);
  assert.equal(snapshot.balances[0].balance, "12.5");
  assert.deepEqual(snapshot.reserveInputs, {
    subentryCount: 3,
    numSponsoring: 2,
    numSponsored: 1,
  });
});

test("base reserve requests are coalesced and cached per network", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    return new Response(JSON.stringify({
      // Public Horizon currently serializes this field as a JSON number.
      _embedded: { records: [{ base_reserve_in_stroops: 5000000 }] },
    }), { status: 200 });
  });

  const [first, second] = await Promise.all([
    fetchCurrentBaseReserve("testnet"),
    fetchCurrentBaseReserve("testnet"),
  ]);
  const cached = await fetchCurrentBaseReserve("testnet");

  assert.equal(first, "5000000");
  assert.equal(second, first);
  assert.equal(cached, first);
  assert.equal(requests, 1);
});
