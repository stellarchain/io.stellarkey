import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return entry.name.endsWith(".tsx") ? [fullPath] : [];
  });
}

function jsxAttribute(node, sourceFile, name) {
  return node.attributes.properties.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === name,
  );
}

function stringAttributeValue(attribute, sourceFile) {
  if (!attribute?.initializer) return "";
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) return "";
  const expression = attribute.initializer.expression;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  return expression.getText(sourceFile);
}

function isZoomProneControl(node, sourceFile) {
  const tag = node.tagName.getText(sourceFile);
  if (tag === "select" || tag === "textarea") return true;
  if (jsxAttribute(node, sourceFile, "contentEditable")) return true;
  if (tag !== "input") return false;
  const type = stringAttributeValue(jsxAttribute(node, sourceFile, "type"), sourceFile);
  return !type || ["text", "search", "password", "number", "email", "tel", "url"].includes(type);
}

test("Next viewport disables pinch and form-focus zoom", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /export const viewport: Viewport = \{/);
  assert.match(layout, /maximumScale:\s*1,/);
  assert.match(layout, /userScalable:\s*false,/);
});

test("mobile scrolling has one document owner and touch-safe scrollbar policy", () => {
  const css = read("src/app/globals.css");
  const dashboard = read("src/components/Dashboard.tsx");
  const ui = read("src/components/ui.tsx");
  const htmlRule = css.match(/html\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";

  assert.doesNotMatch(htmlRule, /scrollbar-gutter|overflow-y/);
  assert.match(css, /touch-action:\s*pan-x pan-y;/);
  assert.match(
    css,
    /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*and\s*\(min-width:\s*768px\)[\s\S]*?html\s*\{[\s\S]*?scrollbar-gutter:\s*stable;[\s\S]*?::\-webkit-scrollbar/,
  );
  assert.doesNotMatch(
    css,
    /@media\s*\(hover:\s*none\),\s*\(pointer:\s*coarse\)[\s\S]*?scrollbar-width:\s*none/,
  );
  assert.match(
    dashboard,
    /<main[^>]*data-app-scroll-owner[^>]*className="[^"]*md:h-screen md:overflow-y-auto[^"]*"/,
  );
  assert.doesNotMatch(dashboard, /<main className="[^"]*(?<!md:)overflow-y-auto/);
  assert.match(ui, /querySelector<HTMLElement>\("\[data-app-scroll-owner\]"\)/);
  assert.match(ui, /lockedScrollOwner\.style\.overflow = scrollOwnerOverflowBeforeLock/);
});

test("Dashboard owns the only mobile page gutter and Settings restores desktop spacing", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const settings = read("src/components/SettingsPage.tsx");
  const ui = read("src/components/ui.tsx");

  assert.match(dashboard, /max-w-\[560px\] px-4/);
  assert.match(
    dashboard,
    /max-w-\[1200px\][^"\n]*px-4[^"\n]*md:px-5[^"\n]*pb-\[150px\][^"\n]*md:pb-12/,
  );
  assert.match(
    settings,
    /max-w-\[1000px\][^"\n]*min-w-0[^"\n]*px-0[^"\n]*pb-0[^"\n]*md:px-5[^"\n]*md:pb-\[150px\]/,
  );
  assert.match(ui, /modal-dialog[^`]*min-w-0/);
  assert.match(ui, /bg-\[#121214\]\/80 px-4 py-4[^"\n]*sm:px-6/);
});

test("five-tab mobile bar is viewport-safe at every supported iPhone width", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /\.tab-bar\s*\{[\s\S]*?width:\s*calc\(100vw - 24px\);/);
  assert.match(css, /\.tab-bar\s*\{[\s\S]*?max-width:\s*400px;/);
  assert.match(css, /\.tab-item\s*\{[\s\S]*?flex:\s*1 1 0%;/);
  assert.match(css, /\.tab-item\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(css, /\.tab-item\s*\{[\s\S]*?min-height:\s*44px;/);

  for (const viewportWidth of [320, 375, 390, 430]) {
    const barWidth = Math.min(viewportWidth - 24, 400);
    const itemWidth = (barWidth - 14 - 4 * 2) / 5;
    assert.ok(itemWidth >= 44, `${viewportWidth}px leaves only ${itemWidth}px per tab`);
  }
});

test("popover geometry stays inside a reduced visual viewport", async () => {
  const popover = await import("../src/lib/popover.ts");
  assert.equal(typeof popover.calculatePopoverPosition, "function");
  const calculate = popover.calculatePopoverPosition;

  const cases = [
    {
      name: "anchor near visual top",
      anchor: { top: 12, bottom: 52, left: 4, right: 364, width: 360 },
      expectedOpenUp: false,
    },
    {
      name: "anchor near keyboard",
      anchor: { top: 300, bottom: 340, left: 350, right: 410, width: 60 },
      expectedOpenUp: true,
    },
  ];

  for (const fixture of cases) {
    const position = calculate({
      anchor: fixture.anchor,
      viewport: { top: 0, left: 0, width: 390, height: 360 },
      layoutViewportHeight: 844,
      align: "right",
      matchAnchorWidth: false,
      minWidth: 500,
    });
    const panelBottom = position.top === undefined
      ? 844 - position.bottom
      : position.top + position.maxHeight;
    const panelTop = panelBottom - position.maxHeight;

    assert.equal(position.openUp, fixture.expectedOpenUp, fixture.name);
    assert.ok(panelTop >= 8, `${fixture.name} starts at ${panelTop}`);
    assert.ok(panelBottom <= 352, `${fixture.name} ends at ${panelBottom}`);
    assert.ok(position.left >= 8, `${fixture.name} left edge is ${position.left}`);
    assert.ok(position.left + position.width <= 382, `${fixture.name} overflows right`);
  }

  const tinySpace = calculate({
    anchor: { top: 30, bottom: 50, left: 20, right: 120, width: 100 },
    viewport: { top: 0, left: 0, width: 320, height: 80 },
    layoutViewportHeight: 640,
    align: "left",
    matchAnchorWidth: true,
    minWidth: 200,
  });
  assert.equal(tinySpace.maxHeight, 16, "available space must not be inflated to 120px");
});

test("open popovers track and clean up visual viewport changes", () => {
  const ui = read("src/components/ui.tsx");
  assert.match(ui, /const visualViewport = window\.visualViewport;/);
  assert.match(ui, /visualViewport\?\.addEventListener\("resize", update\);/);
  assert.match(ui, /visualViewport\?\.addEventListener\("scroll", update\);/);
  assert.match(ui, /visualViewport\?\.removeEventListener\("resize", update\);/);
  assert.match(ui, /visualViewport\?\.removeEventListener\("scroll", update\);/);
  assert.match(ui, /menu-pop fixed[^"\n]*overflow-y-auto[^"\n]*overscroll-contain/);
  assert.doesNotMatch(ui, /Math\.max\(120, Math\.min\(300/);
});

test("network switch modal uses the shared mobile padding", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  assert.match(
    dashboard,
    /title="Switch Network"[\s\S]*?<div className="space-y-4 p-4 sm:p-6">/,
  );
});

test("zoom-prone native form controls have no mobile-only sub-16 typography", () => {
  const failures = [];
  const unprefixedSub16 = /(?:^|\s)!?text-(?:xs|sm|\[(?:[0-9](?:\.\d+)?|1[0-5](?:\.\d+)?)px\])(?=\s|$)/;

  for (const filename of sourceFiles(path.join(root, "src"))) {
    const source = readFileSync(filename, "utf8");
    const sourceFile = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    function visit(node) {
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        isZoomProneControl(node, sourceFile)
      ) {
        const className = stringAttributeValue(
          jsxAttribute(node, sourceFile, "className"),
          sourceFile,
        );
        if (unprefixedSub16.test(className)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          failures.push(`${path.relative(root, filename)}:${line + 1} ${className}`);
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.deepEqual(failures, []);
});

test("compact zoom-prone controls retain a 44px mobile height", () => {
  const failures = [];
  const unprefixedCompactHeight = /(?:^|\s)!?h-(?:[0-9]|10)(?=\s|$)/;

  for (const filename of sourceFiles(path.join(root, "src"))) {
    const source = readFileSync(filename, "utf8");
    const sourceFile = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    function visit(node) {
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        isZoomProneControl(node, sourceFile)
      ) {
        const className = stringAttributeValue(
          jsxAttribute(node, sourceFile, "className"),
          sourceFile,
        );
        if (unprefixedCompactHeight.test(className)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          failures.push(`${path.relative(root, filename)}:${line + 1} ${className}`);
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.deepEqual(failures, []);
});

test("CSS provides a final mobile font-size floor for native and editable controls", () => {
  const css = read("src/app/globals.css");
  assert.match(
    css,
    /@media\s*\(max-width:\s*767px\)[\s\S]*?:is\(input:not\(\[type\]\), input\[type="text"\], input\[type="search"\], input\[type="password"\], input\[type="number"\], input\[type="email"\], input\[type="tel"\], input\[type="url"\], select, textarea, \[contenteditable="true"\]\)[\s\S]*?font-size:\s*16px !important;/,
  );
});
