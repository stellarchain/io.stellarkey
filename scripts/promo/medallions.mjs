/**
 * Medallion system. One coin engine, many dials: edge treatment, rim profile,
 * field engraving, relief direction and metal. Everything is generated, so a
 * variant is a parameter change rather than a redraw.
 * The official Stellar glyph is placed by translate + uniform scale only.
 */
import { readFileSync, writeFileSync } from "node:fs";
const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();
const { pts: PTS, bb } = JSON.parse(readFileSync("/tmp/promo/glyph-outline.json", "utf8"));
const [bx, by, bw, bh] = bb, CCX = bx + bw / 2, CCY = by + bh / 2;
const P = (n, d = 2) => Number(n.toFixed(d));
const TAU = Math.PI * 2;
const at = (cx, cy, r, a) => [P(cx + r * Math.cos(a)), P(cy + r * Math.sin(a))];

const fit = (gx, gy, R) => {
  const ok = (s) => PTS.every(([x, y]) => Math.hypot(gx + (x - CCX) * s - gx, gy + (y - CCY) * s - gy) <= R);
  let lo = 0.1, hi = 3.2;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; ok(m) ? lo = m : hi = m; }
  return lo;
};
const glyph = (cx, cy, s, fill, extra = "") =>
  `<g transform="translate(${P(cx - CCX * s, 3)} ${P(cy - CCY * s, 3)}) scale(${P(s, 4)})"><path d="${G}" fill="${fill}"${extra}/></g>`;

/* ---------- edge treatments ---------- */
const reeded = (cx, cy, r0, r1, n, duty = .52) => {
  const step = TAU / n, h = (step * duty) / 2; let d = "";
  for (let i = 0; i < n; i++) { const a = i * step;
    const [x1, y1] = at(cx, cy, r0, a - h), [x2, y2] = at(cx, cy, r1, a - h * .62);
    const [x3, y3] = at(cx, cy, r1, a + h * .62), [x4, y4] = at(cx, cy, r0, a + h);
    d += `M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}L${x4} ${y4}Z`; }
  return d;
};
const beaded = (cx, cy, r, n, br) => Array.from({ length: n }, (_, i) => {
  const [x, y] = at(cx, cy, r, (i * TAU) / n);
  return `M${P(x + br)} ${P(y)}a${br} ${br} 0 1 0 ${P(-2 * br)} 0a${br} ${br} 0 1 0 ${P(2 * br)} 0Z`; }).join("");
const roped = (cx, cy, r0, r1, n, lean = .38) => {
  const step = TAU / n, h = step * .34; let d = "";
  for (let i = 0; i < n; i++) { const a = i * step;
    const [x1, y1] = at(cx, cy, r0, a - h), [x2, y2] = at(cx, cy, r1, a - h + step * lean);
    const [x3, y3] = at(cx, cy, r1, a + h + step * lean), [x4, y4] = at(cx, cy, r0, a + h);
    d += `M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}L${x4} ${y4}Z`; }
  return d;
};
const dentil = (cx, cy, r0, r1, n) => reeded(cx, cy, r0, r1, n, .44);

/* ---------- field engraving ---------- */
const rose = (cx, cy, R0, amp, lobes, phase = 0, steps = 900) => {
  let out = "";
  for (let i = 0; i <= steps; i++) { const t = (i / steps) * TAU;
    const r = R0 + amp * Math.cos(lobes * t + phase);
    out += (i ? "L" : "M") + P(cx + r * Math.cos(t)) + " " + P(cy + r * Math.sin(t)); }
  return out + "Z";
};
const engine = (cx, cy, R0, amp, lobes, rings, sw, op) => Array.from({ length: rings }, (_, i) =>
  `<path d="${rose(cx, cy, R0 - i * amp * 1.2, amp, lobes, (i * Math.PI) / lobes)}" fill="none" stroke="url(#au)" stroke-width="${sw}" opacity="${P(op - i * .05, 2)}"/>`).join("");
const rays = (cx, cy, r0, r1, n) => { const step = TAU / n; let d = "";
  for (let i = 0; i < n; i += 2) { const a = i * step;
    const [x1, y1] = at(cx, cy, r0, a), [x2, y2] = at(cx, cy, r1, a);
    const [x3, y3] = at(cx, cy, r1, a + step), [x4, y4] = at(cx, cy, r0, a + step);
    d += `M${x1} ${y1}L${x2} ${y2}A${r1} ${r1} 0 0 1 ${x3} ${y3}L${x4} ${y4}A${r0} ${r0} 0 0 0 ${x1} ${y1}Z`; }
  return d; };
const hairlines = (cx, cy, r0, r1, n) => Array.from({ length: n }, (_, i) =>
  `<circle cx="${cx}" cy="${cy}" r="${P(r0 + ((r1 - r0) * i) / (n - 1))}" fill="none" stroke="url(#au)" stroke-width=".28" opacity=".3"/>`).join("");
const stars = (cx, cy, r, n, sz) => Array.from({ length: n }, (_, i) => {
  const a = (i * TAU) / n - Math.PI / 2, [x, y] = at(cx, cy, r, a);
  return `<path d="M${P(x)} ${P(y - sz)}L${P(x + sz * .3)} ${P(y - sz * .3)}L${P(x + sz)} ${P(y)}L${P(x + sz * .3)} ${P(y + sz * .3)}L${P(x)} ${P(y + sz)}L${P(x - sz * .3)} ${P(y + sz * .3)}L${P(x - sz)} ${P(y)}L${P(x - sz * .3)} ${P(y - sz * .3)}Z"/>`; }).join("");

const METALS = {
  au: [["0", "#FFF3B0"], [".34", "#FDDA24"], [".62", "#D9A509"], [".82", "#9C6F02"], ["1", "#F0CB28"]],
  ag: [["0", "#FFFFFF"], [".34", "#DDE3EA"], [".62", "#9AA6B4"], [".82", "#6B7684"], ["1", "#CBD4DD"]],
  cu: [["0", "#FFD9B8"], [".34", "#E2924F"], [".62", "#B4692C"], [".82", "#7A4113"], ["1", "#DE9C5E"]],
};
const defs = (metal = "au") => `
<linearGradient id="au" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
  ${METALS[metal].map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>
<linearGradient id="au2" x1="56" y1="6" x2="10" y2="58" gradientUnits="userSpaceOnUse">
  ${METALS[metal].map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>
<radialGradient id="field" cx="36%" cy="28%" r="82%">
  <stop offset="0" stop-color="#20262F"/><stop offset=".7" stop-color="#0A0D13"/><stop offset="1" stop-color="#030407"/></radialGradient>
`;

const svg = (inner, metal = "au") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${defs(metal)}</defs>${inner}</svg>`;
const M = {}, log = [];
const add = (k, inner, metal) => { M[k] = svg(inner, metal); log.push(k); };

const CX = 32, CY = 32;

/* m1 · proof — double rim, mirror field, frosted relief */
{ const gr = 18.4, s = fit(CX, CY, gr);
  add("m1-proof", `
<circle cx="32" cy="32" r="31" fill="url(#au)"/>
<path d="${reeded(CX, CY, 28.4, 31.4, 92)}" fill="url(#au2)"/>
<circle cx="32" cy="32" r="27.6" fill="none" stroke="#7A5602" stroke-width=".7" opacity=".8"/>
<circle cx="32" cy="32" r="25.2" fill="url(#field)"/>
<circle cx="32" cy="32" r="25.2" fill="none" stroke="url(#au2)" stroke-width="1.5"/>
<circle cx="32" cy="32" r="22.4" fill="none" stroke="url(#au)" stroke-width=".5" opacity=".55"/>
${engine(CX, CY, 21.6, 1.5, 40, 4, .34, .4)}
${glyph(CX, CY, s, "url(#au)")}`); }

/* m2 · bimetallic — outer ring one metal, inner core another */
{ const gr = 15.6, s = fit(CX, CY, gr);
  add("m2-bimetal", `
<circle cx="32" cy="32" r="31" fill="url(#au)"/>
<path d="${roped(CX, CY, 28.2, 31.3, 76)}" fill="url(#au2)"/>
<circle cx="32" cy="32" r="27.4" fill="url(#field)" opacity=".25"/>
${engine(CX, CY, 26.4, 1.3, 48, 3, .3, .45)}
<circle cx="32" cy="32" r="19.6" fill="url(#field)"/>
<circle cx="32" cy="32" r="19.6" fill="none" stroke="url(#au2)" stroke-width="2.2"/>
<circle cx="32" cy="32" r="17.3" fill="none" stroke="url(#au)" stroke-width=".45" opacity=".6"/>
${glyph(CX, CY, s, "url(#au)")}`); }

/* m3 · sunburst — radiating rays behind a cameo */
{ const gr = 16.2, s = fit(CX, CY, gr);
  add("m3-sunburst", `
<circle cx="32" cy="32" r="31" fill="url(#field)"/>
<path d="${rays(CX, CY, 17.4, 29.6, 48)}" fill="url(#au)" opacity=".55"/>
<path d="${beaded(CX, CY, 30.4, 60, 1.05)}" fill="url(#au2)"/>
<circle cx="32" cy="32" r="28.4" fill="none" stroke="url(#au)" stroke-width=".6" opacity=".6"/>
<circle cx="32" cy="32" r="18.2" fill="url(#field)"/>
<circle cx="32" cy="32" r="18.2" fill="none" stroke="url(#au)" stroke-width="1.6"/>
${glyph(CX, CY, s, "url(#au)")}`); }

/* m4 · seal — beaded rim, star legend ring, deep field */
{ const gr = 15.4, s = fit(CX, CY, gr);
  add("m4-seal", `
<circle cx="32" cy="32" r="31" fill="url(#au)"/>
<path d="${beaded(CX, CY, 30.2, 54, 1.5)}" fill="url(#au2)"/>
<circle cx="32" cy="32" r="27.8" fill="url(#field)"/>
<circle cx="32" cy="32" r="27.8" fill="none" stroke="url(#au2)" stroke-width="1.2"/>
<g fill="url(#au)" opacity=".9">${stars(CX, CY, 22.6, 12, 1.9)}</g>
<circle cx="32" cy="32" r="18.6" fill="none" stroke="url(#au)" stroke-width=".8" opacity=".75"/>
<circle cx="32" cy="32" r="17.4" fill="none" stroke="url(#au)" stroke-width=".35" opacity=".5"/>
${glyph(CX, CY, s, "url(#au)")}`); }

/* m5 · incuse — the mark struck INTO the metal rather than raised on it */
{ const gr = 18.8, s = fit(CX, CY, gr);
  add("m5-incuse", `
<mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
  <rect width="64" height="64" fill="#000"/>
  <circle cx="32" cy="32" r="25.4" fill="#fff"/>
  ${glyph(CX, CY, s, "#000")}
</mask>
<circle cx="32" cy="32" r="31" fill="url(#au)"/>
<path d="${dentil(CX, CY, 28.6, 31.4, 64)}" fill="url(#au2)"/>
<circle cx="32" cy="32" r="27.8" fill="none" stroke="#6E4E02" stroke-width=".8" opacity=".7"/>
<circle cx="32" cy="32" r="26.2" fill="url(#au2)"/>
<circle cx="32" cy="32" r="25.4" fill="url(#field)"/>
<rect width="64" height="64" fill="url(#au)" mask="url(#cut)"/>
<circle cx="32" cy="32" r="25.4" fill="none" stroke="#6E4E02" stroke-width=".55" opacity=".55"/>`); }

/* m6 · silver proof */
{ const gr = 18.4, s = fit(CX, CY, gr);
  add("m6-silver", `
<circle cx="32" cy="32" r="31" fill="url(#au)"/>
<path d="${reeded(CX, CY, 28.4, 31.4, 104, .5)}" fill="url(#au2)"/>
<circle cx="32" cy="32" r="27.4" fill="none" stroke="#5A646F" stroke-width=".7" opacity=".8"/>
<circle cx="32" cy="32" r="25" fill="url(#field)"/>
<circle cx="32" cy="32" r="25" fill="none" stroke="url(#au2)" stroke-width="1.5"/>
${hairlines(CX, CY, 19.8, 23.6, 5)}
${glyph(CX, CY, s, "url(#au)")}`, "ag"); }

/* m7 · antique — oxidised field, worn rim, high-contrast relief */
{ const gr = 17.6, s = fit(CX, CY, gr);
  add("m7-antique", `
<circle cx="32" cy="32" r="31" fill="#0B0D12"/>
<path d="${roped(CX, CY, 27.6, 31.2, 58, .5)}" fill="url(#au)" opacity=".85"/>
<circle cx="32" cy="32" r="26.8" fill="url(#field)"/>
<circle cx="32" cy="32" r="26.8" fill="none" stroke="url(#au)" stroke-width="1.1" opacity=".9"/>
${engine(CX, CY, 24.4, 1.9, 28, 3, .4, .3)}
<circle cx="32" cy="32" r="20.4" fill="none" stroke="url(#au)" stroke-width=".9" opacity=".7"/>
${glyph(CX, CY, s, "url(#au)")}`); }

/* m8 · orbit — a raised ring crossing the field, planet-like */
{ const gr = 16.8, s = fit(CX, CY, gr);
  add("m8-orbit", `
<circle cx="32" cy="32" r="31" fill="url(#au)"/>
<path d="${reeded(CX, CY, 28.6, 31.4, 84)}" fill="url(#au2)"/>
<circle cx="32" cy="32" r="27.8" fill="url(#field)"/>
<circle cx="32" cy="32" r="27.8" fill="none" stroke="url(#au2)" stroke-width="1.3"/>
${engine(CX, CY, 26, 1.2, 52, 2, .3, .35)}
<g transform="rotate(-24 32 32)"><ellipse cx="32" cy="32" rx="26.2" ry="9.4" fill="none" stroke="url(#au)" stroke-width="1.5" opacity=".9"/></g>
${glyph(CX, CY, s, "url(#au)")}`); }

let bad = 0;
for (const [k, v] of Object.entries(M)) { if (!v.includes(G)) { console.log("ALTERED", k); bad++; } writeFileSync(`/tmp/promo/${k}.svg`, v); }
writeFileSync("/tmp/promo/medallions.json", JSON.stringify(M));
console.log(log.map((k) => `${k.padEnd(14)} ${(M[k].length / 1024).toFixed(0)}KB`).join("\n"));
console.log(`\n${log.length} medallions · ${bad} altered`);
