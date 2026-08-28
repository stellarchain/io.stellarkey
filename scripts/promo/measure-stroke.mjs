/** Measures the glyph's bar thickness by scanning fill runs, so added elements
 *  can match its weight exactly rather than approximate it. */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="480" height="480"><path id="g" d="${G}"/></svg>`);
const runs = await p.evaluate(() => {
  const el = document.getElementById("g"), svg = el.ownerSVGElement;
  const pt = svg.createSVGPoint();
  const out = [];
  // scan vertical lines across the mark, recording how long each filled run is
  for (let x = 2; x <= 22; x += 0.5) {
    let inRun = false, start = 0;
    for (let y = 0; y <= 24; y += 0.02) {
      pt.x = x; pt.y = y;
      const inside = el.isPointInFill(pt);
      if (inside && !inRun) { inRun = true; start = y; }
      else if (!inside && inRun) { inRun = false; out.push(Number((y - start).toFixed(3))); }
    }
  }
  return out;
});
await b.close();
const solid = runs.filter((r) => r > 0.3 && r < 6).sort((a, z) => a - z);
const med = solid[Math.floor(solid.length / 2)];
const mode = (() => { const bins = {};
  for (const r of solid) { const k = Math.round(r * 4) / 4; bins[k] = (bins[k] || 0) + 1; }
  return Object.entries(bins).sort((a, z) => z[1] - a[1])[0]; })();
console.log(`${solid.length} filled runs sampled`);
console.log(`median run   ${med.toFixed(2)} units (of 24)`);
console.log(`most common  ${mode[0]} units  (${mode[1]} hits)`);
console.log(`\n=> in a 64 tile with the glyph at scale s, matching weight = ${(Number(mode[0])).toFixed(2)} x s`);
writeFileSync("/tmp/promo/stroke.json", JSON.stringify({ median: med, mode: Number(mode[0]) }));
