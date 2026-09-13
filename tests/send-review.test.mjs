import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  bindPublicPaymentReview,
  requireCurrentPublicPaymentReview,
} from "../src/lib/transaction-intent.ts";

const SOURCE = "GAQ4VYTJMLIDWDP2J3T6QLLWZUGYPXLEZ4BLNFOAX67RPB2NNFQPWJZM";
const DESTINATION = "GDXLPASTWB2UNYOLRMZLOYEPOU5F6ITXUWC3SYJM6UFEP7FJ3PKJZ3QP";

function reviewFixture() {
  return bindPublicPaymentReview({
    sourcePublicKey: SOURCE,
    network: "testnet",
    destination: DESTINATION,
    amount: "12.5000000",
    asset: {
      key: "native",
      code: "XLM",
      issuer: null,
      isNative: true,
      balanceBefore: "100.0000000",
    },
    memo: { type: "text", value: "Invoice 42" },
    feeStroops: 100,
    needsCosigners: false,
  });
}

test("public payment review snapshots are immutable and context-bound", () => {
  const review = reviewFixture();
  assert.ok(Object.isFrozen(review));
  assert.ok(Object.isFrozen(review.asset));
  assert.ok(Object.isFrozen(review.memo));
  assert.equal(
    requireCurrentPublicPaymentReview(review, {
      sourcePublicKey: SOURCE,
      network: "testnet",
    }),
    review,
  );
  assert.throws(
    () => requireCurrentPublicPaymentReview(review, {
      sourcePublicKey: DESTINATION,
      network: "testnet",
    }),
    /account changed/i,
  );
  assert.throws(
    () => requireCurrentPublicPaymentReview(review, {
      sourcePublicKey: SOURCE,
      network: "mainnet",
    }),
    /network changed/i,
  );
});

test("Send signs only the frozen public review snapshot", () => {
  const source = readFileSync(new URL("../src/components/SendModal.tsx", import.meta.url), "utf8");
  assert.match(source, /const \[publicReview, setPublicReview\] = useState<PublicPaymentReview \| null>/);
  assert.match(source, /setPublicReview\(bindPublicPaymentReview\(/);
  assert.match(source, /const reviewed = requireCurrentPublicPaymentReview\(/);
  assert.match(source, /destination: reviewed\.destination/);
  assert.match(source, /amount: reviewed\.amount/);
  assert.match(source, /assetCode: reviewed\.asset\.code/);
  assert.match(source, /issuer: reviewed\.asset\.issuer \?\? undefined/);
  assert.match(source, /memo: reviewed\.memo/);
  assert.match(source, /feeStroops: reviewed\.feeStroops/);
});
