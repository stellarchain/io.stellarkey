/**
 * Vault variations. Fit and emit in one pass, so the geometry the glyph is
 * fitted against is by construction the geometry that gets drawn — the earlier
 * split let the fit use the arch centreline while the file drew a stroke, and
 * the glyph fused into the legs.
 */
import { readFileSync, writeFileSync } from "node:fs";
const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();
const { pts: PTS, bb } = JSON.parse(readFileSync("/tmp/promo/glyph-outline.json", "utf8"));
const [bx, by, bw, bh] = bb, CCX = bx + bw / 2, CCY = by + bh / 2;
const M = 4;                                   // clear space, in tile units

const fitTo = (gx, gy, inside) => {
  const ok = (s) => PTS.every(([x, y]) => inside(gx + (x - CCX) * s, gy + (y - CCY) * s));
  let lo = 0.2, hi = 3.2;
  for (let i = 0; i < 70; i++) { const m = (lo + hi) / 2; ok(m) ? lo = m : hi = m; }
  return lo;
};
const archIn = (cx, cy0, R, w) => { const Ri = R - w / 2 - M;
  return (x, y) => (y <= cy0 ? Math.hypot(x - cx, y - cy0) <= Ri : Math.abs(x - cx) <= Ri); };
const circIn = (cx, cy, R, w) => { const Ri = R - w / 2 - M; return (x, y) => Math.hypot(x - cx, y - cy) <= Ri; };
const rectIn = (x0, y0, x1, y1) => (x, y) => x >= x0 + M && x <= x1 - M && y >= y0 + M && y <= y1 - M;

const g = (cx, cy, s, fill) =>
  `<g transform="translate(${(cx - CCX * s).toFixed(3)} ${(cy - CCY * s).toFixed(3)}) scale(${s.toFixed(4)})"><path d="${G}" fill="${fill}"/></g>`;
const svg = (i) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${i}</svg>`;
const pos = (i) => svg(`<g fill="currentColor" stroke="currentColor">${i}</g>`);
const knock = (id, solid, cut) => svg(`<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#000"/><g fill="#fff">${solid}</g><g fill="#000">${cut}</g></mask><rect width="64" height="64" fill="currentColor" mask="url(#${id})"/>`);

const V = {}, log = [];
const add = (k, s, svgStr) => { V[k] = svgStr; log.push([k, s]); };

// 1 · under the arch — glyph on the ground line, headroom above
{ const R = 24, w = 4, cy0 = 27, gy = 41, s = fitTo(32, gy, archIn(32, cy0, R, w));
  add("v1-under", s, pos(`<path fill="none" stroke-width="${w}" d="M${32 - R} 64V${cy0}a${R} ${R} 0 0 1 ${2 * R} 0v37"/>${g(32, gy, s, "currentColor")}`)); }
// 2 · tunnel — wide low arch, glyph filling it
{ const R = 29, w = 4, cy0 = 33, gy = 34, s = fitTo(32, gy, archIn(32, cy0, R, w));
  add("v2-tunnel", s, pos(`<path fill="none" stroke-width="${w}" d="M${32 - R} 64V${cy0}a${R} ${R} 0 0 1 ${2 * R} 0v31"/>${g(32, gy, s, "currentColor")}`)); }
// 3 · door — solid slab, glyph struck through it
{ const s = fitTo(32, 36, rectIn(11, 12, 53, 60));
  add("v3-door", s, knock("v3", `<path d="M11 60V28a21 21 0 0 1 42 0v32Z"/>`, g(32, 36, s, "#000"))); }
// 4 · round vault door
{ const R = 26, w = 4, s = fitTo(32, 32, circIn(32, 32, R, w));
  add("v4-round", s, pos(`<circle cx="32" cy="32" r="${R}" fill="none" stroke-width="${w}"/>${g(32, 32, s, "currentColor")}<g stroke="none"><circle cx="32" cy="3.2" r="2.7"/><circle cx="60.8" cy="32" r="2.7"/><circle cx="32" cy="60.8" r="2.7"/><circle cx="3.2" cy="32" r="2.7"/></g>`)); }
// 5 · wall — solid mass, opening cut, glyph standing in the opening
{ const s = fitTo(32, 44, archIn(32, 33, 18, 0));
  add("v5-wall", s, svg(`<mask id="v5" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#000"/><path d="M4 62V30a28 28 0 0 1 56 0v32Z" fill="#fff"/><path d="M14 62V33a18 18 0 0 1 36 0v29Z" fill="#000"/>${g(32, 44, s, "#fff")}</mask><rect width="64" height="64" fill="currentColor" mask="url(#v5)"/>`)); }
// 6 · threshold — arch closed by a counter line
{ const R = 23, w = 4, cy0 = 28, gy = 38, s = fitTo(32, gy, archIn(32, cy0, R, w));
  add("v6-threshold", s, pos(`<path fill="none" stroke-width="${w}" d="M${32 - R} 54V${cy0}a${R} ${R} 0 0 1 ${2 * R} 0v26"/>${g(32, gy, s, "currentColor")}<rect x="4" y="55.5" width="56" height="5" rx="2.5" stroke="none"/>`)); }

let bad = 0;
for (const [k, v] of Object.entries(V)) { if (!v.includes(G)) { console.log("ALTERED", k); bad++; } writeFileSync(`/tmp/promo/${k}.svg`, v); }
writeFileSync("/tmp/promo/vaults.json", JSON.stringify(V));
console.log(log.map(([k, s]) => `${k.padEnd(14)} scale ${s.toFixed(3)}  glyph ${(24 * s).toFixed(1)}u`).join("\n"));
console.log(`\n${Object.keys(V).length} variations · ${bad} altered · clear space ${M}u`);
