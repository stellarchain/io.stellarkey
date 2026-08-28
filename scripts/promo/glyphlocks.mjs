/**
 * The SCF trick: leave the glyph alone and add ONE simple element drawn in its
 * own weight, so the addition reads as part of the mark rather than a sticker
 * next to it. The glyph's bars measure 2.0 units in its 24-unit space, so every
 * stroke here is exactly 2.0 x the glyph's scale.
 */
import { readFileSync, writeFileSync } from "node:fs";
const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();
const { bb } = JSON.parse(readFileSync("/tmp/promo/glyph-outline.json", "utf8"));
const { mode: BAR } = JSON.parse(readFileSync("/tmp/promo/stroke.json", "utf8"));
const [bx, by, bw, bh] = bb, CCX = bx + bw / 2, CCY = by + bh / 2;
const P = (n, d = 2) => Number(n.toFixed(d));

const place = (cx, cy, s) => ({
  g: `<g transform="translate(${P(cx - CCX * s, 3)} ${P(cy - CCY * s, 3)}) scale(${P(s, 4)})"><path d="${G}" fill="currentColor"/></g>`,
  w: P(BAR * s),                       // matching stroke weight
  hw: P((bw * s) / 2), hh: P((bh * s) / 2),
});
const svg = (i) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="none" stroke="currentColor" stroke-linejoin="round">${i}</g></svg>`;
const L = {};

/* b1 · padlock — the glyph is the lock body, a shackle springs from it */
{ const s = 1.22, { g, w, hw, hh } = place(32, 40, s);
  const sr = P(hw * .62), top = P(40 - hh - sr - w * .3);
  L["b1-padlock"] = svg(
`<path d="M${P(32 - sr)} ${P(top + sr)}v${P(-sr * .1)}a${sr} ${sr} 0 0 1 ${P(sr * 2)} 0v${P(sr * .1)}" stroke-width="${w}" stroke-linecap="round"/>${g}`); }

/* b2 · keyhole — the glyph above, its aperture below, same weight */
{ const s = 1.2, { g, w, hh } = place(32, 27, s);
  const kr = P(w * 1.5), ky = P(27 + hh + kr + w * .9);
  L["b2-keyhole"] = svg(
`${g}<circle cx="32" cy="${ky}" r="${kr}" stroke-width="${w}"/>
<path d="M32 ${P(ky + kr)}v${P(w * 2.4)}" stroke-width="${w}" stroke-linecap="round"/>`); }

/* b3 · key — the glyph is the bow, the shank continues in its own weight */
{ const s = 1.1, { g, w, hw } = place(24, 32, s);
  const x0 = P(24 + hw + w * .5), x1 = 59;
  L["b3-key"] = svg(
`${g}<path d="M${x0} 32H${x1}" stroke-width="${w}" stroke-linecap="round"/>
<path d="M${P(x1 - 10)} 32v${P(w * 3)}" stroke-width="${w}" stroke-linecap="round"/>
<path d="M${x1} 32v${P(w * 2)}" stroke-width="${w}" stroke-linecap="round"/>`); }

/* b4 · badge — a ribbon under the mark, the SCF move applied to a vault */
{ const s = 1.16, { g, w, hh } = place(32, 28, s);
  const y = P(28 + hh + w * 1.4);
  L["b4-badge"] = svg(
`${g}<path d="M18 ${y}h28v${P(w * 4.4)}l-14-${P(w * 2)}-14 ${P(w * 2)}Z" stroke-width="${w}" stroke-linejoin="round"/>`); }

/* b5 · vault — the glyph set under an arch drawn in its own weight */
{ const s = 1.12, { g, w } = place(32, 36, s);
  L["b5-vault"] = svg(
`<path d="M9 60V27a23 23 0 0 1 46 0v33" stroke-width="${w}" stroke-linecap="round"/>${g}`); }

/* b6 · shackle — the shackle passes behind, so the glyph reads as the lock face */
{ const s = 1.18, { g, w, hw, hh } = place(32, 38, s);
  const sr = P(hw * .78);
  L["b6-shackle"] = svg(
`<path d="M${P(32 - sr)} ${P(38 - hh + w)}v${P(-sr * .55)}a${sr} ${sr} 0 0 1 ${P(sr * 2)} 0v${P(sr * .55)}" stroke-width="${w}" stroke-linecap="round"/>
<rect x="${P(32 - hw - w * 1.1)}" y="${P(38 - hh - w * .8)}" width="${P(hw * 2 + w * 2.2)}" height="${P(hh * 2 + w * 1.6)}" rx="${P(w * 1.9)}" stroke-width="${w}"/>${g}`); }

/* b7 · ring — hung from a ring, the way a key is carried */
{ const s = 1.16, { g, w, hh } = place(32, 40, s);
  const rr = P(w * 2.6), ry = P(40 - hh - rr - w * 1.5);
  L["b7-ring"] = svg(
`<circle cx="32" cy="${ry}" r="${rr}" stroke-width="${w}"/>
<path d="M32 ${P(ry + rr)}v${P(w * 1.4)}" stroke-width="${w}" stroke-linecap="round"/>${g}`); }

/* b8 · bolt — a throw bolt sliding out of the mark */
{ const s = 1.14, { g, w, hw } = place(28, 32, s);
  L["b8-bolt"] = svg(
`${g}<path d="M${P(28 + hw + w * .6)} 32H57" stroke-width="${P(w * 2.1)}" stroke-linecap="round"/>`); }

let bad = 0;
for (const [k, v] of Object.entries(L)) {
  const open = (v.match(/<(?!\/)[a-zA-Z]/g) || []).length, close = (v.match(/<\//g) || []).length + (v.match(/\/>/g) || []).length;
  if (!v.includes(G)) { console.log("GLYPH ALTERED:", k); bad++; }
  if (open !== close) { console.log("UNBALANCED:", k); bad++; }
  writeFileSync(`/tmp/promo/${k}.svg`, v);
}
writeFileSync("/tmp/promo/glyphlocks.json", JSON.stringify(L));
console.log(`bar weight ${BAR} units → strokes matched per variant`);
console.log(Object.keys(L).join(", "));
console.log(`\n${Object.keys(L).length} marks · ${bad} problems`);
