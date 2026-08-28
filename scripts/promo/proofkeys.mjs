/**
 * p1-proof spun into a key. The coin becomes the bow, so it has to shrink and
 * move — which means every internal (reed count, rim offsets, engine turning,
 * glyph) is derived from the coin's radius rather than hardcoded. Reed count in
 * particular has to fall with the radius or the milling turns to mush.
 */
import { readFileSync, writeFileSync } from "node:fs";
const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();
const { pts: PTS, bb } = JSON.parse(readFileSync("/tmp/promo/glyph-outline.json", "utf8"));
const [bx, by, bw, bh] = bb, CCX = bx + bw / 2, CCY = by + bh / 2;
const P = (n, d = 2) => Number(n.toFixed(d));
const TAU = Math.PI * 2;
const at = (cx, cy, r, a) => [P(cx + r * Math.cos(a)), P(cy + r * Math.sin(a))];
const fit = (R) => { const ok = (s) => PTS.every(([x, y]) => Math.hypot((x - CCX) * s, (y - CCY) * s) <= R);
  let lo = .05, hi = 4; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; ok(m) ? lo = m : hi = m; } return lo; };
const glyph = (cx, cy, s, fill) =>
  `<g transform="translate(${P(cx - CCX * s, 3)} ${P(cy - CCY * s, 3)}) scale(${P(s, 4)})"><path d="${G}" fill="${fill}"/></g>`;

/** The p1-proof coin, fully parameterised on centre and radius. */
function proofCoin(cx, cy, R, { engraved = true } = {}) {
  const k = R / 31;                                   // scale against the original
  const reeds = Math.max(24, Math.round(92 * k));     // milling scales with circumference
  const rReedIn = R * .916, rHair = R * .890, rField = R * .813, rInner = R * .723;
  const st = TAU / reeds, h = (st * .52) / 2;
  let d = "";
  for (let i = 0; i < reeds; i++) { const a = i * st;
    const [x1, y1] = at(cx, cy, rReedIn, a - h), [x2, y2] = at(cx, cy, R * 1.013, a - h * .62);
    const [x3, y3] = at(cx, cy, R * 1.013, a + h * .62), [x4, y4] = at(cx, cy, rReedIn, a + h);
    d += `M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}L${x4} ${y4}Z`; }
  const rose = (R0, amp, lobes, phase) => { let o = "";
    for (let i = 0; i <= 560; i++) { const t = (i / 560) * TAU, r = R0 + amp * Math.cos(lobes * t + phase);
      o += (i ? "L" : "M") + P(cx + r * Math.cos(t)) + " " + P(cy + r * Math.sin(t)); } return o + "Z"; };
  const turning = engraved ? Array.from({ length: 4 }, (_, i) =>
    `<path d="${rose(rInner * .965 - i * 1.5 * 1.2 * k, 1.5 * k, 40, (i * Math.PI) / 40)}" fill="none" stroke="url(#au)" stroke-width="${P(.34 * k, 3)}" opacity="${P(.4 - i * .05, 2)}"/>`).join("") : "";
  return `
<circle cx="${cx}" cy="${cy}" r="${P(R)}" fill="url(#au)"/>
<path d="${d}" fill="url(#au2)"/>
<circle cx="${cx}" cy="${cy}" r="${P(rHair)}" fill="none" stroke="#7A5602" stroke-width="${P(.7 * k, 2)}" opacity=".8"/>
<circle cx="${cx}" cy="${cy}" r="${P(rField)}" fill="url(#field)"/>
<circle cx="${cx}" cy="${cy}" r="${P(rField)}" fill="none" stroke="url(#au2)" stroke-width="${P(1.5 * k, 2)}"/>
<circle cx="${cx}" cy="${cy}" r="${P(rInner)}" fill="none" stroke="url(#au)" stroke-width="${P(.5 * k, 2)}" opacity=".55"/>
${turning}
${glyph(cx, cy, fit(R * .594), "url(#au)")}`;
}

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

const K = {};

/* k1 · diagonal — coin as the bow, blade running out at 45 deg */
{ const cx = 22.5, cy = 22.5, R = 20;
  K["k1-diagonal"] = svg(`
<g transform="rotate(45 ${cx} ${cy})">
  <path d="M${cx} ${cy - 4}H60.4a2.6 2.6 0 0 1 2.6 2.6v2.8a2.6 2.6 0 0 1-2.6 2.6H57.8v6h-7v-6h-3.8v8.2h-7v-8.2H${cx}Z" fill="url(#au2)"/>
</g>
${proofCoin(cx, cy, R)}`); }

/* k2 · shank — a vertical key, coin on top */
{ const cx = 32, cy = 21.5, R = 19.5;
  K["k2-shank"] = svg(`
<path d="M27.6 ${cy}h8.8v33.4a4.4 4.4 0 0 1-8.8 0Z" fill="url(#au2)"/>
<path d="M36 41.8h7.6a1.9 1.9 0 0 1 1.9 1.9v2.2a1.9 1.9 0 0 1-1.9 1.9H36Z" fill="url(#au2)"/>
<path d="M36 51.4h6a1.9 1.9 0 0 1 1.9 1.9v2.2a1.9 1.9 0 0 1-1.9 1.9H36Z" fill="url(#au2)"/>
${proofCoin(cx, cy, R)}`); }

/* k3 · keyway — the coin is the lock: a keyhole cut through its field */
{ const cx = 32, cy = 32, R = 31;
  const s = fit(R * .52);
  K["k3-keyway"] = svg(`
<mask id="k3" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
  <rect width="64" height="64" fill="#fff"/>
  <path d="M32 36.4a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2Zm-2.5 8.4h5l1.5 7.6h-8Z" fill="#000"/></mask>
<g mask="url(#k3)">${proofCoin(cx, cy, R)}</g>
<path d="M32 36.4a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2Zm-2.5 8.4h5l1.5 7.6h-8Z" fill="none" stroke="url(#au)" stroke-width=".8" opacity=".75"/>
${glyph(cx, 25.4, s, "url(#au)")}`); }

/* k4 · fob — coin hung on a ring, the way a key actually lives */
{ const cx = 32, cy = 38, R = 23.5;
  K["k4-fob"] = svg(`
<circle cx="32" cy="9.4" r="6.4" fill="none" stroke="url(#au2)" stroke-width="2.6"/>
<path d="M29.4 14.2h5.2v4.4h-5.2Z" fill="url(#au2)"/>
${proofCoin(cx, cy, R)}`); }

/* k5 · bit — the milled rim interrupted by three key teeth */
{ const cx = 23, cy = 30, R = 21;
  K["k5-bit"] = svg(`
<path d="M${cx} 26.2h38.4v7.6h-5v6.6h-6.6v-6.6h-4.4v9h-6.6v-9H${cx}Z" fill="url(#au2)"/>
${proofCoin(cx, cy, R)}`); }

/* k6 · pendant — coin with a cast bail, blade below */
{ const cx = 32, cy = 24, R = 18.4;
  K["k6-pendant"] = svg(`
<path d="M28 ${cy}h8v34.6a4 4 0 0 1-8 0Z" fill="url(#au2)"/>
<path d="M35.6 44.6h7.2a1.9 1.9 0 0 1 1.9 1.9v2.1a1.9 1.9 0 0 1-1.9 1.9h-7.2Z" fill="url(#au2)"/>
<path d="M35.6 53.4h5.6a1.9 1.9 0 0 1 1.9 1.9v2.1a1.9 1.9 0 0 1-1.9 1.9h-5.6Z" fill="url(#au2)"/>
<circle cx="32" cy="4.6" r="3.8" fill="none" stroke="url(#au2)" stroke-width="2"/>
${proofCoin(cx, cy, R)}`); }

let bad = 0;
for (const [k, v] of Object.entries(K)) {
  const open = (v.match(/<(?!\/)[a-zA-Z]/g) || []).length, close = (v.match(/<\//g) || []).length + (v.match(/\/>/g) || []).length;
  if (!v.includes(G)) { console.log("GLYPH ALTERED:", k); bad++; }
  if (open !== close) { console.log("UNBALANCED:", k); bad++; }
  writeFileSync(`/tmp/promo/${k}.svg`, v);
}
writeFileSync("/tmp/promo/proofkeys.json", JSON.stringify(K));
console.log(Object.entries(K).map(([k, v]) => `${k.padEnd(13)} ${(v.length / 1024).toFixed(0)}KB`).join("\n"));
console.log(`\n${Object.keys(K).length} proof keys · ${bad} problems`);
