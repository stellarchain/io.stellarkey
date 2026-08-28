import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const V = JSON.parse(readFileSync("/tmp/promo/vaults.json", "utf8"));
const inner = (s) => s.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 460 }, deviceScaleFactor: 2 });
await p.setContent(`<body style="margin:0;background:#000;display:flex;gap:30px;padding:24px;align-items:center">
  ${["v1-under","v2-tunnel","v6-threshold"].map((k) =>
    `<div style="text-align:center"><svg width="240" height="240" viewBox="0 0 64 64" style="color:#fff">${inner(V[k])}</svg>
     <div style="font:500 11px ui-monospace;color:#888;margin-top:8px">${k}</div></div>`).join("")}
</body>`);
await p.waitForTimeout(200);
await p.screenshot({ path: "/tmp/promo/vault-zoom.png" });
await b.close();
