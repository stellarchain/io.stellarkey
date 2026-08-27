import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("swap asset options preserve the full asset code on narrow screens", () => {
  const swap = read("src/components/SwapPage.tsx");
  const ui = read("src/components/ui.tsx");

  assert.match(swap, /<Select[\s\S]*?preserveOptionLabels[\s\S]*?panelMinWidth=\{280\}/);
  assert.match(swap, /label:\s*b\.code/);
  assert.match(ui, /preserveOptionLabels\s*=\s*false/);
  assert.match(ui, /preserveOptionLabels\s*\?\s*"shrink-0 whitespace-nowrap"/);
  assert.match(ui, /preserveOptionLabels\s*\?\s*"truncate"\s*:\s*"whitespace-nowrap"/);
});

test("swap treats both amount fields as responsive editable intent controls", () => {
  const swap = read("src/components/SwapPage.tsx");

  assert.match(swap, /amountLabel="You pay amount"/);
  assert.match(swap, /amountLabel="You receive amount"/);
  assert.match(swap, /aria-label=\{amountLabel\}/);
  assert.match(swap, /findStrictReceiveRoute/);
  assert.match(swap, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(swap, /Minimum received/);
  assert.match(swap, /Maximum paid/);
});

test("swap mobile toolbar explains dual editing and exposes the slippage value", () => {
  const swap = read("src/components/SwapPage.tsx");

  assert.match(swap, /Edit either amount/);
  assert.match(swap, /Slippage \{slippage\}%/);
  assert.match(swap, /justify-between/);
});

test("confirmed swaps become an immutable receipt instead of resetting the form", () => {
  const swap = read("src/components/SwapPage.tsx");

  assert.match(swap, /interface SubmittedSwap/);
  assert.match(swap, /"status" \| "success"/);
  assert.match(swap, /setStage\("success"\)/);
  assert.match(swap, /Swap complete/);
  assert.match(swap, /Transaction hash/);
  assert.match(swap, /View activity/);
  assert.match(swap, /Swap again/);
  assert.match(swap, /onDone/);
  assert.match(swap, /onViewActivity/);
});
