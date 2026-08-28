/**
 * Detailed vault marks. The geometry is generated rather than hand-drawn —
 * reeded edges, guilloché rosettes and voussoir courses are radial repeats,
 * and doing them by hand is how you get wobble at 60 elements.
 * The official glyph is still placed by translate + uniform scale only.
 */
import { readFileSync, writeFileSync } from "node:fs";
const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();
const { pts: PTS, bb } = JSON.parse(readFileSync("/tmp/promo/glyph-outline.json", "utf8"));
const [bx, by, bw, bh] = bb, CCX = bx + bw / 2, CCY = by + bh / 2;

const P = (n, d = 3) => Number(n.toFixed(d));
const rad = (deg) => (deg * Math.PI) / 180;
const pt = (cx, cy, r, a) => [P(cx + r * Math.cos(a)), P(cy + r * Math.sin(a))];

/** Largest uniform glyph scale whose real outline stays inside `inside`. */
const fit = (gx, gy, inside) => {
  const ok = (s) => PTS.every(([x, y]) => inside(gx + (x - CCX) * s, gy + (y - CCY) * s));
  let lo = 0.1, hi = 3.2;
  for (let i = 0; i < 70; i++) { const m = (lo + hi) / 2; ok(m) ? lo = m : hi = m; }
  return lo;
};
const inCircle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) <= r;
const inArchLegs = (cx, cy0, r) => (x, y) => (y <= cy0 ? Math.hypot(x - cx, y - cy0) <= r : Math.abs(x - cx) <= r);
const glyph = (cx, cy, s, fill) =>
  `<g transform="translate(${P(cx - CCX * s)} ${P(cy - CCY * s)}) scale(${P(s, 4)})"><path d="${G}" fill="${fill}"/></g>`;

/* ---------- generators ---------- */

/** Milled / reeded coin edge: n trapezoid teeth between r0 and r1. */
const reeded = (cx, cy, r0, r1, n, duty = 0.5) => {
  const step = (Math.PI * 2) / n, half = (step * duty) / 2;
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = i * step;
    const [x1, y1] = pt(cx, cy, r0, a - half), [x2, y2] = pt(cx, cy, r1, a - half * 0.62);
    const [x3, y3] = pt(cx, cy, r1, a + half * 0.62), [x4, y4] = pt(cx, cy, r0, a + half);
    d += `M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}L${x4} ${y4}Z`;
  }
  return d;
};

/**
 * Engine turning, as a rhodonea rather than a trochoid. A spirograph with an
 * irrational ratio wanders and reads as tangled wire; a rose curve has an
 * exact lobe count, which is what makes real guilloché look machined.
 */
const guilloche = (cx, cy, R0, amp, lobes, phase = 0, steps = 1400) => {
  let out = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r = R0 + amp * Math.cos(lobes * t + phase);
    out += (i ? "L" : "M") + P(cx + r * Math.cos(t)) + " " + P(cy + r * Math.sin(t));
  }
  return out + "Z";
};
/** A stack of rose curves, each turned slightly against the last. */
const engine = (cx, cy, R0, amp, lobes, rings, stroke, opacity) =>
  Array.from({ length: rings }, (_, i) =>
    `<path d="${guilloche(cx, cy, R0 - i * (amp * 1.15), amp, lobes, (i * Math.PI) / lobes)}" fill="none" stroke="url(#metal)" stroke-width="${stroke}" opacity="${P(opacity - i * 0.045, 2)}"/>`
  ).join("");

/** Voussoirs: wedge stones along an arc, with mortar gaps. */
const voussoirs = (cx, cy, ri, ro, from, to, n, gap = 1.6) => {
  const span = to - from, step = span / n, g2 = rad(gap) / 2;
  let d = "";
  for (let i = 0; i < n; i++) {
    const a0 = from + i * step + g2, a1 = from + (i + 1) * step - g2;
    const [x1, y1] = pt(cx, cy, ri, a0), [x2, y2] = pt(cx, cy, ro, a0);
    const [x3, y3] = pt(cx, cy, ro, a1), [x4, y4] = pt(cx, cy, ri, a1);
    d += `M${x1} ${y1}L${x2} ${y2}A${ro} ${ro} 0 0 1 ${x3} ${y3}L${x4} ${y4}A${ri} ${ri} 0 0 0 ${x1} ${y1}Z`;
  }
  return d;
};

/** Bolt heads evenly spaced on a ring. */
const bolts = (cx, cy, r, n, br, phase = 0) => {
  let d = "";
  for (let i = 0; i < n; i++) {
    const [x, y] = pt(cx, cy, r, phase + (i * Math.PI * 2) / n);
    d += `M${P(x + br)} ${P(y)}a${br} ${br} 0 1 0 ${P(-br * 2)} 0a${br} ${br} 0 1 0 ${P(br * 2)} 0Z`;
  }
  return d;
};

const DEFS = `
<linearGradient id="metal" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#FFE97A"/><stop offset=".42" stop-color="#FDDA24"/>
  <stop offset=".72" stop-color="#C79305"/><stop offset="1" stop-color="#F2CE2A"/></linearGradient>
<linearGradient id="ink" x1="32" y1="0" x2="32" y2="64" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#14161C"/><stop offset="1" stop-color="#04050A"/></linearGradient>
<radialGradient id="face" cx="38%" cy="30%" r="78%">
  <stop offset="0" stop-color="#1F2430"/><stop offset="1" stop-color="#05070C"/></radialGradient>
<linearGradient id="rim" x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#FFF0A8"/><stop offset=".5" stop-color="#E7B71A"/>
  <stop offset="1" stop-color="#9E7104"/></linearGradient>`;

const svg = (inner, defs = DEFS) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${defs}</defs>${inner}</svg>`;
const V = {}, log = [];

/* 1 · VAULT DOOR — reeded rim, bolt ring, spokes, engraved face */
{
  const cx = 32, cy = 32;
  const s = fit(cx, cy, inCircle(cx, cy, 17.5));
  V["d1-vaultdoor"] = svg(`
<circle cx="32" cy="32" r="31" fill="url(#ink)"/>
<path d="${reeded(cx, cy, 26.4, 30.6, 72, .52)}" fill="url(#rim)" opacity=".92"/>
<circle cx="32" cy="32" r="26.6" fill="url(#metal)"/>
<circle cx="32" cy="32" r="23.8" fill="url(#face)"/>
<circle cx="32" cy="32" r="23.8" fill="none" stroke="#7E5C02" stroke-width=".7"/>
<path d="${bolts(cx, cy, 20.6, 12, 1.35)}" fill="url(#rim)" opacity=".95"/>
<g stroke="url(#metal)" stroke-width="1.5" stroke-linecap="round" opacity=".55">
  ${[0, 45, 90, 135].map((a) => { const [x1, y1] = pt(cx, cy, 18.1, rad(a)); const [x2, y2] = pt(cx, cy, 18.1, rad(a + 180)); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }).join("")}
</g>
<circle cx="32" cy="32" r="18.3" fill="url(#face)" stroke="url(#rim)" stroke-width="1.1"/>
${glyph(cx, cy, s, "url(#metal)")}`);
  log.push(["d1-vaultdoor", s]);
}

/* 2 · GUILLOCHÉ SEAL — engine-turned rosette behind a medallion */
{
  const cx = 32, cy = 32;
  const s = fit(cx, cy, inCircle(cx, cy, 13.4));
  const rose = engine(cx, cy, 29.4, 2.3, 44, 5, 0.42, 0.72);
  V["d2-guilloche"] = svg(`
<circle cx="32" cy="32" r="31.4" fill="url(#ink)"/>
<circle cx="32" cy="32" r="31.4" fill="none" stroke="url(#rim)" stroke-width="1.2"/>
${rose}
<circle cx="32" cy="32" r="15.2" fill="url(#face)"/>
<circle cx="32" cy="32" r="15.2" fill="none" stroke="url(#rim)" stroke-width="1.3"/>
<circle cx="32" cy="32" r="16.9" fill="none" stroke="url(#metal)" stroke-width=".5" opacity=".6"/>
${glyph(cx, cy, s, "url(#metal)")}`);
  log.push(["d2-guilloche", s]);
}

/* 3 · VOUSSOIR ARCH — the arch built from cut stones, keystone at the crown */
{
  const cx = 32, cy0 = 30, ri = 17.5, ro = 26;
  const s = fit(cx, 40, inArchLegs(cx, cy0, ri - 3.2));
  V["d3-voussoir"] = svg(`
<rect width="64" height="64" rx="11" fill="url(#ink)"/>
<path d="${voussoirs(cx, cy0, ri, ro, rad(180), rad(360), 9, 2.2)}" fill="url(#metal)"/>
<path d="M${cx - 3.6} ${cy0 - ro}h7.2l1.5 -4.6h-10.2Z" fill="url(#rim)"/>
<rect x="${cx - ro}" y="${cy0}" width="8.5" height="34" fill="url(#metal)"/>
<rect x="${cx + ri}" y="${cy0}" width="8.5" height="34" fill="url(#metal)"/>
<g stroke="#8A6503" stroke-width=".55" opacity=".55">
  ${[8, 17, 26].map((dy) => `<line x1="${cx - ro}" y1="${cy0 + dy}" x2="${cx - ri}" y2="${cy0 + dy}"/><line x1="${cx + ri}" y1="${cy0 + dy}" x2="${cx + ro}" y2="${cy0 + dy}"/>`).join("")}
</g>
${glyph(cx, 40, s, "#FFFFFF")}`);
  log.push(["d3-voussoir", s]);
}

/* 4 · ENFILADE — nested arch courses receding to the mark */
{
  const cx = 32, cy0 = 32;
  const rings = [30, 25.4, 21.2, 17.4];
  const s = fit(cx, 38, inArchLegs(cx, cy0, rings[3] - 3.4));
  V["d4-enfilade"] = svg(`
<rect width="64" height="64" rx="11" fill="url(#ink)"/>
${rings.map((r, i) => `<path d="M${cx - r} 64V${cy0}a${r} ${r} 0 0 1 ${2 * r} 0v32" fill="none" stroke="url(#metal)" stroke-width="${P(2.9 - i * 0.45)}" opacity="${P(1 - i * 0.17)}"/>`).join("")}
<g fill="url(#rim)" opacity=".85">${[200, 230, 260, 290, 320].map((a) => { const [x, y] = pt(cx, cy0, 27.7, rad(a)); return `<circle cx="${x}" cy="${y}" r="1.05"/>`; }).join("")}</g>
${glyph(cx, 38, s, "url(#metal)")}`);
  log.push(["d4-enfilade", s]);
}

/* 5 · MEDALLION — struck coin: raised rim, reeded edge, engraved field */
{
  const cx = 32, cy = 32;
  const s = fit(cx, cy, inCircle(cx, cy, 18.6));
  V["d5-medallion"] = svg(`
<circle cx="32" cy="32" r="31" fill="url(#metal)"/>
<path d="${reeded(cx, cy, 28.2, 31.4, 88, .5)}" fill="url(#rim)"/>
<circle cx="32" cy="32" r="27.4" fill="none" stroke="#8A6503" stroke-width=".8" opacity=".7"/>
<circle cx="32" cy="32" r="24.6" fill="url(#face)"/>
<circle cx="32" cy="32" r="24.6" fill="none" stroke="url(#rim)" stroke-width="1.4"/>
${engine(cx, cy, 22.6, 1.7, 36, 4, 0.35, 0.42)}
${glyph(cx, cy, s, "url(#metal)")}`);
  log.push(["d5-medallion", s]);
}

let bad = 0;
for (const [k, v] of Object.entries(V)) {
  if (!v.includes(G)) { console.log("ALTERED", k); bad++; }
  writeFileSync(`/tmp/promo/${k}.svg`, v);
}
writeFileSync("/tmp/promo/vaults-detailed.json", JSON.stringify(V));
console.log(log.map(([k, s]) => `${k.padEnd(16)} glyph ${(24 * s).toFixed(1)}u  (${(v => v.length)(V[k]) / 1024 | 0}KB)`).join("\n"));
console.log(`\n${Object.keys(V).length} detailed marks · ${bad} altered`);
