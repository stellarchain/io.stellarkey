/** Measures the mark's real bounding box, then centres and sizes it in the tile. */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();
const CX = 22, CY = 22, R = 16, GS = 0.92;
const BLADE = `<path d="M${CX} ${CY - 3.6}H55.4a2.6 2.6 0 0 1 2.6 2.6v2a2.6 2.6 0 0 1-2.6 2.6H53.2v5.2h-6.4v-5.2h-3.5v7.4h-6.6v-7.4H${CX}Z"/>`;
const BOW = `<circle cx="${CX}" cy="${CY}" r="${R}"/>`;
const GT = `translate(${(CX - 12 * GS).toFixed(3)} ${(CY - 12 * GS).toFixed(3)}) scale(${GS})`;
const body = (f) => `<g fill="${f}"><g transform="rotate(45 ${CX} ${CY})">${BLADE}</g>${BOW}</g>`;

// measure
const b = await chromium.launch();
const page = await b.newPage();
await page.setContent(`<svg id="s" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="640" height="640"><g id="m">${body("#000")}</g></svg>`);
const bb = await page.evaluate(() => { const r = document.getElementById("m").getBBox(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await b.close();

const TARGET = 54;                                   // how much of the 64 tile the mark fills
const s = TARGET / Math.max(bb.w, bb.h);
const tx = (64 - bb.w * s) / 2 - bb.x * s;
const ty = (64 - bb.h * s) / 2 - bb.y * s;
const wrap = (inner) => `<g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${s.toFixed(5)})">${inner}</g>`;
console.log(`bbox ${bb.w.toFixed(1)}x${bb.h.toFixed(1)} at (${bb.x.toFixed(1)},${bb.y.toFixed(1)}) → scale ${s.toFixed(3)}, glyph now ${(24 * GS * s).toFixed(1)}u`);

const GLYPH = (f) => `<g transform="${GT}"><path d="${G}" fill="${f}"/></g>`;
const svg = (inner, extra = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"${extra}>${inner}</svg>`;

const files = {
  // primary: one colour, glyph as a void, adapts to any background
  "keybow-mark": svg(`<mask id="kb" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#000"/>${wrap(body("#fff") + GLYPH("#000"))}</mask><rect width="64" height="64" fill="currentColor" mask="url(#kb)"/>`),
  "keybow-white": svg(wrap(body("#FFFFFF") + GLYPH("#000000"))),
  "keybow-black": svg(wrap(body("#000000") + GLYPH("#FFFFFF"))),
  // small master: below ~24px the glyph is sub-pixel, so it is dropped and the
  // silhouette carries the mark
  "keybow-small": svg(`${wrap(body("currentColor"))}`),
};
for (const [name, out] of Object.entries(files)) {
  if (name !== "keybow-small" && !out.includes(G)) throw new Error("glyph altered in " + name);
  writeFileSync(`/tmp/promo/${name}.svg`, out);
}
writeFileSync("/tmp/promo/keybow-final.json", JSON.stringify(files));
console.log("written:", Object.keys(files).join(", "));
