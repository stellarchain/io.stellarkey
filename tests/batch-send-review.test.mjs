import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/BatchSendModalBody.tsx", import.meta.url),
  "utf8",
);

test("multi-send requires an explicit review stage before signing", () => {
  assert.match(source, /type BatchStage = "form" \| "review"/);
  assert.match(source, /function handleReview\(\)/);
  assert.match(source, /setStage\("review"\)/);
  assert.match(source, /stage === "review"/);
  assert.match(source, /Review .*Recipient/);
  assert.match(source, /Confirm and Send/);
});

test("the reviewed payment snapshot is used at the signing boundary", () => {
  assert.match(source, /interface BatchReview/);
  assert.match(source, /if \(!review\) return/);
  assert.match(source, /payments: review\.payments/);
  assert.match(source, /memo: review\.memo/);
});
