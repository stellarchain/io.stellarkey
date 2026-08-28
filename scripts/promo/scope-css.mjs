/**
 * Scopes a stylesheet under a single class so it cannot reach anything else.
 * Walks the source and rewrites every selector at any nesting depth, rather
 * than matching line shapes: the source puts declarations on the selector's
 * own line, so a line-based pass silently scopes almost nothing.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const SP = process.argv[2], ROOT = ".mk";
const cut = (s, a, b) => s.slice(s.indexOf(a) + a.length, s.lastIndexOf(b));
let css = cut(readFileSync(SP + "/v2-head.html", "utf8"), "<style>", "</style>");
const legal = readFileSync(SP + "/stellarkey-legal.html", "utf8");
css += "\n" + legal.slice(legal.indexOf("/* ── documents"), legal.lastIndexOf("</style>"));

const scopeSelector = (sel) => sel.split(",").map((raw) => {
  const s = raw.trim();
  if (!s) return s;
  if (/^(from|to|\d+%)$/.test(s)) return s;          // keyframe stops
  if (s.startsWith(ROOT)) return s;
  if (s === ":root" || s === "html" || s === "body") return ROOT;
  if (s === "*") return `${ROOT} *`;
  if (s.startsWith("::selection")) return `${ROOT} ::selection`;
  return `${ROOT} ${s}`;
}).join(", ");

/* walk the sheet, tracking depth so @media contents are scoped too.
   Comments are copied through untouched: folding them into the selector buffer
   makes the scoper rewrite prose as if it were a selector list. */
let out = "", i = 0, buf = "";
const atNested = /^@(media|supports|container|layer)/i;
const stack = [];
while (i < css.length) {
  if (css[i] === "/" && css[i + 1] === "*") {
    const end = css.indexOf("*/", i + 2);
    const stop = end === -1 ? css.length : end + 2;
    out += buf + css.slice(i, stop); buf = ""; i = stop; continue;
  }
  const ch = css[i];
  if (ch === "{") {
    const head = buf.trim(); buf = "";
    if (head.startsWith("@")) { stack.push(atNested.test(head) ? "nested" : "raw"); out += head + "{"; }
    else if (stack[stack.length - 1] === "raw") { stack.push("raw"); out += head + "{"; }
    else { stack.push("rule"); out += scopeSelector(head) + "{"; }
    i++; continue;
  }
  if (ch === "}") { out += buf + "}"; buf = ""; stack.pop(); i++; continue; }
  buf += ch; i++;
}
out += buf;

mkdirSync("src/components/marketing", { recursive: true });
writeFileSync("src/components/marketing/marketing.css",
`/*
 * Marketing surfaces only. Every rule is scoped under ${ROOT} so the wallet's
 * iOS design system is untouched: two deliberate systems, no shared tokens and
 * no bleed in either direction.
 */
${out}
`);
const bare = out.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = bare.match(/[^{}]+\{/g) || [];
const unscoped = rules.map((r) => r.replace(/[\n{]/g, "").trim())
  .filter((r) => r && !r.startsWith("@") && !r.includes(ROOT) &&
    // keyframe stops are emitted raw and list-separated: "0%,100%"
    !r.split(",").every((p) => /^(from|to|\d+%)$/.test(p.trim())));
console.log(`marketing.css · ${(out.length / 1024).toFixed(0)} KB · ${rules.length} rules`);
console.log("unscoped:", unscoped.length ? unscoped.slice(0, 6) : "none");
