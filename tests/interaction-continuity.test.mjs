import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function sourceFiles(dir = "src") {
  const out = [];
  const walk = (relative) => {
    for (const entry of readdirSync(new URL(`../${relative}/`, import.meta.url), {
      withFileTypes: true,
    })) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name)) out.push(next);
    }
  };
  walk(dir);
  return out;
}

function openingTags(source, component) {
  const tags = [];
  for (const match of source.matchAll(new RegExp(`<${component}\\b`, "g"))) {
    let cursor = match.index + match[0].length;
    let braces = 0;
    let generics = 0;
    while (cursor < source.length) {
      const character = source[cursor];
      if (character === "{") braces += 1;
      else if (character === "}") braces -= 1;
      else if (character === "<" && braces === 0) generics += 1;
      else if (character === ">" && braces === 0) {
        if (generics > 0) generics -= 1;
        else break;
      }
      cursor += 1;
    }
    tags.push(source.slice(match.index, cursor));
  }
  return tags;
}

test("grouped controls cannot ship without an accessible name", () => {
  const ui = read("src/components/ui.tsx");
  const start = ui.indexOf("export function SegmentedControl<");
  const signature = ui.slice(start, ui.indexOf(") {", start));
  assert.match(signature, /ariaLabel: string;/);
  assert.doesNotMatch(signature, /ariaLabel\?: string/);

  for (const path of sourceFiles()) {
    for (const openingTag of openingTags(read(path), "SegmentedControl")) {
      assert.match(openingTag, /ariaLabel=/, `${path}: unnamed SegmentedControl`);
    }
  }
});

test("labels are associated with native controls or replaced by text captions", () => {
  const nativeControl = /<(input|select|textarea)\b/;
  for (const path of sourceFiles()) {
    const source = read(path);
    for (const match of source.matchAll(/<label\b([^>]*)>/g)) {
      if (match[1].includes("htmlFor")) continue;
      const close = source.indexOf("</label>", match.index + match[0].length);
      assert.notEqual(close, -1, `${path}: unclosed label`);
      const inner = source.slice(match.index + match[0].length, close);
      assert.match(
        inner,
        nativeControl,
        `${path}:${source.slice(0, match.index).split("\n").length} label names no control`,
      );
    }
  }
});

test("full-surface customer display shares the overlay scroll lock", () => {
  const customerDisplay = read("src/components/merchant/CustomerDisplay.tsx");
  assert.match(customerDisplay, /useBodyScrollLock\(true\)/);
  assert.doesNotMatch(customerDisplay, /document\.body\.style\.overflow\s*=/);
});
