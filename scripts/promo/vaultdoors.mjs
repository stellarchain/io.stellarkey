/**
 * Vault doors with a struck-coin finish — the m1-proof craft (reeded edge,
 * double rim, engine-turned field) carrying real vault hardware: spoke wheels,
 * graduated dials, throw bolts, hinge lugs, stepped plug profiles.
 *
 * The glyph always sits in a central boss and the hardware always stops at the
 * boss edge, so nothing ever crosses the official mark.
 */
import { readFileSync, writeFileSync } from "node:fs";
const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();
const { pts: PTS, bb } = JSON.parse(readFileSync("/tmp/promo/glyph-outline.json", "utf8"));
const [bx, by, bw, bh] = bb, CCX = bx + bw / 2, CCY = by + bh / 2;
const P = (n, d = 2) => Number(n.toFixed(d));
const TAU = Math.PI * 2, CX = 32, CY = 32;
const at = (cx, cy, r, a) => [P(cx + r * Math.cos(a)), P(cy + r * Math.sin(a))];

const fit = (R) => {
  const ok = (s) => PTS.every(([x, y]) => Math.hypot((x - CCX) * s, (y - CCY) * s) <= R);
  let lo = 0.1, hi = 3.2;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; ok(m) ? lo = m : hi = m; }
  return lo;
};
const glyph = (s, fill) =>
  `<g transform="translate(${P(CX - CCX * s, 3)} ${P(CY - CCY * s, 3)}) scale(${P(s, 4)})"><path d="${G}" fill="${fill}"/></g>`;

/* ---------- hardware ---------- */
const reeded = (r0, r1, n, duty = .52) => {
  const step = TAU / n, h = (step * duty) / 2; let d = "";
  for (let i = 0; i < n; i++) { const a = i * step;
    const [x1, y1] = at(CX, CY, r0, a - h), [x2, y2] = at(CX, CY, r1, a - h * .62);
    const [x3, y3] = at(CX, CY, r1, a + h * .62), [x4, y4] = at(CX, CY, r0, a + h);
    d += `M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}L${x4} ${y4}Z`; }
  return d;
};
/** Tapered spokes of a handwheel, from boss edge to rim. */
const spokes = (r0, r1, n, w0, w1, phase = 0) => {
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = phase + (i * TAU) / n, p = Math.PI / 2;
    const [x1, y1] = at(CX + w0 * Math.cos(a + p), CY + w0 * Math.sin(a + p), r0, a);
    const [x2, y2] = at(CX + w1 * Math.cos(a + p), CY + w1 * Math.sin(a + p), r1, a);
    const [x3, y3] = at(CX - w1 * Math.cos(a + p), CY - w1 * Math.sin(a + p), r1, a);
    const [x4, y4] = at(CX - w0 * Math.cos(a + p), CY - w0 * Math.sin(a + p), r0, a);
    d += `M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}L${x4} ${y4}Z`;
  }
  return d;
};
/** Graduated dial: minor ticks with a longer one every `major`. */
const ticks = (r0, r1, r1major, n, major) => Array.from({ length: n }, (_, i) => {
  const a = (i * TAU) / n - Math.PI / 2, R = i % major === 0 ? r1major : r1;
  const [x1, y1] = at(CX, CY, r0, a), [x2, y2] = at(CX, CY, R, a);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }).join("");
/** Throw bolts poking out past the door edge. */
const throwBolts = (r0, r1, n, w, phase = 0) => Array.from({ length: n }, (_, i) => {
  const a = phase + (i * TAU) / n, p = Math.PI / 2;
  const [x1, y1] = at(CX + w * Math.cos(a + p), CY + w * Math.sin(a + p), r0, a);
  const [x2, y2] = at(CX + w * Math.cos(a + p), CY + w * Math.sin(a + p), r1, a);
  const [x3, y3] = at(CX - w * Math.cos(a + p), CY - w * Math.sin(a + p), r1, a);
  const [x4, y4] = at(CX - w * Math.cos(a + p), CY - w * Math.sin(a + p), r0, a);
  return `M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}L${x4} ${y4}Z`; }).join("");
const bolts = (r, n, br, phase = 0) => Array.from({ length: n }, (_, i) => {
  const [x, y] = at(CX, CY, r, phase + (i * TAU) / n);
  return `M${P(x + br)} ${P(y)}a${br} ${br} 0 1 0 ${P(-2 * br)} 0a${br} ${br} 0 1 0 ${P(2 * br)} 0Z`; }).join("");
const rose = (R0, amp, lobes, phase = 0, steps = 720) => {
  let out = "";
  for (let i = 0; i <= steps; i++) { const t = (i / steps) * TAU;
    const r = R0 + amp * Math.cos(lobes * t + phase);
    out += (i ? "L" : "M") + P(CX + r * Math.cos(t)) + " " + P(CY + r * Math.sin(t)); }
  return out + "Z";
};
const engine = (R0, amp, lobes, rings, sw, op) => Array.from({ length: rings }, (_, i) =>
  `<path d="${rose(R0 - i * amp * 1.2, amp, lobes, (i * Math.PI) / lobes)}" fill="none" stroke="url(#au)" stroke-width="${sw}" opacity="${P(op - i * .05, 2)}"/>`).join("");

const DEFS = `
<linearGradient id="au" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#FFF3B0"/><stop offset=".34" stop-color="#FDDA24"/>
  <stop offset=".62" stop-color="#D9A509"/><stop offset=".82" stop-color="#9C6F02"/><stop offset="1" stop-color="#F0CB28"/></linearGradient>
<linearGradient id="au2" x1="56" y1="6" x2="10" y2="58" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#FFF3B0"/><stop offset=".34" stop-color="#FDDA24"/>
  <stop offset=".62" stop-color="#D9A509"/><stop offset=".82" stop-color="#9C6F02"/><stop offset="1" stop-color="#F0CB28"/></linearGradient>
<radialGradient id="field" cx="36%" cy="28%" r="82%">
  <stop offset="0" stop-color="#20262F"/><stop offset=".7" stop-color="#0A0D13"/><stop offset="1" stop-color="#030407"/></radialGradient>
<radialGradient id="boss" cx="38%" cy="26%" r="80%">
  <stop offset="0" stop-color="#262D38"/><stop offset="1" stop-color="#06080D"/></radialGradient>`;
const svg = (i) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${DEFS}</defs>${i}</svg>`;

/** shared coin shell: reeded edge, double rim, engraved field */
const shell = (fieldR = 25.2) => `
<circle cx="32" cy="32" r="31" fill="url(#au)"/>
<path d="${reeded(28.4, 31.4, 92)}" fill="url(#au2)"/>
<circle cx="32" cy="32" r="27.6" fill="none" stroke="#7A5602" stroke-width=".7" opacity=".8"/>
<circle cx="32" cy="32" r="${fieldR}" fill="url(#field)"/>
<circle cx="32" cy="32" r="${fieldR}" fill="none" stroke="url(#au2)" stroke-width="1.5"/>`;

const D = {};
/* w1 · handwheel — five tapered spokes from a central boss */
{ const bossR = 11.4, s = fit(bossR - 2.4);
  D["w1-handwheel"] = svg(`${shell()}
${engine(23.4, 1.4, 44, 3, .3, .34)}
<path d="${spokes(bossR, 22.6, 5, 1.9, 1.2, -Math.PI / 2)}" fill="url(#au)" opacity=".95"/>
<circle cx="32" cy="32" r="22.9" fill="none" stroke="url(#au)" stroke-width="1.6" opacity=".9"/>
<path d="${bolts(22.9, 5, 1.5, -Math.PI / 2)}" fill="url(#au2)"/>
<circle cx="32" cy="32" r="${bossR}" fill="url(#boss)" stroke="url(#au)" stroke-width="1.3"/>
${glyph(s, "url(#au)")}`); }

/* w2 · combination dial — graduated ring and an index pointer */
{ const bossR = 15.4, s = fit(bossR - 2.6);
  D["w2-dial"] = svg(`${shell()}
<g stroke="url(#au)" stroke-width=".62" opacity=".8">${ticks(19.4, 21.4, 23.2, 60, 5)}</g>
<circle cx="32" cy="32" r="18.6" fill="none" stroke="url(#au)" stroke-width=".45" opacity=".5"/>
<path d="M32 4.6l2.3 4.2h-4.6Z" fill="url(#au)"/>
<circle cx="32" cy="32" r="${bossR}" fill="url(#boss)" stroke="url(#au)" stroke-width="1.4"/>
<circle cx="32" cy="32" r="${bossR - 1.9}" fill="none" stroke="url(#au)" stroke-width=".4" opacity=".55"/>
${glyph(s, "url(#au)")}`); }

/* w3 · bolt work — throw bolts extending past the door into the frame */
{ const bossR = 16.4, s = fit(bossR - 2.6);
  D["w3-boltwork"] = svg(`
<circle cx="32" cy="32" r="31.4" fill="#080A0F"/>
<path d="${throwBolts(24.6, 31.2, 8, 2.6, -Math.PI / 2)}" fill="url(#au2)"/>
<circle cx="32" cy="32" r="26.2" fill="url(#au)"/>
<path d="${reeded(23.8, 26.2, 72, .5)}" fill="url(#au2)"/>
<circle cx="32" cy="32" r="23.2" fill="url(#field)" stroke="url(#au2)" stroke-width="1.3"/>
${engine(21.4, 1.3, 40, 3, .3, .34)}
<circle cx="32" cy="32" r="${bossR}" fill="url(#boss)" stroke="url(#au)" stroke-width="1.3"/>
${glyph(s, "url(#au)")}`); }

/* w4 · stepped plug — concentric steps receding to the mark */
{ const bossR = 13.6, s = fit(bossR - 2.4);
  const steps = [25.2, 22.2, 19.4, 16.8];
  D["w4-plug"] = svg(`${shell()}
${steps.map((r, i) => `<circle cx="32" cy="32" r="${r}" fill="url(#boss)" stroke="url(#au)" stroke-width="${P(1.25 - i * .17)}" opacity="${P(1 - i * .06, 2)}"/>`).join("")}
<path d="${bolts(23.7, 16, 0.78)}" fill="url(#au)" opacity=".8"/>
<circle cx="32" cy="32" r="${bossR}" fill="url(#boss)" stroke="url(#au)" stroke-width="1.4"/>
${glyph(s, "url(#au)")}`); }

/* w5 · hinged — door set in a frame with hinge lugs on the left */
{ const bossR = 14.4, s = fit(bossR - 2.5);
  D["w5-hinged"] = svg(`
<circle cx="32" cy="32" r="31.4" fill="#070910"/>
<g fill="url(#au2)">
  <rect x="0.6" y="18.4" width="9.4" height="6.6" rx="2.4"/>
  <rect x="0.6" y="28.7" width="9.4" height="6.6" rx="2.4"/>
  <rect x="0.6" y="39" width="9.4" height="6.6" rx="2.4"/>
</g>
<circle cx="34" cy="32" r="28.2" fill="url(#au)"/>
<path d="${reeded(25.6, 28.2, 78, .5).replace(/M(\d)/g, "M$1")}" fill="url(#au2)" transform="translate(2 0)"/>
<circle cx="34" cy="32" r="24.6" fill="url(#field)" stroke="url(#au2)" stroke-width="1.4"/>
<g transform="translate(2 0)">${engine(22.6, 1.4, 44, 3, .3, .32)}</g>
<circle cx="34" cy="32" r="${bossR}" fill="url(#boss)" stroke="url(#au)" stroke-width="1.4"/>
<g transform="translate(2 0)">${glyph(s, "url(#au)")}</g>`); }

/* w6 · time lock — dial ring plus four inspection ports */
{ const bossR = 13.8, s = fit(bossR - 2.4);
  D["w6-timelock"] = svg(`${shell()}
<g stroke="url(#au)" stroke-width=".55" opacity=".75">${ticks(21.2, 22.8, 24.2, 72, 6)}</g>
<path d="${spokes(bossR, 20.4, 4, 1.5, 1.0, -Math.PI / 4)}" fill="url(#au)" opacity=".9"/>
<g fill="url(#boss)" stroke="url(#au)" stroke-width=".8">
  ${[0, 90, 180, 270].map((deg) => { const [x, y] = at(CX, CY, 18.4, (deg * Math.PI) / 180); return `<circle cx="${x}" cy="${y}" r="2.5"/>`; }).join("")}
</g>
<circle cx="32" cy="32" r="${bossR}" fill="url(#boss)" stroke="url(#au)" stroke-width="1.4"/>
${glyph(s, "url(#au)")}`); }

/* integrity: glyph intact, and no unterminated tags (a past bug) */
let bad = 0;
for (const [k, v] of Object.entries(D)) {
  const open = (v.match(/<(?!\/)[a-zA-Z]/g) || []).length;
  const close = (v.match(/<\//g) || []).length + (v.match(/\/>/g) || []).length;
  if (!v.includes(G)) { console.log("GLYPH ALTERED:", k); bad++; }
  if (open !== close) { console.log(`UNBALANCED ${k}: ${open} open vs ${close} closed`); bad++; }
  writeFileSync(`/tmp/promo/${k}.svg`, v);
}
writeFileSync("/tmp/promo/vaultdoors.json", JSON.stringify(D));
console.log(Object.entries(D).map(([k, v]) => `${k.padEnd(14)} ${(v.length / 1024).toFixed(0)}KB`).join("\n"));
console.log(`\n${Object.keys(D).length} vault doors · ${bad} problems`);
