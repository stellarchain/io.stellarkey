/**
 * Flat marks. No gradients, no bevels, no metal, no ornament — one shape and
 * one fill, judged at 16px unchanged. Where a diagonal is used it is the
 * glyph's own principal axis (-30.36 deg), measured rather than guessed.
 */
import { readFileSync, writeFileSync } from "node:fs";
const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();
const { pts: PTS, bb } = JSON.parse(readFileSync("/tmp/promo/glyph-outline.json", "utf8"));
const { deg: AXIS } = JSON.parse(readFileSync("/tmp/promo/glyph-axis.json", "utf8"));
const [bx, by, bw, bh] = bb, CCX = bx + bw / 2, CCY = by + bh / 2;
const P = (n, d = 2) => Number(n.toFixed(d));

/** Largest scale whose outline fits a box inset from the tile. */
const fitBox = (pad, cx = 32, cy = 32) => {
  const ok = (s) => PTS.every(([x, y]) => {
    const px = cx + (x - CCX) * s, py = cy + (y - CCY) * s;
    return px >= pad && px <= 64 - pad && py >= pad && py <= 64 - pad; });
  let lo = .1, hi = 4; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; ok(m) ? lo = m : hi = m; } return lo;
};
const glyph = (s, fill, cx = 32, cy = 32) =>
  `<g transform="translate(${P(cx - CCX * s, 3)} ${P(cy - CCY * s, 3)}) scale(${P(s, 4)})"><path d="${G}" fill="${fill}"/></g>`;
const svg = (i) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${i}</svg>`;
/** container drawn in currentColor with the glyph cut out of it */
const cut = (id, shape, s, cx = 32, cy = 32) => svg(
  `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">` +
  `<rect width="64" height="64" fill="#000"/><g fill="#fff">${shape}</g>${glyph(s, "#000", cx, cy)}</mask>` +
  `<rect width="64" height="64" fill="currentColor" mask="url(#${id})"/>`);

const SQ = `<rect width="64" height="64" rx="14.5"/>`;
const F = {};

/* f1 · tile — the baseline: a squircle with the mark cut out */
F["f1-tile"] = cut("f1", SQ, fitBox(11.5));

/* f2 · keyway — one notch cut into the base. The only idea in the mark, and
   it is the product's noun. */
{ const s = fitBox(11.5, 32, 29.5);
  F["f2-keyway"] = svg(
`<mask id="f2" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
<rect width="64" height="64" fill="#000"/><g fill="#fff">${SQ}</g>
${glyph(s, "#000", 32, 29.5)}
<path d="M27.5 64V57a4.5 4.5 0 0 1 9 0v7Z" fill="#000"/></mask>
<rect width="64" height="64" fill="currentColor" mask="url(#f2)"/>`); }

/* f3 · split — the tile parted on the glyph's own axis by a clean gap, the two
   halves offset. A second flat tone, never an opacity: over a coloured ground
   a translucent black reads as dirt, not as a colour. */
{ const s = fitBox(12), a = (AXIS * Math.PI) / 180;
  const dx = P(Math.cos(a) * 90), dy = P(Math.sin(a) * 90);
  const nx = P(Math.cos(a + Math.PI / 2) * 1.6), ny = P(Math.sin(a + Math.PI / 2) * 1.6);
  F["f3-split"] = svg(
`<mask id="f3" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
<rect width="64" height="64" fill="#000"/><g fill="#fff">${SQ}</g>${glyph(s, "#000")}
<path d="M${P(32 - dx + nx)} ${P(32 - dy + ny)}L${P(32 + dx + nx)} ${P(32 + dy + ny)}L${P(32 + dx - nx)} ${P(32 + dy - ny)}L${P(32 - dx - nx)} ${P(32 - dy - ny)}Z" fill="#000"/></mask>
<rect width="64" height="64" fill="currentColor" mask="url(#f3)"/>`); }

/* f4 · breakout — the glyph's diagonal continued as a bar that leaves the tile */
{ const s = fitBox(13), a = (AXIS * Math.PI) / 180;
  const bx2 = 32 + Math.cos(a) * 60, by2 = 32 + Math.sin(a) * 60;
  F["f4-breakout"] = svg(
`<mask id="f4" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
<rect width="64" height="64" fill="#000"/><g fill="#fff">${SQ}</g>${glyph(s, "#000")}
<g stroke="#000" stroke-width="5.6" stroke-linecap="butt"><line x1="32" y1="32" x2="${P(bx2)}" y2="${P(by2)}"/></g></mask>
<rect width="64" height="64" fill="currentColor" mask="url(#f4)"/>`); }

/* f5 · disc */
F["f5-disc"] = cut("f5", `<circle cx="32" cy="32" r="32"/>`, fitBox(13.5));

/* f6 · bit — one corner squared off, the way a key's bit breaks its profile */
F["f6-bit"] = cut("f6", `<path d="M14.5 0h35A14.5 14.5 0 0 1 64 14.5v35A14.5 14.5 0 0 1 49.5 64H0V14.5A14.5 14.5 0 0 1 14.5 0Z"/>`, fitBox(12));

/* f7 · wedge — a solid corner block, the way a key's bit interrupts its shank */
{ const s = fitBox(12, 30, 30);
  F["f7-wedge"] = cut("f7", `${SQ}`, s, 30, 30);
  F["f7-wedge"] = F["f7-wedge"].replace("</svg>", `<path d="M44 64h5.5A14.5 14.5 0 0 0 64 49.5V44H44Z" fill="currentColor"/></svg>`); }

/* f8 · shoulder — the tile squared on the hinge side, rounded on the other */
F["f8-shoulder"] = cut("f8", `<path d="M0 0h49.5A14.5 14.5 0 0 1 64 14.5v35A14.5 14.5 0 0 1 49.5 64H0Z"/>`, fitBox(12));

let bad = 0;
for (const [k, v] of Object.entries(F)) {
  const open = (v.match(/<(?!\/)[a-zA-Z]/g) || []).length, close = (v.match(/<\//g) || []).length + (v.match(/\/>/g) || []).length;
  if (!v.includes(G)) { console.log("GLYPH ALTERED:", k); bad++; }
  if (open !== close) { console.log(`UNBALANCED ${k}`); bad++; }
  if (/gradient|Gradient|filter|stop-color/.test(v)) { console.log(`NOT FLAT: ${k}`); bad++; }
  writeFileSync(`/tmp/promo/${k}.svg`, v);
}
writeFileSync("/tmp/promo/flat.json", JSON.stringify(F));
console.log(Object.entries(F).map(([k, v]) => `${k.padEnd(12)} ${(v.length / 1024).toFixed(1)}KB`).join("\n"));
console.log(`\n${Object.keys(F).length} flat marks · ${bad} problems · axis ${AXIS.toFixed(2)}deg`);
