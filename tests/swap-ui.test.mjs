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
