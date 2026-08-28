import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const M = JSON.parse(readFileSync("/tmp/promo/vaultdoors.json", "utf8"));
const inner = (s, i) => s.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")
  .replace(/id="/g, `id="k${i}-`).replace(/url\(#/g, `url(#k${i}-`).replace(/mask="url\(#/g, `mask="url(#`);
const mk = (svg, size, i) => `<svg width="${size}" height="${size}" viewBox="0 0 64 64">${inner(svg, i)}</svg>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1160, height: 1400 }, deviceScaleFactor: 2 });
await p.setContent(`<body style="margin:0;background:#0b0b0d;padding:16px;font-family:system-ui;display:grid;grid-template-columns:1fr 1fr;gap:14px">
  ${Object.entries(M).map(([k, v], i) => `
    <div style="border:1px solid #23232a;border-radius:14px;background:#000;padding:16px 18px">
      <div style="display:flex;align-items:center;gap:18px">
        ${mk(v, 150, i)}
        <div style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;align-items:center;gap:14px">${[64, 40, 28].map((s) => mk(v, s, i)).join("")}</div>
          <div style="display:flex;align-items:center;gap:14px;background:#fff;padding:8px 10px;border-radius:8px">${[40, 24, 16].map((s) => mk(v, s, i)).join("")}</div>
        </div>
      </div>
      <div style="font:600 12.5px/1.4 system-ui;color:#e8e8ec;margin-top:12px">${k}</div>
    </div>`).join("")}
</body>`);
await p.waitForTimeout(600);
await p.screenshot({ path: "/tmp/promo/vaultdoor-sheet.png", fullPage: true });
await b.close();
console.log("ok");
