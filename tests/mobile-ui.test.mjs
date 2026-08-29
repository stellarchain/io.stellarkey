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

test("mobile scrolling has one document owner and hides scrollbar chrome", () => {
  const css = read("src/app/globals.css");
  const dashboard = read("src/components/Dashboard.tsx");
  const ui = read("src/components/ui.tsx");
  const htmlRule = css.match(/html\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";

  assert.doesNotMatch(htmlRule, /scrollbar-gutter|overflow-y/);
  assert.match(css, /touch-action:\s*pan-x pan-y;/);
  assert.match(
    css,
    /\*\s*\{[\s\S]*?scrollbar-width:\s*none;/,
  );
  assert.match(
    css,
    /\*::-webkit-scrollbar\s*\{[\s\S]*?display:\s*none !important;/,
  );
  assert.doesNotMatch(css, /scrollbar-gutter|::-webkit-scrollbar-thumb/);
  assert.match(
    dashboard,
    /<main[^>]*data-app-scroll-owner[^>]*className="[^"]*md:h-screen md:overflow-y-auto[^"]*"/,
  );
  assert.doesNotMatch(dashboard, /scrollbar-gutter/);
  assert.doesNotMatch(dashboard, /<main className="[^"]*(?<!md:)overflow-y-auto/);
  assert.match(ui, /querySelector<HTMLElement>\("\[data-app-scroll-owner\]"\)/);
  assert.match(ui, /lockedScrollOwner\.style\.overflow = scrollOwnerOverflowBeforeLock/);
});

test("Dashboard owns the only mobile page gutter and Settings restores desktop spacing", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const settings = read("src/components/SettingsPage.tsx");
  const swap = read("src/components/SwapPage.tsx");
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
  assert.match(
    swap,
    /max-w-\[520px\][^"\n]*min-w-0[^"\n]*px-0[^"\n]*pb-0/,
  );
  assert.match(ui, /modal-dialog[^`]*min-w-0/);
  assert.match(ui, /bg-\[#121214\]\/80 px-4 py-4[^"\n]*sm:px-6/);
});

test("swap amount cards give mobile numbers and asset selectors separate layout ownership", () => {
  const swap = read("src/components/SwapPage.tsx");

  assert.match(swap, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(swap, /min-w-0[^"\n]*text-\[clamp\(/);
  assert.match(swap, /grid-cols-4/);
  assert.match(swap, /break-words text-right/);
});

test("long transaction toasts stay inside the narrowest mobile viewport", () => {
  const toast = read("src/components/Toast.tsx");

  assert.match(toast, /fade-up pointer-events-auto flex min-w-0 max-w-full/);
  assert.match(toast, /min-w-0 truncate text-\[13px\]/);
});

test("paper wallet encrypted export keeps its icon, title, and description aligned", () => {
  const paperWallet = read("src/components/PaperWalletModal.tsx");
  const actionStart = paperWallet.indexOf('data-encrypted-export-action="true"');
  const actionEnd = paperWallet.indexOf("</button>", actionStart);

  assert.notEqual(actionStart, -1);
  assert.notEqual(actionEnd, -1);

  const action = paperWallet.slice(actionStart, actionEnd);
  assert.match(action, /items-center[^"\n]*text-left/);
  assert.doesNotMatch(action, /justify-center/);
  assert.match(action, /<span className="min-w-0 flex-1">/);
  assert.match(action, /className="block text-\[13px\] font-semibold/);
  assert.match(action, /className="mt-0\.5 block text-\[12px\] font-normal/);
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

test("dashboard balances and controls adapt to the narrowest supported iPhone", () => {
  const css = read("src/app/globals.css");
  const dashboard = read("src/components/Dashboard.tsx");

  assert.match(css, /\.balance-display\s*\{[\s\S]*?max-width:\s*100%;/);
  assert.match(css, /\.balance-display-value\s*\{[\s\S]*?font-size:\s*clamp\(/);
  assert.match(
    css,
    /\.balance-display\[data-density="long"\][\s\S]*?\.balance-display-value\s*\{[\s\S]*?font-size:\s*clamp\(/,
  );
  assert.match(dashboard, /data-density=\{heroBalanceDensity\}/);
  assert.match(dashboard, /className="balance-display-value"/);
  assert.match(
    dashboard,
    /className="mt-8 grid w-full max-w-\[360px\] grid-cols-4 gap-2"/,
  );
  assert.match(
    dashboard,
    /className="group flex w-full min-w-0 flex-col items-center gap-2/,
  );
  assert.match(
    dashboard,
    /aria-label=\{`Open account menu for \$\{activeAccount\.label\}`\}[\s\S]*?className="flex min-h-11 min-w-0 flex-1/,
  );
  assert.match(dashboard, /data-mobile-asset-toolbar/);
  assert.match(dashboard, /className="min-w-0 max-w-\[48%\] text-right"/);
  assert.match(dashboard, /className="mono block break-words/);
});

test("merchant analytics and operator grids cannot widen the mobile document", () => {
  const sparkline = read("src/components/Sparkline.tsx");
  const staff = read("src/components/merchant/StaffTerminalsPage.tsx");
  const disclosure = read("src/components/merchant/Disclosure.tsx");

  assert.match(sparkline, /className="[^"]*h-auto[^"]*max-w-full/);
  assert.match(staff, /grid-cols-\[minmax\(0,1fr\)\]/);
  assert.match(staff, /data-mobile-scroll="true"/);
  assert.match(disclosure, /w-full min-w-0 items-center/);
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

test("the Friendbot action can wrap inside the narrowest WebKit viewport", () => {
  const settings = read("src/components/SettingsPage.tsx");
  const friendbotAction = settings.match(
    /\{network === "testnet"[\s\S]*?<Button[\s\S]*?handleClaimFriendbot\(\)[\s\S]*?<\/Button>/,
  )?.[0] ?? "";

  assert.match(friendbotAction, /className="[^"]*min-w-0[^"]*!px-3[^"]*"/);
  assert.match(
    friendbotAction,
    /<span className="min-w-0 whitespace-normal text-center leading-tight">\s*Claim 10,000 Testnet XLM \(Friendbot\)\s*<\/span>/,
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
