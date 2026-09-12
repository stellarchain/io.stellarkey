import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/SettingsPage.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("SettingsPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let expression;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useLayoutEffect"
    && node.arguments[0]?.getText(ast).includes("navigationTarget")) expression = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(expression, "Settings owns a post-commit navigation effect");
const compiled = ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

// Run the real effect body with only structural DOM/scroll boundaries replaced.
// No wallet contents or navigation DOM nodes are retained by this fixture.
function navigate({ target = "network", sub = "network", modal = false, heading = true } = {}) {
  const calls = [];
  const navigationTarget = { current: target };
  const root = {
    closest: () => ({ scrollTo: options => calls.push(["owner", options]) }),
    querySelector: () => heading ? { focus: options => calls.push(["heading", options]) } : null,
    focus: options => calls.push(["root", options]),
  };
  vm.runInNewContext(compiled, {
    sub, navigationTarget, settingsRoot: { current: root },
    document: { querySelector: () => modal ? {} : null },
    window: { scrollTo: options => calls.push(["window", options]) },
  })();
  return { calls: JSON.parse(JSON.stringify(calls)), target: navigationTarget.current };
}

test("explicit Settings navigation resets both scroll owners then focuses without scrolling", () => {
  assert.deepEqual(navigate(), { target: null, calls: [
    ["owner", { top: 0, behavior: "instant" }],
    ["window", { top: 0, behavior: "instant" }],
    ["heading", { preventScroll: true }],
  ] });
});
test("ordinary Settings data updates do not reset scroll or focus", () => {
  assert.deepEqual(navigate({ target: null }), { calls: [], target: null });
});
test("a superseded Settings navigation intent cannot survive a different subpage commit", () => {
  assert.deepEqual(navigate({ target: "hardware" }), { calls: [], target: null });
});
test("Settings navigation cannot move focus or scroll behind a shared modal", () => {
  assert.deepEqual(navigate({ modal: true }), { calls: [], target: null });
});
test("headerless Settings navigation focuses the stable named wrapper", () => {
  assert.deepEqual(navigate({ heading: false }).calls.at(-1), ["root", { preventScroll: true }]);
});
