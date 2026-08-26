import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
const merchantComponents = new URL("../src/components/merchant/", import.meta.url);

function productionFiles() {
  const components = readdirSync(merchantComponents, { withFileTypes: true })
    .filter((entry) => entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name)))
    .map((entry) => join(merchantComponents.pathname, entry.name));
  return [
    ...components,
    new URL("../src/hooks/useMerchant.tsx", import.meta.url).pathname,
  ];
}

test("the production merchant surface has no fixture module or runtime fixture imports", () => {
  assert.equal(
    existsSync(new URL("../src/lib/merchant/mock.ts", import.meta.url)),
    false,
    "delete the obsolete fixture module instead of letting it drift back into production",
  );
  for (const path of productionFiles()) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /merchant\/mock|\bMOCK_[A-Z0-9_]+\b|DESIGN MOCK|FIXTURES FOR THE DESIGN MOCKS/);
  }
});

test("merchant actions contain no known simulated-success language", () => {
  const simulatedSuccess = /(?:Would|would) (?:add|attach|email|export|flip|mark|open|pair|poll|print|reconcile|save|send|sign|sweep)|Nothing (?:saved|signed)|any four digits/i;
  for (const path of productionFiles()) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, simulatedSuccess);
  }
});

test("the guard covers every production merchant component", () => {
  const names = productionFiles().map((path) => path.slice(root.pathname.length));
  assert.ok(names.length >= 30);
  assert.ok(names.includes("src/components/merchant/PosTerminal.tsx"));
  assert.ok(names.includes("src/components/merchant/MerchantSettings.tsx"));
  assert.ok(names.includes("src/hooks/useMerchant.tsx"));
});
