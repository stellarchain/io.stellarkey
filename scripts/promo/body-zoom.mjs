import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const R = JSON.parse(readFileSync("/tmp/promo/body-variants.json", "utf8"));
const inner = (s) => s.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 760 }, deviceScaleFactor: 2 });
await p.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(4,1fr);gap:18px;padding:24px;align-items:center;font-family:system-ui">
${Object.entries(R).map(([k, v]) => `<div style="text-align:center">
  <svg width="180" height="180" viewBox="0 0 64 64" style="color:#fff">${inner(v)}</svg>
  <div style="font:500 11px ui-monospace;color:#888;margin-top:8px">${k}</div></div>`).join("")}
</body>`);
await p.waitForTimeout(300);
await p.screenshot({ path: "/tmp/promo/body-zoom.png" });
await b.close();
