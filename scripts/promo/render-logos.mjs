/** Renders every logo concept at real sizes so it can be judged by eye. */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const { concepts } = JSON.parse(readFileSync("/tmp/promo/logos.json", "utf8"));
mkdirSync("/tmp/promo/logos", { recursive: true });
const inner = (svg) => svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 300 }, deviceScaleFactor: 2 });

for (const c of concepts) {
  const sizes = [16, 24, 32, 64, 132];
  const rowColour = sizes.map((s) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64">${inner(c.svg)}</svg>`).join("");
  const rowMono = sizes.map((s) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64">${inner(c.mono)}</svg>`).join("");
  const html = `<body style="margin:0;font-family:system-ui;background:#0b0b0d;color:#eee">
    <div style="display:flex">
      <div style="flex:1;padding:18px 22px">
        <div style="font:500 11px/1 ui-monospace;letter-spacing:.14em;text-transform:uppercase;color:#777;margin-bottom:14px">colour · on black</div>
        <div style="display:flex;align-items:center;gap:22px;min-height:140px">${rowColour}</div>
      </div>
      <div style="flex:1;padding:18px 22px;background:#0b0b0d">
        <div style="font:500 11px/1 ui-monospace;letter-spacing:.14em;text-transform:uppercase;color:#777;margin-bottom:14px">stencil · white</div>
        <div style="display:flex;align-items:center;gap:22px;min-height:140px">${rowMono}</div>
      </div>
      <div style="flex:0 0 200px;padding:18px 22px;background:#f2f2f4">
        <div style="font:500 11px/1 ui-monospace;letter-spacing:.14em;text-transform:uppercase;color:#888;margin-bottom:14px">on light</div>
        <div style="display:flex;align-items:center;gap:16px;min-height:140px">
          <svg width="32" height="32" viewBox="0 0 64 64">${inner(c.svg)}</svg>
          <svg width="96" height="96" viewBox="0 0 64 64">${inner(c.svg)}</svg>
        </div>
      </div>
    </div></body>`;
  await page.setContent(html);
  await page.waitForTimeout(120);
  // slugs are not unique across directions, so the file name carries both
  await page.screenshot({ path: `/tmp/promo/logos/${c.direction}__${c.slug}.png` });
}
await b.close();
writeFileSync("/tmp/promo/logos/index.txt", concepts.map((c) => `${c.direction}__${c.slug}\t${c.keep ? "KEEP" : "cut"}\t${c.name}`).join("\n"));
console.log(`rendered ${concepts.length}`);
