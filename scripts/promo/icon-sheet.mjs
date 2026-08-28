import { chromium } from "playwright";
const { ICONS } = await import(process.argv[2] + "/icons.js");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 260 }, deviceScaleFactor: 2 });
await p.setContent(`<body style="margin:0;background:#000;padding:22px;display:flex;flex-wrap:wrap;gap:20px;color:#FDDA24">
${Object.entries(ICONS).map(([k, v]) => `<div style="text-align:center;width:64px">
  <div style="display:grid;place-items:center;height:34px">${v.replace('class="ico"', 'width="26" height="26"')}</div>
  <div style="font:400 8.5px ui-monospace;color:#666;margin-top:5px">${k}</div></div>`).join("")}
</body>`);
await p.waitForTimeout(250);
// anything that failed to draw has no rendered box
const empty = await p.evaluate(() => [...document.querySelectorAll("svg")]
  .map((s, i) => [i, s.getBBox ? 1 : 0]).filter(([, ok]) => !ok).length);
await p.screenshot({ path: "/tmp/promo/icons.png", fullPage: true });
await b.close();
console.log("rendered", Object.keys(ICONS).length, "icons ·", empty, "failed");
