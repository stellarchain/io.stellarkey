import assert from "node:assert/strict";
import test from "node:test";

import { StrKey } from "@stellar/stellar-sdk";

import {
  MAX_MERCHANT_ROUTING_ID,
  createMerchantRoutingId,
  isMerchantRoutingId,
  merchantPaymentTransport,
  muxedAddressForRouting,
  routingFromMuxedAddress,
} from "../src/lib/merchant/routing.ts";

const TILL = "GAVLAAAWTBEO5XJELA3TID4XVHELGTFYRMMFRU2MQ25C5VVCBI476ZVG";

test("merchant routing IDs are canonical non-zero uint64 decimal strings", () => {
  for (const valid of ["1", "42", MAX_MERCHANT_ROUTING_ID]) {
    assert.equal(isMerchantRoutingId(valid), true, valid);
  }
  for (const invalid of ["", "0", "00", "01", "-1", "+1", "1.0", " 1", "1 ", "18446744073709551616"]) {
    assert.equal(isMerchantRoutingId(invalid), false, invalid);
  }
});

test("generated routing IDs are valid and non-zero", () => {
  for (let index = 0; index < 64; index += 1) {
    assert.equal(isMerchantRoutingId(createMerchantRoutingId()), true);
  }
});

test("a muxed destination round-trips to its base account and routing ID", () => {
  const destination = muxedAddressForRouting(TILL, "42");
  assert.equal(StrKey.isValidMed25519PublicKey(destination), true);
  assert.deepEqual(routingFromMuxedAddress(destination), {
    baseAddress: TILL,
    routingId: "42",
  });
});

test("preferred and compatibility transports carry the same routing identity", () => {
  const preferred = merchantPaymentTransport(TILL, "42", "muxed");
  const compatibility = merchantPaymentTransport(TILL, "42", "memo-id");

  assert.equal(preferred.destination, muxedAddressForRouting(TILL, "42"));
  assert.equal(preferred.memo, undefined);
  assert.equal(preferred.memoType, undefined);

  assert.equal(compatibility.destination, TILL);
  assert.equal(compatibility.memo, "42");
  assert.equal(compatibility.memoType, "id");
});

test("routing helpers reject invalid accounts and IDs", () => {
  assert.throws(() => muxedAddressForRouting("not-an-account", "42"), /receiving account/i);
  assert.throws(() => muxedAddressForRouting(TILL, "0"), /routing ID/i);
  assert.throws(() => routingFromMuxedAddress(TILL), /muxed/i);
});
