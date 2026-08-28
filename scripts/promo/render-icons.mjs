/** Regenerates the raster icon assets from the new mark. */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const F = JSON.parse(readFileSync("/tmp/promo/production.json", "utf8"));
const TARGETS = [
  ["sk-icon-blue", 192, "public/icon-192.png"],
  ["sk-icon-blue", 512, "public/icon-512.png"],
  ["sk-icon-blue", 180, "public/apple-touch-icon.png"],
  ["sk-icon-blue", 180, "src/app/apple-icon.png"],
  ["sk-icon-maskable", 512, "public/icon-maskable-512.png"],
];
const b = await chromium.launch();
for (const [key, size, out] of TARGETS) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<body style="margin:0">${F[key].replace("<svg", `<svg width="${size}" height="${size}"`)}</body>`);
  await p.waitForTimeout(120);
  await p.screenshot({ path: out, omitBackground: false });
  await p.close();
  console.log(`${out.padEnd(34)} ${size}px`);
}
await b.close();
