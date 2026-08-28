import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const { concepts } = JSON.parse(readFileSync("/tmp/promo/logos.json", "utf8"));
const inner = (s) => s.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1240, height: 1000 }, deviceScaleFactor: 2 });
const half = (list, name) => {
  const cells = list.map((c) => `
    <div style="padding:14px 10px;border:1px solid #1c1c20;border-radius:10px;background:#0d0d10">
      <div style="display:flex;align-items:center;justify-content:center;gap:16px;height:104px">
        <svg width="88" height="88" viewBox="0 0 64 64">${inner(c.svg)}</svg>
        <div style="display:flex;flex-direction:column;gap:10px;align-items:center">
          <svg width="32" height="32" viewBox="0 0 64 64">${inner(c.svg)}</svg>
          <svg width="16" height="16" viewBox="0 0 64 64">${inner(c.mono)}</svg>
        </div>
      </div>
      <div style="font:600 12px/1.3 system-ui;color:#e8e8ec;margin-top:8px;text-align:center">${c.name}</div>
      <div style="font:400 9.5px/1.3 ui-monospace;color:${c.keep ? "#4FC98D" : "#6a6a72"};letter-spacing:.08em;text-align:center;margin-top:3px">${c.direction}${c.keep ? " · KEEP" : ""}</div>
    </div>`).join("");
  return { name, html: `<body style="margin:0;background:#000;padding:16px;font-family:system-ui">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">${cells}</div></body>` };
};
let n = 0;
for (const group of [concepts.slice(0, 12), concepts.slice(12)]) {
  const { html } = half(group);
  await page.setContent(html);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `/tmp/promo/logos/SHEET-${++n}.png`, fullPage: true });
}
await b.close();
console.log("sheets:", n);
