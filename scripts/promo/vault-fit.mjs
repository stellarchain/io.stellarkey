/**
 * Samples the glyph's actual outline, then fits each container to it.
 * A bounding box is far too crude here: the mark is a wide diagonal, so its
 * corners are empty air while its swoosh tips are the points that collide.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();

const b = await chromium.launch();
const page = await b.newPage();
await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path id="g" d="${G}"/></svg>`);
const PTS = await page.evaluate(() => {
  const p = document.getElementById("g");
  const L = p.getTotalLength();
  const out = [];
  for (let i = 0; i < 900; i++) { const pt = p.getPointAtLength((i / 900) * L); out.push([pt.x, pt.y]); }
  return out;
});
const bb = await page.evaluate(() => { const r = document.getElementById("g").getBBox(); return [r.x, r.y, r.width, r.height]; });
await b.close();
console.log(`glyph bbox ${bb[2].toFixed(2)}x${bb[3].toFixed(2)} at (${bb[0].toFixed(2)},${bb[1].toFixed(2)}) · ${PTS.length} outline samples`);
writeFileSync("/tmp/promo/glyph-outline.json", JSON.stringify({ pts: PTS, bb }));

/** true when every sampled point clears the arch interior by `m` */
const fits = (s, gx, gy, test, m) => {
  const cx0 = bb[0] + bb[2] / 2, cy0 = bb[1] + bb[3] / 2;
  return PTS.every(([x, y]) => test(gx + (x - cx0) * s, gy + (y - cy0) * s, m));
};
const best = (gx, gy, test, m) => {
  let lo = 0.2, hi = 3.2;
  for (let i = 0; i < 70; i++) { const mid = (lo + hi) / 2; fits(mid, gx, gy, test, m) ? lo = mid : hi = mid; }
  return lo;
};
// arch: circle above cy0, vertical legs below
const arch = (cx, cy0, Ri) => (x, y, m) =>
  y <= cy0 ? Math.hypot(x - cx, y - cy0) <= Ri - m : Math.abs(x - cx) <= Ri - m;
const circle = (cx, cy, Ri) => (x, y, m) => Math.hypot(x - cx, y - cy) <= Ri - m;

const M = 4.5;
const cases = [
  ["tall arch, glyph centred", best(32, 30, arch(32, 30, 24), M), 30],
  ["tall arch, glyph low",     best(32, 40, arch(32, 28, 24), M), 40],
  ["wide arch, glyph centred", best(32, 32, arch(32, 32, 28), M), 32],
  ["round door",               best(32, 32, circle(32, 32, 24), M), 32],
];
for (const [name, s, gy] of cases) console.log(`${name.padEnd(28)} scale ${s.toFixed(3)}  glyph ${(24 * s).toFixed(1)}u  at y=${gy}`);
writeFileSync("/tmp/promo/fits.json", JSON.stringify(Object.fromEntries(cases.map(([n, s, gy]) => [n, { s, gy }]))));
