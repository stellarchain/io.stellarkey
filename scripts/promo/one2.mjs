import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const D = JSON.parse(readFileSync("/tmp/promo/dialdoors.json", "utf8"));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 480 }, deviceScaleFactor: 2 });
await p.setContent(`<body style="margin:0;background:#000;display:flex;gap:26px;padding:24px;align-items:center">
${["h1-hinged","h2-framed","h3-strap"].map((k,i)=>`<div style="text-align:center">${D[k].replace("<svg",'<svg width="250" height="250"').replace(/id="/g,`id="q${i}-`).replace(/url\(#/g,`url(#q${i}-`)}<div style="font:500 11px ui-monospace;color:#888;margin-top:6px">${k}</div></div>`).join("")}
</body>`);
await p.waitForTimeout(400);
await p.screenshot({ path: "/tmp/promo/dialdoor-zoom.png" });
await b.close();
