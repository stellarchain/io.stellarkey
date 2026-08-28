import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const { concepts } = JSON.parse(readFileSync("/tmp/promo/lockups-prepped.json", "utf8"));
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1260, height: 1000 }, deviceScaleFactor: 2 });
const cell = (c) => `
  <div style="border:1px solid #1c1c20;border-radius:10px;background:#0d0d10;padding:12px 10px">
    <div style="display:flex;align-items:center;justify-content:center;gap:14px;height:110px">
      <svg width="96" height="96" viewBox="0 0 64 64">${c.colour}</svg>
      <div style="display:flex;flex-direction:column;gap:9px;align-items:center">
        <svg width="32" height="32" viewBox="0 0 64 64">${c.colour}</svg>
        <svg width="20" height="20" viewBox="0 0 64 64">${c.colour}</svg>
        <svg width="16" height="16" viewBox="0 0 64 64">${c.colour}</svg>
      </div>
    </div>
    <div style="font:600 12px/1.3 system-ui;color:#e8e8ec;text-align:center;margin-top:6px">${c.name}</div>
    <div style="font:400 9px/1.3 ui-monospace;color:${c.keep ? "#4FC98D" : "#6a6a72"};letter-spacing:.07em;text-align:center;margin-top:3px">${c.direction}${c.keep ? " · KEEP" : ""}</div>
  </div>`;
let n = 0;
for (const group of [concepts.slice(0, 10), concepts.slice(10)]) {
  await page.setContent(`<body style="margin:0;background:#000;padding:14px">
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px">${group.map(cell).join("")}</div></body>`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `/tmp/promo/logos/LOCK-${++n}.png`, fullPage: true });
}
await b.close();
console.log("sheets", n);
