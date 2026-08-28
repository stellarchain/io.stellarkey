import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const V = JSON.parse(readFileSync("/tmp/promo/vaults-detailed.json", "utf8"));
const inner = (s) => s.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const mk = (svg, size, i) => `<svg width="${size}" height="${size}" viewBox="0 0 64 64">${inner(svg).replace(/id="/g, `id="s${i}-`).replace(/url\(#/g, `url(#s${i}-`)}</svg>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1120, height: 1200 }, deviceScaleFactor: 2 });
await p.setContent(`<body style="margin:0;background:#0b0b0d;padding:18px;font-family:system-ui;display:grid;gap:16px">
  ${Object.entries(V).map(([k, v], i) => `
    <div style="border:1px solid #23232a;border-radius:14px;background:#000;padding:18px 22px;display:flex;align-items:center;gap:30px">
      ${mk(v, 190, i)}
      <div style="display:flex;align-items:center;gap:22px">${[96, 64, 48, 32, 24, 16].map((s) => mk(v, s, i)).join("")}</div>
      <div style="margin-left:auto;font:600 13px/1.4 system-ui;color:#e8e8ec">${k}</div>
    </div>`).join("")}
</body>`);
await p.waitForTimeout(500);
await p.screenshot({ path: "/tmp/promo/detailed-sheet.png", fullPage: true });
await b.close();
console.log("ok");
