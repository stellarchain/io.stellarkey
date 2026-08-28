import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const F = JSON.parse(readFileSync("/tmp/promo/production.json", "utf8"));
const inner = (s, i) => s.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/id="/g, `id="p${i}-`).replace(/url\(#/g, `url(#p${i}-`);
const mk = (k, size, i, color) => `<svg width="${size}" height="${size}" viewBox="0 0 64 64" style="color:${color};border-radius:${/icon/.test(k) ? size * 0.225 : 0}px">${inner(F[k], i)}</svg>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 620 }, deviceScaleFactor: 2 });
await p.setContent(`<body style="margin:0;background:#0b0b0d;padding:22px;font-family:system-ui;display:grid;gap:16px">
  <div style="background:#000;border:1px solid #26262e;border-radius:14px;padding:18px 22px">
    <div style="font:500 10px/1 ui-monospace;letter-spacing:.16em;text-transform:uppercase;color:#777;margin-bottom:14px">mark · currentColor · on dark</div>
    <div style="display:flex;align-items:center;gap:26px">${[96, 48, 32, 24, 20, 16].map((s) => mk("sk-mark", s, 0, "#fff")).join("")}</div>
  </div>
  <div style="background:#fff;border-radius:14px;padding:18px 22px">
    <div style="font:500 10px/1 ui-monospace;letter-spacing:.16em;text-transform:uppercase;color:#888;margin-bottom:14px">mark · on light</div>
    <div style="display:flex;align-items:center;gap:26px">
      ${[64, 32, 20, 16].map((s) => mk("sk-mark", s, 1, "#0B0B0E")).join("")}
      ${[64, 32, 20].map((s) => mk("sk-mark", s, 2, "#0A84FF")).join("")}
    </div>
  </div>
  <div style="background:#1b1b20;border-radius:14px;padding:18px 22px">
    <div style="font:500 10px/1 ui-monospace;letter-spacing:.16em;text-transform:uppercase;color:#888;margin-bottom:14px">app icons · home screen sizes</div>
    <div style="display:flex;align-items:center;gap:22px">
      ${["sk-icon-blue", "sk-icon-ink", "sk-icon-gold"].flatMap((k, i) => [96, 60, 40].map((s) => mk(k, s, 10 + i, "#fff"))).join("")}
      <div style="width:1px;height:70px;background:#333"></div>
      ${[96, 60].map((s) => `<div style="width:${s}px;height:${s}px;border-radius:50%;overflow:hidden">${mk("sk-icon-maskable", s, 20, "#fff")}</div>`).join("")}
    </div>
    <div style="font:400 10px ui-monospace;color:#666;margin-top:10px">blue · ink · gold &nbsp;|&nbsp; maskable, cropped to Android's circle</div>
  </div>
</body>`);
await p.waitForTimeout(300);
await p.screenshot({ path: "/tmp/promo/icon-proof.png", fullPage: true });
await b.close();
