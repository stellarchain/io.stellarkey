/**
 * Variations on m1-proof. Same language throughout — struck gold, reeded edge,
 * double rim, engraved field — with one variable moved at a time so they read
 * as siblings rather than a grab bag.
 *
 * Every generator returns ELEMENTS, never bare path data: returning `d` strings
 * and dropping them in a <g> is what silently swallowed earlier marks.
 */
import { readFileSync, writeFileSync } from "node:fs";
const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();
const { pts: PTS, bb } = JSON.parse(readFileSync("/tmp/promo/glyph-outline.json", "utf8"));
const [bx, by, bw, bh] = bb, CCX = bx + bw / 2, CCY = by + bh / 2;
const P = (n, d = 2) => Number(n.toFixed(d));
const TAU = Math.PI * 2, CX = 32, CY = 32;
const at = (r, a) => [P(CX + r * Math.cos(a)), P(CY + r * Math.sin(a))];
const fit = (R) => { const ok = (s) => PTS.every(([x, y]) => Math.hypot((x - CCX) * s, (y - CCY) * s) <= R);
  let lo = .1, hi = 4; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; ok(m) ? lo = m : hi = m; } return lo; };
const glyph = (s, fill) =>
  `<g transform="translate(${P(CX - CCX * s, 3)} ${P(CY - CCY * s, 3)}) scale(${P(s, 4)})"><path d="${G}" fill="${fill}"/></g>`;

const reeded = (r0, r1, n, duty = .52) => { const st = TAU / n, h = (st * duty) / 2; let d = "";
  for (let i = 0; i < n; i++) { const a = i * st;
    const [x1, y1] = at(r0, a - h), [x2, y2] = at(r1, a - h * .62), [x3, y3] = at(r1, a + h * .62), [x4, y4] = at(r0, a + h);
    d += `M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}L${x4} ${y4}Z`; }
  return `<path d="${d}" fill="url(#au2)"/>`; };
const beadRim = (r, n, br) => `<path fill="url(#au2)" d="${Array.from({ length: n }, (_, i) => {
  const [x, y] = at(r, (i * TAU) / n); return `M${P(x + br)} ${P(y)}a${br} ${br} 0 1 0 ${P(-2 * br)} 0a${br} ${br} 0 1 0 ${P(2 * br)} 0Z`; }).join("")}"/>`;
const roped = (r0, r1, n) => { const st = TAU / n, h = st * .34; let d = "";
  for (let i = 0; i < n; i++) { const a = i * st;
    const [x1, y1] = at(r0, a - h), [x2, y2] = at(r1, a - h + st * .4), [x3, y3] = at(r1, a + h + st * .4), [x4, y4] = at(r0, a + h);
    d += `M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}L${x4} ${y4}Z`; }
  return `<path d="${d}" fill="url(#au2)"/>`; };
const rose = (R0, amp, lobes, phase = 0, steps = 620) => { let o = "";
  for (let i = 0; i <= steps; i++) { const t = (i / steps) * TAU, r = R0 + amp * Math.cos(lobes * t + phase);
    o += (i ? "L" : "M") + P(CX + r * Math.cos(t)) + " " + P(CY + r * Math.sin(t)); } return o + "Z"; };
const engine = (R0, amp, lobes, rings, sw, op) => Array.from({ length: rings }, (_, i) =>
  `<path d="${rose(R0 - i * amp * 1.2, amp, lobes, (i * Math.PI) / lobes)}" fill="none" stroke="url(#au)" stroke-width="${sw}" opacity="${P(op - i * .05, 2)}"/>`).join("");
const rays = (r0, r1, n) => { const st = TAU / n; let d = "";
  for (let i = 0; i < n; i += 2) { const a = i * st;
    const [x1, y1] = at(r0, a), [x2, y2] = at(r1, a), [x3, y3] = at(r1, a + st), [x4, y4] = at(r0, a + st);
    d += `M${x1} ${y1}L${x2} ${y2}A${r1} ${r1} 0 0 1 ${x3} ${y3}L${x4} ${y4}A${r0} ${r0} 0 0 0 ${x1} ${y1}Z`; }
  return `<path d="${d}" fill="url(#au)" opacity=".4"/>`; };
const hairs = (r0, r1, n) => Array.from({ length: n }, (_, i) =>
  `<circle cx="32" cy="32" r="${P(r0 + ((r1 - r0) * i) / (n - 1))}" fill="none" stroke="url(#au)" stroke-width=".3" opacity=".32"/>`).join("");
const stars = (r, n, sz) => `<path fill="url(#au)" opacity=".9" d="${Array.from({ length: n }, (_, i) => {
  const a = (i * TAU) / n - Math.PI / 2, [x, y] = at(r, a);
  return `M${P(x)} ${P(y - sz)}L${P(x + sz * .32)} ${P(y - sz * .32)}L${P(x + sz)} ${P(y)}L${P(x + sz * .32)} ${P(y + sz * .32)}L${P(x)} ${P(y + sz)}L${P(x - sz * .32)} ${P(y + sz * .32)}L${P(x - sz)} ${P(y)}L${P(x - sz * .32)} ${P(y - sz * .32)}Z`; }).join("")}"/>`;

const DEFS = `
<linearGradient id="au" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#FFF3B0"/><stop offset=".34" stop-color="#FDDA24"/>
  <stop offset=".62" stop-color="#D9A509"/><stop offset=".82" stop-color="#9C6F02"/><stop offset="1" stop-color="#F0CB28"/></linearGradient>
<linearGradient id="au2" x1="56" y1="6" x2="10" y2="58" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#FFF6C6"/><stop offset=".38" stop-color="#EFC318"/>
  <stop offset=".7" stop-color="#B8850A"/><stop offset="1" stop-color="#8B6202"/></linearGradient>
<radialGradient id="field" cx="36%" cy="28%" r="82%">
  <stop offset="0" stop-color="#20262F"/><stop offset=".7" stop-color="#0A0D13"/><stop offset="1" stop-color="#030407"/></radialGradient>`;
const svg = (i) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${DEFS}</defs>${i}</svg>`;

/** the shared shell: blank gold planchet with a reeded edge and a double rim */
const planchet = (edge, fieldR = 25.2) => `
<circle cx="32" cy="32" r="31" fill="url(#au)"/>
${edge}
<circle cx="32" cy="32" r="27.6" fill="none" stroke="#7A5602" stroke-width=".7" opacity=".8"/>
<circle cx="32" cy="32" r="${fieldR}" fill="url(#field)"/>
<circle cx="32" cy="32" r="${fieldR}" fill="none" stroke="url(#au2)" stroke-width="1.5"/>`;

const REED = reeded(28.4, 31.4, 92);
const R_G = 18.4;
const V = {};

/* p1 · proof — the reference */
V["p1-proof"] = svg(`${planchet(REED)}
<circle cx="32" cy="32" r="22.4" fill="none" stroke="url(#au)" stroke-width=".5" opacity=".55"/>
${engine(21.6, 1.5, 40, 4, .34, .4)}
${glyph(fit(R_G), "url(#au)")}`);

/* p2 · bullion — gold field, mark struck dark into it */
V["p2-bullion"] = svg(`
<circle cx="32" cy="32" r="31" fill="url(#au)"/>${REED}
<circle cx="32" cy="32" r="27.6" fill="none" stroke="#7A5602" stroke-width=".7" opacity=".8"/>
<circle cx="32" cy="32" r="25.2" fill="url(#au2)"/>
<circle cx="32" cy="32" r="25.2" fill="none" stroke="#8A6202" stroke-width="1" opacity=".8"/>
<g opacity=".22">${engine(21.6, 1.5, 40, 3, .4, .55)}</g>
${glyph(fit(R_G), "#0A0D13")}`);

/* p3 · incuse — the mark cut into the field rather than raised on it */
{ const s = fit(19.2);
  V["p3-incuse"] = svg(`
<mask id="p3" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
  <rect width="64" height="64" fill="#000"/><circle cx="32" cy="32" r="25.2" fill="#fff"/>${glyph(s, "#000")}</mask>
<circle cx="32" cy="32" r="31" fill="url(#au)"/>${REED}
<circle cx="32" cy="32" r="27.6" fill="none" stroke="#7A5602" stroke-width=".7" opacity=".8"/>
<circle cx="32" cy="32" r="26" fill="url(#au2)"/>
<circle cx="32" cy="32" r="25.2" fill="url(#field)"/>
<rect width="64" height="64" fill="url(#au)" mask="url(#p3)"/>
<circle cx="32" cy="32" r="25.2" fill="none" stroke="#6E4E02" stroke-width=".6" opacity=".6"/>`); }

/* p4 · sunburst — radiating field instead of engine turning */
V["p4-sunburst"] = svg(`${planchet(REED)}
${rays(19.6, 24.4, 60)}
<circle cx="32" cy="32" r="19.6" fill="url(#field)"/>
<circle cx="32" cy="32" r="19.6" fill="none" stroke="url(#au)" stroke-width=".9" opacity=".8"/>
${glyph(fit(17.4), "url(#au)")}`);

/* p5 · lathe — concentric hairlines, the plainest engraving */
V["p5-lathe"] = svg(`${planchet(REED)}
${hairs(15.4, 23.4, 9)}
${glyph(fit(R_G), "url(#au)")}`);

/* p6 · beaded — the edge treatment changed, everything else held */
V["p6-beaded"] = svg(`${planchet(beadRim(30.2, 52, 1.55))}
<circle cx="32" cy="32" r="22.4" fill="none" stroke="url(#au)" stroke-width=".5" opacity=".55"/>
${engine(21.6, 1.5, 40, 4, .34, .4)}
${glyph(fit(R_G), "url(#au)")}`);

/* p7 · roped — a cable edge, the other classic coin rim */
V["p7-roped"] = svg(`${planchet(roped(28.2, 31.3, 58))}
<circle cx="32" cy="32" r="22.4" fill="none" stroke="url(#au)" stroke-width=".5" opacity=".55"/>
${engine(21.6, 1.5, 40, 4, .34, .4)}
${glyph(fit(R_G), "url(#au)")}`);

/* p8 · legend — a ring of stars set inside the rim */
V["p8-legend"] = svg(`${planchet(REED, 26)}
${stars(22.4, 12, 1.9)}
<circle cx="32" cy="32" r="18.8" fill="none" stroke="url(#au)" stroke-width=".8" opacity=".75"/>
${glyph(fit(16.6), "url(#au)")}`);

/* p9 · mirror — no engraving at all, the most restrained of the family */
V["p9-mirror"] = svg(`${planchet(REED)}
<circle cx="32" cy="32" r="22.4" fill="none" stroke="url(#au)" stroke-width=".45" opacity=".5"/>
${glyph(fit(19.4), "url(#au)")}`);

let bad = 0;
for (const [k, v] of Object.entries(V)) {
  const open = (v.match(/<(?!\/)[a-zA-Z]/g) || []).length, close = (v.match(/<\//g) || []).length + (v.match(/\/>/g) || []).length;
  if (!v.includes(G)) { console.log("GLYPH ALTERED:", k); bad++; }
  if (open !== close) { console.log("UNBALANCED:", k); bad++; }
  if (/<g[^>]*>\s*M[\d.-]/.test(v)) { console.log("RAW PATH DATA IN <g>:", k); bad++; }
  writeFileSync(`/tmp/promo/${k}.svg`, v);
}
writeFileSync("/tmp/promo/proofs.json", JSON.stringify(V));
console.log(Object.entries(V).map(([k, v]) => `${k.padEnd(12)} ${(v.length / 1024).toFixed(0)}KB`).join("\n"));
console.log(`\n${Object.keys(V).length} proof variations · ${bad} problems`);
