import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("hierarchical screens share one accessible iOS back control", () => {
  const ui = read("src/components/ui.tsx");
  const settings = read("src/components/SettingsPage.tsx");
  const onboarding = read("src/components/Onboarding.tsx");

  assert.match(ui, /export function IOSBackButton\(/);
  assert.match(ui, /aria-label=\{label\}/);
  assert.match(ui, /h-11 w-11/);
  assert.match(ui, /IconChevronDown[^>]*rotate-90/);
  assert.match(settings, /<IOSBackButton[\s\S]*?onClick=/);
  assert.match(onboarding, /<IOSBackButton[\s\S]*?onClick=\{onBack\}/);
  assert.doesNotMatch(settings, />\s*Back\s*<\/button>/);
  assert.doesNotMatch(onboarding, /← \{backLabel\}/);
});
