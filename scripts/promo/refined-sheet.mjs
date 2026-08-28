import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const F = JSON.parse(readFileSync("/tmp/promo/locks-refined.json", "utf8"));
const inner = (s, i) => s.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")
  .replace(/id="/g, `id="f${i}-`).replace(/url\(#/g, `url(#f${i}-`);
const mk = (svg, size, i, color) => `<svg width="${size}" height="${size}" viewBox="0 0 64 64" style="color:${color}">${inner(svg, i)}</svg>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1180, height: 1180 }, deviceScaleFactor: 2 });
await p.setContent(`<body style="margin:0;background:#111114;padding:16px;font-family:system-ui;display:grid;grid-template-columns:1fr 1fr;gap:14px">
  ${Object.entries(F).map(([k, v], i) => `
    <div style="border:1px solid #26262e;border-radius:14px;overflow:hidden">
      <div style="background:#0A0A0C;padding:16px 18px;display:flex;align-items:center;gap:18px">
        ${[80, 44, 32, 24, 16].map((s) => mk(v, s, i, "#0A84FF")).join("")}
      </div>
      <div style="background:#fff;padding:14px 18px;display:flex;align-items:center;gap:18px">
        ${[44, 32, 24, 16].map((s) => mk(v, s, i, "#0A84FF")).join("")}
        ${[32, 16].map((s) => mk(v, s, i, "#0A0A0C")).join("")}
      </div>
      <div style="background:#0A84FF;padding:14px 18px;display:flex;align-items:center;gap:18px">
        ${[44, 32, 24, 16].map((s) => mk(v, s, i, "#fff")).join("")}
      </div>
      <div style="background:#141418;padding:9px 18px;font:600 12px/1.3 system-ui;color:#e8e8ec">${k}</div>
    </div>`).join("")}
</body>`);
await p.waitForTimeout(400);
await p.screenshot({ path: "/tmp/promo/refined-sheet.png", fullPage: true });
await b.close();
console.log("ok");
