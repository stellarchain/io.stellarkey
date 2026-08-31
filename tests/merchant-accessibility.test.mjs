import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("dropdowns use one native trigger and restore it after menu actions", () => {
  const ui = read("src/components/ui.tsx");

  assert.match(ui, /type DropdownTriggerProps =/);
  assert.match(ui, /trigger: \(open: boolean, props: DropdownTriggerProps\) => React\.ReactNode/);
  assert.match(ui, /ref: anchorRef,/);
  assert.match(ui, /"aria-haspopup": "menu",/);
  assert.match(ui, /anchorRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(ui, /<div\s+role="button"/);
});

test("dropdown menus move focus and support arrow-key navigation", () => {
  const ui = read("src/components/ui.tsx");

  assert.match(ui, /querySelectorAll<HTMLElement>\(\s*'\[role="menuitem"\]/);
  assert.match(ui, /e\.key === "ArrowDown" \|\| e\.key === "ArrowUp"/);
  assert.match(ui, /event\.key === "Home"/);
  assert.match(ui, /event\.key === "End"/);
});

test("modal sheets follow the visual viewport and preserve focus", () => {
  const ui = read("src/components/ui.tsx");

  assert.match(ui, /const \[visualViewport, setVisualViewport\]/);
  assert.match(ui, /window\.visualViewport\?\.addEventListener\("resize", update\)/);
  assert.match(ui, /window\.visualViewport\?\.addEventListener\("scroll", update\)/);
  assert.match(ui, /const restoreTarget = restoreFocusRef\.current/);
  assert.match(ui, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*restoreTarget\.focus\(\{ preventScroll: true \}\)/);
  assert.match(
    ui,
    /function unregisterModal\(modal: HTMLElement\)[\s\S]*modal\.inert = false;[\s\S]*syncModalInertness\(\)/,
  );
  assert.match(ui, /className="flex h-11 w-11 items-center justify-center rounded-full/);
});

test("customer display restores the till control that opened it", () => {
  const display = read("src/components/merchant/CustomerDisplay.tsx");

  assert.match(display, /const restoreFocusRef = useRef<HTMLElement \| null>\(null\)/);
  assert.match(display, /restoreFocusRef\.current = document\.activeElement as HTMLElement \| null/);
  assert.match(display, /restoreFocusRef\.current\?\.focus\?\.\(\{ preventScroll: true \}\)/);
});

test("coarse-pointer controls retain a 44 by 44 CSS-pixel target", () => {
  const css = read("src/app/globals.css");

  assert.match(css, /@media \(hover: none\) and \(pointer: coarse\)/);
  assert.match(css, /:is\(button, \[role="button"\], \[role="menuitem"\]\)/);
  assert.match(css, /min-width:\s*44px;/);
  assert.match(css, /min-height:\s*44px;/);
});
