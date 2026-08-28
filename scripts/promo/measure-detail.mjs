/** Optical centre (area centroid), terminal geometry and true bar weight. */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const G = readFileSync("/tmp/promo/stellar-glyph.txt", "utf8").trim();
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="720" height="720"><path id="g" d="${G}"/></svg>`);
const m = await p.evaluate(() => {
  const el = document.getElementById("g"), svg = el.ownerSVGElement, pt = svg.createSVGPoint();
  let n = 0, sx = 0, sy = 0, minY = 99, maxY = -99, minX = 99, maxX = -99;
  const step = 0.03;
  for (let x = -1; x <= 25; x += step) for (let y = -1; y <= 25; y += step) {
    pt.x = x; pt.y = y;
    if (!el.isPointInFill(pt)) continue;
    n++; sx += x; sy += y;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
  }
  // horizontal extent of fill at a few heights, to see how the mass sits
  const widthAt = [];
  for (const y of [4, 8, 12, 16, 20]) {
    let lo = null, hi = null;
    for (let x = -1; x <= 25; x += step) { pt.x = x; pt.y = y;
      if (el.isPointInFill(pt)) { if (lo === null) lo = x; hi = x; } }
    widthAt.push([y, lo === null ? null : Number((hi - lo).toFixed(2))]);
  }
  const bbox = el.getBBox();
  return { area: n * step * step, cx: sx / n, cy: sy / n, minX, maxX, minY, maxY, widthAt,
           bbox: { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height } };
});
await b.close();
const bbcx = m.bbox.x + m.bbox.w / 2, bbcy = m.bbox.y + m.bbox.h / 2;
console.log(`bbox centre     (${bbcx.toFixed(3)}, ${bbcy.toFixed(3)})`);
console.log(`optical centre  (${m.cx.toFixed(3)}, ${m.cy.toFixed(3)})   <- area centroid`);
console.log(`offset          (${(m.cx - bbcx).toFixed(3)}, ${(m.cy - bbcy).toFixed(3)}) units`);
console.log(`ink coverage    ${(m.area / (m.bbox.w * m.bbox.h) * 100).toFixed(1)} % of its bbox`);
console.log(`\nfill width by height:`);
for (const [y, w] of m.widthAt) console.log(`  y=${String(y).padStart(2)}  ${w === null ? "-" : w.toFixed(2)}`);
writeFileSync("/tmp/promo/detail.json", JSON.stringify(m));
