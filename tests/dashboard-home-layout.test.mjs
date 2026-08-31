import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("funded dashboard cards share a responsive desktop row without fixed heights", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const css = read("src/app/globals.css");

  assert.match(dashboard, /className="dashboard-home-grid[^"]*"/);
  assert.equal(
    dashboard.match(/dashboard-home-column/g)?.length,
    2,
    "both dashboard columns must participate in the shared row contract",
  );
  assert.match(dashboard, /className="dashboard-home-primary[^"]*"/);
  assert.match(dashboard, /className="panel dashboard-home-balance-card[^"]*"/);

  assert.match(css, /@supports \(grid-template-rows: subgrid\)/);
  assert.match(
    css,
    /\.dashboard-home-column\s*\{[\s\S]*?grid-row:\s*span 2;[\s\S]*?grid-template-rows:\s*subgrid;/,
  );
  assert.doesNotMatch(
    css,
    /\.dashboard-home-(?:grid|column|primary|balance-card)[^{]*\{[^}]*\b(?:height|min-height|max-height):\s*\d+(?:px|rem)/,
    "dashboard alignment must not depend on a fixed card height",
  );
});
