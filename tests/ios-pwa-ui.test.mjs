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
  assert.doesNotMatch(onboarding, /function backToChoose\(\) \{\s*triggerHaptic/);
  assert.doesNotMatch(onboarding, /onBack=\{\(\) => \{\s*triggerHaptic\("selection"\)/);
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

test("standalone screens and overlays consume the iOS top safe area", () => {
  const css = read("src/app/globals.css");
  const dashboard = read("src/components/Dashboard.tsx");
  const onboarding = read("src/components/Onboarding.tsx");
  const lockScreen = read("src/components/LockScreen.tsx");
  const walletApp = read("src/components/WalletApp.tsx");
  const ui = read("src/components/ui.tsx");
  const toast = read("src/components/Toast.tsx");

  assert.match(css, /--app-safe-area-top:\s*0px;/);
  assert.match(
    css,
    /@media\s*\(display-mode:\s*standalone\)[\s\S]*?--app-safe-area-top:\s*env\(safe-area-inset-top,\s*0px\);/,
  );
  assert.match(css, /\.app-safe-top\s*\{[\s\S]*?padding-top:\s*var\(--app-safe-area-top\);/);
  assert.match(css, /\.app-safe-top-pad-14\s*\{[\s\S]*?calc\(3\.5rem \+ var\(--app-safe-area-top\)\)/);
  assert.match(css, /\.app-safe-top-pad-12\s*\{[\s\S]*?calc\(3rem \+ var\(--app-safe-area-top\)\)/);
  assert.match(css, /\.app-safe-overlay\s*\{[\s\S]*?calc\(1rem \+ var\(--app-safe-area-top\)\)/);
  assert.match(css, /\.app-safe-toast\s*\{[\s\S]*?calc\(1\.25rem \+ var\(--app-safe-area-top\)\)/);
  assert.match(
    css,
    /@media\s*\(display-mode:\s*standalone\)\s*and\s*\(min-width:\s*768px\)[\s\S]*?\.app-safe-toast\s*\{[\s\S]*?calc\(1\.5rem \+ var\(--app-safe-area-top\)\)/,
  );
  assert.match(css, /\.app-safe-sticky-top\s*\{[\s\S]*?top:\s*var\(--app-safe-area-top\);/);
  assert.match(css, /\.app-scroll-sticky-top\s*\{[\s\S]*?top:\s*0;/);
  assert.match(css, /\.app-safe-dashboard\s*\{[\s\S]*?padding-top:\s*0;/);
  assert.match(
    css,
    /@media\s*\(display-mode:\s*standalone\)\s*and\s*\(min-width:\s*768px\)[\s\S]*?\.app-safe-dashboard\s*\{[\s\S]*?padding-top:\s*var\(--app-safe-area-top\);/,
  );
  assert.match(
    css,
    /\.app-mobile-sticky-header\s*\{[\s\S]*?top:\s*0;[\s\S]*?padding-top:\s*var\(--app-safe-area-top\);[\s\S]*?background:\s*#000000;/,
  );
  assert.match(css, /\.nav-blur\s*\{[\s\S]*?top:\s*0;/);
  assert.match(dashboard, /app-safe-dashboard/);
  assert.doesNotMatch(dashboard, /className="app-safe-top relative/);
  assert.equal((dashboard.match(/app-safe-sticky-top/g) ?? []).length, 1);
  assert.match(
    dashboard,
    /<header className="app-scroll-sticky-top hidden md:flex[\s\S]*?sticky/,
  );
  assert.doesNotMatch(dashboard, /sticky top-0/);
  assert.ok((onboarding.match(/app-safe-top/g) ?? []).length >= 2);
  assert.ok((onboarding.match(/app-safe-top-pad-14/g) ?? []).length >= 2);
  assert.match(lockScreen, /app-safe-top/);
  assert.match(lockScreen, /app-safe-top-pad-12/);
  assert.match(walletApp, /app-safe-top/);
  assert.match(ui, /modal-overlay app-safe-overlay/);
  assert.match(toast, /app-safe-toast/);
});

test("the mobile wallet header begins directly below the iOS safe area", () => {
  const dashboard = read("src/components/Dashboard.tsx");

  assert.match(
    dashboard,
    /app-mobile-sticky-header md:hidden sticky[\s\S]*?<div className="flex h-\[44px\] items-center justify-between">/,
  );
  assert.match(
    dashboard,
    /className="flex min-h-11 items-center gap-2 rounded-full/,
  );
  assert.ok(
    (dashboard.match(/className="icon-btn !h-11 !w-11"/g) ?? []).length >= 3,
  );
});

test("asset favorites are discoverable directly in the dashboard list", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const assetDetail = read("src/components/AssetDetailModal.tsx");

  assert.match(dashboard, /aria-pressed=\{isPinned\}/);
  assert.match(dashboard, /aria-label=\{isPinned\s*\?\s*`Remove \$\{asset\.code\} from favorites`\s*:\s*`Mark \$\{asset\.code\} as favorite`\}/);
  assert.match(dashboard, /\{isPinned \? "★" : "☆"\}/);
  assert.doesNotMatch(dashboard, /text-neutral-600 opacity-0 group-hover:opacity-100/);
  assert.doesNotMatch(assetDetail, /Mark .* as favorite|togglePinAsset|pinnedAssets/);
});
