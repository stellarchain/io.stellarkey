import test from "node:test";
import assert from "node:assert/strict";

import { tabIndexAfterKey } from "../src/lib/tabs.ts";

test("horizontal tabs wrap with arrow keys and support Home and End", () => {
  assert.equal(tabIndexAfterKey(0, 3, "ArrowRight"), 1);
  assert.equal(tabIndexAfterKey(2, 3, "ArrowRight"), 0);
  assert.equal(tabIndexAfterKey(0, 3, "ArrowLeft"), 2);
  assert.equal(tabIndexAfterKey(1, 3, "Home"), 0);
  assert.equal(tabIndexAfterKey(1, 3, "End"), 2);
});

test("tabs ignore unrelated keys and reject an empty tab list", () => {
  assert.equal(tabIndexAfterKey(1, 3, "ArrowDown"), null);
  assert.equal(tabIndexAfterKey(1, 3, "Enter"), null);
  assert.equal(tabIndexAfterKey(0, 0, "ArrowRight"), null);
});

test("tabs clamp an out-of-date selected index before moving", () => {
  assert.equal(tabIndexAfterKey(9, 3, "ArrowRight"), 0);
  assert.equal(tabIndexAfterKey(-4, 3, "ArrowLeft"), 2);
});
