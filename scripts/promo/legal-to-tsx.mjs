/**
 * Converts the five trust-centre documents from the artifact into route files.
 * Icons are deduplicated into one module rather than inlined 83 times, and the
 * values that must track the build — version, commit, contact addresses — are
 * left as markers for the page files to bind.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SP = process.argv[2];
const html = readFileSync(SP + "/stellarkey-legal.html", "utf8");
const main = html.slice(html.indexOf('<main id="top">'), html.indexOf("</main>"));

/* ── icons ─────────────────────────────────────────────────────────── */
const NAMES = [
  ["M8.4 12.2 10.9 14.7 15.8 9.6", "Check"],
  ["M9.2 12.2 11.2 14.2 15 10.4", "Shield"],
  ['<rect x="4" y="10.5"', "Lock"],
  ["M12 4.4 21 19.6H3Z", "Alert"],
  ["M12 4a6 6 0 0 0-6 6v2", "Fingerprint"],
  ["M3.6 12h16.8", "Globe"],
  ["M20 11a8 8 0 0 0-13.6-4.6", "Cycle"],
  ["M14 3H7.4A1.4 1.4 0", "File"],
  ['<rect x="7" y="7"', "Chip"],
  ['<circle cx="8.5" cy="12"', "Key"],
  ["M12 4v16M7 20h10", "Scales"],
  ["M4 5.2A1.2 1.2 0 0 1", "Book"],
  ["m14.9 9.1-1.6 4.2-4.2", "Compass"],
  ["M3 3l18 18", "EyeOff"],
  ["M12 7.4V12l3 1.8", "Clock"],
  ['<rect x="8" y="9"', "Export"],
];
const svgs = [...new Set(main.match(/<svg class="ico"[\s\S]*?<\/svg>/g) || [])];
const iconName = new Map();
for (const svg of svgs) {
  const hit = NAMES.find(([probe]) => svg.includes(probe));
  if (!hit) throw new Error("unnamed icon: " + svg.slice(0, 120));
  iconName.set(svg, "Doc" + hit[1]);
}

const body = (svg) => svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")
  .replace(/\/>/g, " />").replace(/\s+/g, " ").trim();

mkdirSync("src/components/marketing", { recursive: true });
writeFileSync("src/components/marketing/DocIcons.tsx",
`/*
 * The line icons used across the trust-centre documents. One stroke weight,
 * one grid, currentColor throughout, so a heading, a highlight and a callout
 * can each colour the same mark differently without a second copy of it.
 */
function Ico({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

${[...iconName].map(([svg, name]) =>
  `export function ${name}() {\n  return <Ico>${body(svg)}</Ico>;\n}`).join("\n\n")}
`);

/* ── markup → jsx ──────────────────────────────────────────────────── */
const toJsx = (s) => s
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<svg class="ico"[\s\S]*?<\/svg>/g, (m) => `<${iconName.get(m)} />`)
  .replace(/\bclass=/g, "className=")
  .replace(/\bfor=/g, "htmlFor=")
  .replace(/<(br|hr|img|input|source)([^>]*?)\/?>/g, (m, t, a) => `<${t}${a.replace(/\s*\/$/, "")} />`)
  .replace(/&nbsp;/g, " ")
  // straight apostrophes are unescaped entities to JSX, and typographic ones
  // read better in body copy anyway
  .replace(/([A-Za-z])'([A-Za-z])/g, "$1\u2019$2")
  // a bare "//" text child parses as a comment to the JSX linter
  .replace(/>\/\/</g, ">{\"//\"}<");

const text = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const quote = (s) => JSON.stringify(s).replace(/[{}]/g, (c) => `{"${c}"}`).slice(1, -1);

const docs = {};
for (const m of main.matchAll(/<article class="doc" data-page="([a-z]+)"[^>]*>([\s\S]*?)<\/article>/g)) {
  const [, route, art] = m;
  const grab = (re) => (art.match(re) || [, ""])[1];
  docs[route] = {
    eyebrow: text(grab(/<p class="mono-label">([\s\S]*?)<\/p>/)),
    icon: iconName.get((art.match(/<h1 class="display-sm doc-title">(<svg[\s\S]*?<\/svg>)/) || [])[1]),
    title: text(grab(/<h1 class="display-sm doc-title">[\s\S]*?<\/svg>([\s\S]*?)<\/h1>/)),
    lede: text(grab(/<p class="lede">([\s\S]*?)<\/p>/)),
    highlights: [...art.matchAll(/<li>(?:<svg[\s\S]*?<\/svg>)?<span>([\s\S]*?)<\/span><\/li>/g)]
      .map((h) => text(h[1])),
    // only the table of contents, never a cross-reference inside the prose
    sections: [...grab(/<nav class="toc"[^>]*>([\s\S]*?)<\/nav>/)
      .matchAll(/<a href="#([^"]+)">([^<]+)<\/a>/g)].map(([, id, label]) => ({ id, label })),
    prose: toJsx(grab(/<div class="prose">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/)).trim(),
  };
}

mkdirSync(SP + "/legal-out", { recursive: true });
for (const [route, d] of Object.entries(docs)) {
  writeFileSync(`${SP}/legal-out/${route}.json`, JSON.stringify(d, null, 2));
  writeFileSync(`${SP}/legal-out/${route}.jsx`, d.prose);
}
console.log("icons:", iconName.size);
for (const [route, d] of Object.entries(docs)) {
  console.log(` ${route.padEnd(9)} icon=${d.icon} hi=${d.highlights.length} toc=${d.sections.length} prose=${(d.prose.length / 1024).toFixed(1)}KB`);
}
export { docs, quote };
