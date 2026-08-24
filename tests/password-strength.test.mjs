import assert from "node:assert/strict";
import test from "node:test";

import { estimatePasswordStrength } from "../src/lib/password-strength.ts";

test("empty passwords are not rated", () => {
  assert.deepEqual(estimatePasswordStrength(""), {
    score: 0,
    label: "Not rated",
    color: "#636366",
    feedback: "Use 12+ characters or four unrelated words.",
  });
});

test("short and common passwords stay weak", () => {
  assert.equal(estimatePasswordStrength("short").score, 1);
  assert.match(estimatePasswordStrength("short").feedback, /at least 8/i);
  assert.equal(estimatePasswordStrength("password123").score, 1);
  assert.match(estimatePasswordStrength("password123").feedback, /common/i);
});

test("repeated and sequential passwords stay weak despite their length", () => {
  assert.equal(estimatePasswordStrength("aaaaaaaaaaaaaaaa").score, 1);
  assert.equal(estimatePasswordStrength("abcd1234abcd1234").score, 1);
  assert.match(estimatePasswordStrength("abcd1234abcd1234").feedback, /predictable/i);
});

test("the scorer distinguishes fair, good, and strong vault passwords", () => {
  assert.equal(estimatePasswordStrength("Aurora!27").score, 2);
  assert.equal(estimatePasswordStrength("Aurora!River27").score, 3);
  assert.equal(estimatePasswordStrength("T6!vQ9#pL2@zM7").score, 4);
  assert.equal(estimatePasswordStrength("lantern river cobalt orchard").score, 4);
});

test("one incidental sequence does not erase the strength of a long password", () => {
  assert.equal(estimatePasswordStrength("T6!abcdQ9#pL2@zM7").score, 4);
});
