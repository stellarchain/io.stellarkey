/**
 * w2-dial developed into a proper vault door: the graduated dial and central
 * boss are kept, and hinges are added so it reads as a door rather than a coin.
 *
 * w5 failed on two counts — the hinges were too quiet to justify the offset,
 * and offsetting the door left the tile lopsided. So here the hinge stack is
 * heavy enough to read at 24px, and every variant balances it with hardware on
 * the opposite side, the way a real door carries its handle opposite the hinge.
 */
import { readFileSync, writeFileSync } from "node:fs";
const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();
const { pts: PTS, bb } = JSON.parse(readFileSync("/tmp/promo/glyph-outline.json", "utf8"));
const [bx, by, bw, bh] = bb, CCX = bx + bw / 2, CCY = by + bh / 2;
const P = (n, d = 2) => Number(n.toFixed(d));
const TAU = Math.PI * 2;
const at = (cx, cy, r, a) => [P(cx + r * Math.cos(a)), P(cy + r * Math.sin(a))];
const fit = (R) => { const ok = (s) => PTS.every(([x, y]) => Math.hypot((x - CCX) * s, (y - CCY) * s) <= R);
  let lo = .1, hi = 3.2; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; ok(m) ? lo = m : hi = m; } return lo; };
const glyph = (cx, cy, s, fill) =>
  `<g transform="translate(${P(cx - CCX * s, 3)} ${P(cy - CCY * s, 3)}) scale(${P(s, 4)})"><path d="${G}" fill="${fill}"/></g>`;

const reeded = (cx, cy, r0, r1, n, duty = .52) => { const step = TAU / n, h = (step * duty) / 2; let d = "";
  for (let i = 0; i < n; i++) { const a = i * step;
    const [x1, y1] = at(cx, cy, r0, a - h), [x2, y2] = at(cx, cy, r1, a - h * .62);
    const [x3, y3] = at(cx, cy, r1, a + h * .62), [x4, y4] = at(cx, cy, r0, a + h);
    d += `M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}L${x4} ${y4}Z`; } return d; };
const ticks = (cx, cy, r0, r1, r1M, n, major) => Array.from({ length: n }, (_, i) => {
  const a = (i * TAU) / n - Math.PI / 2, R = i % major === 0 ? r1M : r1;
  const [x1, y1] = at(cx, cy, r0, a), [x2, y2] = at(cx, cy, R, a);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }).join("");
const bolts = (cx, cy, r, n, br, phase = 0) => Array.from({ length: n }, (_, i) => {
  const [x, y] = at(cx, cy, r, phase + (i * TAU) / n);
  return `M${P(x + br)} ${P(y)}a${br} ${br} 0 1 0 ${P(-2 * br)} 0a${br} ${br} 0 1 0 ${P(2 * br)} 0Z`; }).join("");

/** Hinge stack: knuckles on a pin, with straps reaching onto the door face. */
const hinge = (x, ys, kw, kh, strapTo) => ys.map((y) => `
  <rect x="${P(x)}" y="${P(y - kh / 2)}" width="${P(kw)}" height="${P(kh)}" rx="${P(kh / 2)}" fill="url(#au)"/>
  <rect x="${P(x + kw * .28)}" y="${P(y - kh / 2)}" width="${P(kw * .44)}" height="${P(kh)}" fill="url(#au2)" opacity=".55"/>
  <rect x="${P(x + kw - .6)}" y="${P(y - kh * .3)}" width="${P(strapTo - x - kw + .6)}" height="${P(kh * .6)}" rx="${P(kh * .3)}" fill="url(#au2)"/>`).join("");

const DEFS = `
<linearGradient id="au" x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#FFF3B0"/><stop offset=".34" stop-color="#FDDA24"/>
  <stop offset=".62" stop-color="#D9A509"/><stop offset=".82" stop-color="#9C6F02"/><stop offset="1" stop-color="#F0CB28"/></linearGradient>
<linearGradient id="au2" x1="58" y1="6" x2="8" y2="58" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#FFF3B0"/><stop offset=".34" stop-color="#E9BE12"/>
  <stop offset=".62" stop-color="#B98705"/><stop offset="1" stop-color="#8A6100"/></linearGradient>
<radialGradient id="field" cx="36%" cy="28%" r="82%">
  <stop offset="0" stop-color="#20262F"/><stop offset=".7" stop-color="#0A0D13"/><stop offset="1" stop-color="#030407"/></radialGradient>
<radialGradient id="boss" cx="38%" cy="26%" r="80%">
  <stop offset="0" stop-color="#262D38"/><stop offset="1" stop-color="#06080D"/></radialGradient>
<radialGradient id="jamb" cx="50%" cy="50%" r="60%">
  <stop offset="0" stop-color="#0B0E14"/><stop offset="1" stop-color="#04060A"/></radialGradient>`;
const svg = (i) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${DEFS}</defs>${i}</svg>`;

/** the w2 door face, parameterised on centre and radius */
const face = (cx, cy, R, bossR) => `
<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#au)"/>
<path d="${reeded(cx, cy, P(R - 2.9), R, 88)}" fill="url(#au2)"/>
<circle cx="${cx}" cy="${cy}" r="${P(R - 3.5)}" fill="none" stroke="#7A5602" stroke-width=".65" opacity=".8"/>
<circle cx="${cx}" cy="${cy}" r="${P(R - 5.6)}" fill="url(#field)"/>
<circle cx="${cx}" cy="${cy}" r="${P(R - 5.6)}" fill="none" stroke="url(#au2)" stroke-width="1.4"/>
<g stroke="url(#au)" stroke-width=".58" opacity=".82">${ticks(cx, cy, P(R - 11.4), P(R - 9.6), P(R - 8), 60, 5)}</g>
<circle cx="${cx}" cy="${cy}" r="${P(R - 12.2)}" fill="none" stroke="url(#au)" stroke-width=".4" opacity=".5"/>
<circle cx="${cx}" cy="${cy}" r="${bossR}" fill="url(#boss)" stroke="url(#au)" stroke-width="1.35"/>
<circle cx="${cx}" cy="${cy}" r="${P(bossR - 1.8)}" fill="none" stroke="url(#au)" stroke-width=".38" opacity=".55"/>`;

const D = {};

/* h1 · hinged door — three knuckles left, index pointer, latch stud right */
{ const cx = 34.6, cy = 32, R = 25.4, bossR = 13.8, s = fit(bossR - 2.5);
  D["h1-hinged"] = svg(`
<circle cx="32" cy="32" r="31.6" fill="url(#jamb)"/>
${hinge(1.4, [17.6, 32, 46.4], 6.2, 7.4, 12)}
${face(cx, cy, R, bossR)}
<path d="M${cx} ${P(cy - R - 2.6)}l2.2 4h-4.4Z" fill="url(#au)"/>
<circle cx="${P(cx + R + 2.2)}" cy="32" r="2.4" fill="url(#au)"/>
${glyph(cx, cy, s, "url(#au)")}`); }

/* h2 · door in a frame — jamb ring, hinges bridging the gap, throw bolt right */
{ const cx = 33.4, cy = 32, R = 23.6, bossR = 12.6, s = fit(bossR - 2.3);
  D["h2-framed"] = svg(`
<circle cx="32" cy="32" r="31.6" fill="url(#jamb)"/>
<circle cx="32" cy="32" r="30.7" fill="none" stroke="url(#au2)" stroke-width="2.2" opacity=".9"/>
<path d="${bolts(32, 32, 27.6, 24, .72)}" fill="url(#au)" opacity=".45"/>
${hinge(2.6, [19.4, 32, 44.6], 5.4, 6.6, 11.4)}
${face(cx, cy, R, bossR)}
<rect x="${P(cx + R - 1)}" y="29.6" width="9.6" height="4.8" rx="2.4" fill="url(#au2)"/>
${glyph(cx, cy, s, "url(#au)")}`); }

/* h3 · heavy strap — two deep knuckles on a post, handle lever opposite */
{ const cx = 35, cy = 32, R = 25, bossR = 13.4, s = fit(bossR - 2.4);
  D["h3-strap"] = svg(`
<circle cx="32" cy="32" r="31.6" fill="url(#jamb)"/>
<rect x="0.8" y="12.6" width="5.4" height="38.8" rx="2.7" fill="url(#au2)"/>
${hinge(2.4, [21.4, 42.6], 7.4, 9.2, 13)}
${face(cx, cy, R, bossR)}
<g fill="url(#au)"><rect x="${P(cx + R - 1.4)}" y="30.4" width="8.6" height="3.2" rx="1.6"/>
<circle cx="${P(cx + R + 7)}" cy="32" r="3.1"/></g>
${glyph(cx, cy, s, "url(#au)")}`); }

/* h4 · ajar — the door swung slightly open on its hinges, dark jamb behind */
{ const cx = 36.4, cy = 32, R = 24.2, bossR = 12.8, s = fit(bossR - 2.3);
  D["h4-ajar"] = svg(`
<circle cx="30" cy="32" r="31.4" fill="#05070C"/>
<circle cx="30" cy="32" r="30.9" fill="none" stroke="url(#au2)" stroke-width="1.8" opacity=".75"/>
<path d="M30 .6a31.4 31.4 0 0 1 0 62.8Z" fill="url(#jamb)"/>
${hinge(1.6, [18.6, 32, 45.4], 6, 7, 12.6)}
${face(cx, cy, R, bossR)}
<path d="M${cx} ${P(cy - R - 2.4)}l2.1 3.8h-4.2Z" fill="url(#au)"/>
${glyph(cx, cy, s, "url(#au)")}`); }

let bad = 0;
for (const [k, v] of Object.entries(D)) {
  const open = (v.match(/<(?!\/)[a-zA-Z]/g) || []).length;
  const close = (v.match(/<\//g) || []).length + (v.match(/\/>/g) || []).length;
  if (!v.includes(G)) { console.log("GLYPH ALTERED:", k); bad++; }
  if (open !== close) { console.log(`UNBALANCED ${k}: ${open}/${close}`); bad++; }
  writeFileSync(`/tmp/promo/${k}.svg`, v);
}
writeFileSync("/tmp/promo/dialdoors.json", JSON.stringify(D));
console.log(Object.entries(D).map(([k, v]) => `${k.padEnd(12)} ${(v.length / 1024).toFixed(1)}KB`).join("\n"));
console.log(`\n${Object.keys(D).length} hinged dial doors · ${bad} problems`);
