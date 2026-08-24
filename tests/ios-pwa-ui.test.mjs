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

test("all scrollbar chrome is hidden without disabling scrolling", () => {
  const css = read("src/app/globals.css");
  const dashboard = read("src/components/Dashboard.tsx");

  assert.match(css, /\*\s*\{[\s\S]*?scrollbar-width:\s*none;/);
  assert.match(css, /\*::-webkit-scrollbar\s*\{[\s\S]*?display:\s*none !important;/);
  assert.doesNotMatch(css, /scrollbar-gutter/);
  assert.doesNotMatch(css, /::-webkit-scrollbar-thumb/);
  assert.match(dashboard, /md:overflow-y-auto/);
  assert.doesNotMatch(dashboard, /scrollbar-gutter/);
});

test("new vault passwords receive accessible strength feedback", () => {
  const onboarding = read("src/components/Onboarding.tsx");

  assert.match(onboarding, /estimatePasswordStrength\(password\)/);
  assert.match(onboarding, /mode !== "restore" && \(\s*<PasswordStrengthMeter/);
  assert.match(onboarding, /role="meter"/);
  assert.match(onboarding, /aria-valuemin=\{0\}/);
  assert.match(onboarding, /aria-valuemax=\{4\}/);
  assert.match(onboarding, /Array\.from\(\{ length: 4 \}/);
  assert.match(onboarding, /strength\.feedback/);
});
