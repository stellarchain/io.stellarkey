/**
 * Simple medallions. Flat, one fill, currentColor, glyph knocked out.
 * Edge detail is budgeted rather than decorative: a 30-unit rim is 188 units
 * round, and a notch cycle needs ~3px to read, so 16px allows about 15 notches.
 * Everything here stays at or under that, which is why it survives small where
 * the 88-reed versions did not.
 */
import { readFileSync, writeFileSync } from "node:fs";
const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();
const { pts: PTS, bb } = JSON.parse(readFileSync("/tmp/promo/glyph-outline.json", "utf8"));
const [bx, by, bw, bh] = bb, CCX = bx + bw / 2, CCY = by + bh / 2;
const P = (n, d = 2) => Number(n.toFixed(d));
const TAU = Math.PI * 2, CX = 32, CY = 32;
const at = (r, a, cx = CX, cy = CY) => [P(cx + r * Math.cos(a)), P(cy + r * Math.sin(a))];

const fitCircle = (R) => { const ok = (s) => PTS.every(([x, y]) => Math.hypot((x - CCX) * s, (y - CCY) * s) <= R);
  let lo = .1, hi = 4; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; ok(m) ? lo = m : hi = m; } return lo; };
const glyph = (s, fill) =>
  `<g transform="translate(${P(CX - CCX * s, 3)} ${P(CY - CCY * s, 3)}) scale(${P(s, 4)})"><path d="${G}" fill="${fill}"/></g>`;
const svg = (i) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${i}</svg>`;
/** disc, minus `cuts`, minus the glyph — all one flat fill */
const coin = (id, disc, cuts, s) => svg(
`<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
<rect width="64" height="64" fill="#000"/><g fill="#fff">${disc}</g><g fill="#000">${cuts}</g>${glyph(s, "#000")}</mask>
<rect width="64" height="64" fill="currentColor" mask="url(#${id})"/>`);

/** wedge notches cut into the rim */
const notches = (n, rIn, rOut, duty = .42) => { const step = TAU / n, h = (step * duty) / 2; let d = "";
  for (let i = 0; i < n; i++) { const a = i * step - Math.PI / 2;
    const [x1, y1] = at(rIn, a - h), [x2, y2] = at(rOut, a - h), [x3, y3] = at(rOut, a + h), [x4, y4] = at(rIn, a + h);
    d += `M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}L${x4} ${y4}Z`; }
  return `<path d="${d}"/>`; };
/** round bites out of the rim */
const bites = (n, r, br) => `<path d="${Array.from({ length: n }, (_, i) => {
  const [x, y] = at(r, (i * TAU) / n - Math.PI / 2);
  return `M${P(x + br)} ${P(y)}a${br} ${br} 0 1 0 ${P(-2 * br)} 0a${br} ${br} 0 1 0 ${P(2 * br)} 0Z`; }).join("")}"/>`;

const DISC = `<circle cx="32" cy="32" r="31"/>`;
const S = {}, R_GLYPH = 19.4;

/* s1 · milled — 16 chunky teeth, the coin reduced to one signifier */
S["s1-milled"] = coin("s1", DISC, notches(16, 29.4, 33, .5), fitCircle(R_GLYPH));

/* s2 · ring — the same, with an inner rule that separates rim from field */
S["s2-ring"] = svg(`<mask id="s2" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
<rect width="64" height="64" fill="#000"/><g fill="#fff">${DISC}</g>
<g fill="#000">${notches(16, 29.4, 33, .5)}</g>
<circle cx="32" cy="32" r="24.4" fill="none" stroke="#000" stroke-width="1.6"/>
${glyph(fitCircle(R_GLYPH - 1.4), "#000")}</mask>
<rect width="64" height="64" fill="currentColor" mask="url(#s2)"/>`);

/* s3 · beaded — 14 round bites, softer than teeth */
S["s3-beaded"] = coin("s3", DISC, bites(14, 32.9, 2.4), fitCircle(R_GLYPH));

/* s4 · scallop — 12 deep bites; a seal rather than a coin */
S["s4-scallop"] = coin("s4", DISC, bites(12, 33.4, 3.4), fitCircle(R_GLYPH - .6));

/* s5 · core — two flat tones, outer ring and inner field */
S["s5-core"] = svg(`<mask id="s5a" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
<rect width="64" height="64" fill="#000"/><g fill="#fff">${DISC}</g><g fill="#000">${notches(16, 29.4, 33, .5)}</g></mask>
<mask id="s5b" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
<rect width="64" height="64" fill="#000"/><circle cx="32" cy="32" r="23.2" fill="#fff"/>${glyph(fitCircle(18.4), "#000")}</mask>
<rect width="64" height="64" fill="currentColor" mask="url(#s5a)" opacity=".42"/>
<rect width="64" height="64" fill="currentColor" mask="url(#s5b)"/>`);

/* s6 · keyway — a plain disc broken once, where a key would enter */
S["s6-keyway"] = coin("s6", DISC, `<path d="M27 64V56.5a5 5 0 0 1 10 0V64Z"/>`, fitCircle(R_GLYPH + 1.6));

/* s7 · plain — no edge detail at all, the baseline to judge the rest against */
S["s7-plain"] = coin("s7", DISC, "", fitCircle(R_GLYPH + 2));

/* s8 · index — four deeper marks at the quarters, like a dial's cardinal points */
S["s8-index"] = coin("s8", DISC, `${notches(16, 29.6, 33, .5)}${notches(4, 27.4, 33, .34)}`, fitCircle(R_GLYPH - .4));

let bad = 0;
for (const [k, v] of Object.entries(S)) {
  const open = (v.match(/<(?!\/)[a-zA-Z]/g) || []).length, close = (v.match(/<\//g) || []).length + (v.match(/\/>/g) || []).length;
  if (!v.includes(G)) { console.log("GLYPH ALTERED:", k); bad++; }
  if (open !== close) { console.log("UNBALANCED", k); bad++; }
  if (/gradient|stop-color|filter/i.test(v)) { console.log("NOT FLAT:", k); bad++; }
  if (/<g[^>]*>\s*M[\d.-]/.test(v)) { console.log("RAW PATH DATA INSIDE <g>:", k); bad++; }
  writeFileSync(`/tmp/promo/${k}.svg`, v);
}
writeFileSync("/tmp/promo/simple-medallions.json", JSON.stringify(S));
console.log(Object.entries(S).map(([k, v]) => `${k.padEnd(12)} ${(v.length / 1024).toFixed(1)}KB`).join("\n"));
console.log(`\n${Object.keys(S).length} simple medallions · ${bad} problems`);
