/**
 * Detail pass on the lock marks.
 *
 * What changed, and why:
 *  - shackle legs terminate exactly on the glyph's top edge (tangent), instead
 *    of floating or overlapping ambiguously;
 *  - caps are butt where a stroke meets another form and round only at a free
 *    end — round caps everywhere read as soft and mismatch the glyph, whose
 *    own terminals are angled cuts;
 *  - proportions come from real padlock geometry (shackle ~64% of body width,
 *    rising ~50% of body height);
 *  - the whole composition is measured after drawing and then centred and
 *    scaled to a consistent margin, so every mark has the same optical weight
 *    in the tile rather than whatever its parts happened to add up to.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();
const { bb } = JSON.parse(readFileSync("/tmp/promo/glyph-outline.json", "utf8"));
const { mode: BAR } = JSON.parse(readFileSync("/tmp/promo/stroke.json", "utf8"));
const [bx, by, bw, bh] = bb, CCX = bx + bw / 2, CCY = by + bh / 2;
const P = (n, d = 3) => Number(n.toFixed(d));

const MARGIN = 4;                       // clear space, every mark, no exceptions
const S = 1.2;                          // glyph scale
const W = P(BAR * S);                   // matched stroke weight
const GW = P(bw * S), GH = P(bh * S);   // glyph rendered size

const glyphAt = (cx, cy) =>
  `<path transform="translate(${P(cx - CCX * S)} ${P(cy - CCY * S)}) scale(${P(S, 4)})" d="${G}" fill="currentColor" stroke="none"/>`;

/** shackle whose legs land exactly on `topY`, sized off the body width */
const shackle = (cx, topY, bodyW, riseRatio = .5) => {
  const outer = bodyW * .64, r = outer / 2;
  const rise = bodyW * riseRatio;
  const straight = Math.max(0, rise - r);
  return `<path d="M${P(cx - r)} ${P(topY)}V${P(topY - straight)}a${P(r)} ${P(r)} 0 0 1 ${P(r * 2)} 0V${P(topY)}"
    stroke-width="${W}" stroke-linecap="butt" fill="none"/>`;
};

const VARIANTS = {
  /* one arc, nothing else */
  "r1-padlock": (cx, cy) => `${shackle(cx, P(cy - GH / 2 + W * .18), GW, .46)}${glyphAt(cx, cy)}`,
  /* body outline + shackle: the glyph becomes the lock face */
  "r2-body": (cx, cy) => {
    const pad = W * 1.15, bw2 = GW + pad * 2, bh2 = GH + pad * 2;
    const top = P(cy - bh2 / 2);
    return `${shackle(cx, P(top + W * .2), bw2, .52)}
<rect x="${P(cx - bw2 / 2)}" y="${top}" width="${P(bw2)}" height="${P(bh2)}" rx="${P(W * 2.1)}" stroke-width="${W}" fill="none"/>
${glyphAt(cx, cy)}`; },
  /* the glyph standing under an arch, legs running to the baseline */
  "r3-vault": (cx, cy) => {
    const r = GW * .74, springY = P(cy - GH * .1), footY = P(cy + GH / 2 + W * 2.6);
    return `<path d="M${P(cx - r)} ${footY}V${springY}a${P(r)} ${P(r)} 0 0 1 ${P(r * 2)} 0V${footY}"
      stroke-width="${W}" stroke-linecap="butt" fill="none"/>${glyphAt(cx, cy)}`; },
  /* shackle lifted clear on one side — the same mark, unlocked */
  "r4-open": (cx, cy) => {
    const topY = P(cy - GH / 2 + W * .18), outer = GW * .64, r = outer / 2, rise = GW * .46;
    const straight = Math.max(0, rise - r);
    return `<path d="M${P(cx - r)} ${topY}V${P(topY - straight)}a${P(r)} ${P(r)} 0 0 1 ${P(r * 2)} 0V${P(topY - straight + r * .5)}"
      stroke-width="${W}" stroke-linecap="butt" fill="none"/>${glyphAt(cx, cy)}`; },
};

/*
 * Fit the FAMILY, not each mark. Scaling every variant to its own bbox gave
 * four different stroke weights (2.83-3.58u) and four glyph sizes, which is
 * exactly the inconsistency a family must not have. So: measure them all,
 * derive one scale from the largest, and apply it to every variant. Weight and
 * glyph size then match across the set, and only the outer extents differ.
 */
const b = await chromium.launch();
const page = await b.newPage();
const boxes = {};
for (const [name, build] of Object.entries(VARIANTS)) {
  await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="640" height="640"><g id="m" stroke="currentColor" style="color:#000">${build(32, 32)}</g></svg>`);
  boxes[name] = await page.evaluate(() => { const r = document.getElementById("m").getBBox(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
}
const avail = 64 - MARGIN * 2;
const K = Math.min(...Object.values(boxes).map((r) => Math.min(avail / r.w, avail / r.h)));
const OUT = {};
for (const [name, build] of Object.entries(VARIANTS)) {
  const r = boxes[name];
  const tx = (64 - r.w * K) / 2 - r.x * K, ty = (64 - r.h * K) / 2 - r.y * K;
  OUT[name] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="none" stroke="currentColor" transform="translate(${P(tx)} ${P(ty)}) scale(${P(K, 4)})">${build(32, 32)}</g></svg>`;
  console.log(`${name.padEnd(12)} ${(r.w * K).toFixed(1)}x${(r.h * K).toFixed(1)}u in tile`);
}
await b.close();
console.log(`\nfamily scale x${K.toFixed(4)} — stroke ${(W * K).toFixed(2)}u and glyph ${(GW * K).toFixed(1)}u wide, identical across all`);
let bad = 0;
for (const [k, v] of Object.entries(OUT)) {
  if (!v.includes(G)) { console.log("GLYPH ALTERED:", k); bad++; }
  if (/<svg[^>]*(fill|stroke)=/.test(v)) { console.log("ROOT PRESENTATION ATTR:", k); bad++; }
  writeFileSync(`/tmp/promo/${k}.svg`, v);
}
writeFileSync("/tmp/promo/locks-refined.json", JSON.stringify(OUT));
console.log(`${Object.keys(OUT).length} refined · ${bad} problems · margin ${MARGIN}u minimum`);
