import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("wallet account marks are stable, distinct, and use every cell", async () => {
  const modulePath = path.join(root, "src/lib/account-mark.ts");
  assert.equal(existsSync(modulePath), true, "the account mark module must exist");

  const { createAccountMark } = await import("../src/lib/account-mark.ts");
  const firstKey = `G${"A".repeat(55)}`;
  const secondKey = `G${"B".repeat(55)}`;
  const first = createAccountMark(firstKey);

  assert.equal(first.length, 25);
  assert.deepEqual(createAccountMark(firstKey), first);
  assert.notDeepEqual(createAccountMark(secondKey), first);
  assert.ok(first.some(Boolean), "an account mark must always contain a visible cell");

  // Not mirrored: all 25 cells are drawn independently. Mirroring would make
  // every row symmetric for every key, which halves the pattern to 15 bits and
  // gives every account the same axis — unreadable at the 24px it renders at.
  const asymmetric = Array.from({ length: 24 }, (_, index) =>
    createAccountMark(`G${String(index).padStart(55, "C")}`),
  ).some((cells) =>
    [0, 1, 2, 3, 4].some((row) =>
      cells[row * 5] !== cells[row * 5 + 4] || cells[row * 5 + 1] !== cells[row * 5 + 3],
    ),
  );
  assert.ok(asymmetric, "account marks must not be constrained to a mirrored axis");

  const fallback = createAccountMark("");
  assert.equal(fallback.length, 25);
  assert.ok(fallback.some(Boolean), "an empty seed must retain a safe visible fallback");
});

test("account mark tints are stable per account and span the wheel", async () => {
  const { createAccountMarkTint } = await import(
    "../src/lib/account-mark.ts"
  );
  const firstKey = `G${"A".repeat(55)}`;
  const secondKey = `G${"B".repeat(55)}`;
  const first = createAccountMarkTint(firstKey);

  assert.deepEqual(createAccountMarkTint(firstKey), first);
  assert.notDeepEqual(createAccountMarkTint(secondKey), first);
  assert.ok(Number.isInteger(first.hue));
  assert.ok(first.hue >= 0 && first.hue < 360);
  assert.equal("cells" in first, false, "all visible cells must share one account tint");

  // A continuous hue, not an index into a handful of near-identical pastels:
  // colour is what separates two accounts once the pattern softens.
  const hues = new Set(
    Array.from({ length: 40 }, (_, index) =>
      createAccountMarkTint(`G${String(index).padStart(55, "D")}`).hue),
  );
  assert.ok(hues.size > 20, `expected a wide spread of tints, saw ${hues.size}`);
});

test("wallet account surfaces use a quiet account-only mark", () => {
  const componentPath = path.join(root, "src/components/AccountMark.tsx");
  assert.equal(existsSync(componentPath), true, "the account mark component must exist");

  const component = read("src/components/AccountMark.tsx");
  const dashboard = read("src/components/Dashboard.tsx");
  const settings = read("src/components/SettingsPage.tsx");
  const sharedUi = read("src/components/ui.tsx");

  assert.match(component, /createAccountMark\(publicKey\)/);
  assert.match(component, /aria-hidden="true"/);
  assert.match(component, /rounded-\[32%\]/);
  assert.match(component, /createAccountMarkTint\(publicKey\)/);
  // Ground, edge and cells are all struck from the one account hue.
  assert.equal(component.match(/hsl\(\$\{hue\}/g)?.length, 3);
  assert.doesNotMatch(component, /"#[0-9A-F]{6}"/, "no fixed palette: the tint comes from the key");
  assert.match(component, /className="aspect-square rounded-\[20%\] bg-current"/);
  // Unset cells stay faintly visible so the grid still reads when small.
  assert.match(component, /opacity: filled \? 1 : 0\.09/);
  assert.doesNotMatch(component, /edge:|glow:|accent\.cells|accentClass/);
  assert.doesNotMatch(component, /p-\[\d+%\]/);
  assert.match(component, /padding:\s*Math\.max\(2, Math\.round\(size \* 0\.14\)\)/);
  assert.doesNotMatch(component, /linear-gradient|seed\.slice/);

  assert.match(dashboard, /import \{ AccountMark \} from "\.\/AccountMark";/);
  assert.match(settings, /import \{ AccountMark \} from "\.\/AccountMark";/);
  assert.equal(dashboard.match(/<AccountMark publicKey=\{/g)?.length, 5);
  assert.equal(settings.match(/<AccountMark publicKey=\{/g)?.length, 4);
  assert.doesNotMatch(dashboard, /<Avatar seed=\{(?:activeAccount|acct)\.publicKey\}/);
  assert.doesNotMatch(settings, /<Avatar seed=\{(?:activeAccount|acct|a)\.publicKey\}/);

  assert.match(sharedUi, /export function Avatar\(/);
});
