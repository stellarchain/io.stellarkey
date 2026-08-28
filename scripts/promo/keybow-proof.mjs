import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const F = JSON.parse(readFileSync("/tmp/promo/keybow-final.json", "utf8"));
const inner = (s) => s.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const mk = (svg, size, color) => `<svg width="${size}" height="${size}" viewBox="0 0 64 64" style="color:${color}">${inner(svg)}</svg>`;
const row = (label, svg, bg, color, sizes = [120, 64, 48, 32, 24, 16]) => `
  <div style="background:${bg};padding:18px 20px;border-radius:12px;border:1px solid rgba(128,128,128,.22)">
    <div style="font:500 10px/1 ui-monospace;letter-spacing:.16em;text-transform:uppercase;color:${color};opacity:.5;margin-bottom:14px">${label}</div>
    <div style="display:flex;align-items:center;gap:24px">${sizes.map((s) => mk(svg, s, color)).join("")}</div>
  </div>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 680, height: 1000 }, deviceScaleFactor: 2 });
await p.setContent(`<body style="margin:0;background:#141416;padding:18px;display:grid;gap:14px;font-family:system-ui">
  ${row("mark · knockout · dark", F["keybow-mark"], "#000", "#fff")}
  ${row("mark · knockout · light", F["keybow-mark"], "#fff", "#000")}
  ${row("mark · on Stellar gold", F["keybow-mark"], "#FDDA24", "#000")}
  ${row("small master · glyph dropped · ≤24px", F["keybow-small"], "#000", "#fff", [48, 32, 24, 20, 16])}
  <div style="display:flex;gap:14px">
    <div style="flex:1;background:#000;padding:18px 20px;border-radius:12px;border:1px solid rgba(128,128,128,.22)">
      <div style="font:500 10px/1 ui-monospace;letter-spacing:.16em;text-transform:uppercase;color:#fff;opacity:.5;margin-bottom:14px">app icon · squircle</div>
      <div style="display:flex;align-items:center;gap:20px">
        ${[96, 60, 40].map((s) => `<div style="width:${s}px;height:${s}px;border-radius:${s * 0.225}px;background:#0A84FF;display:flex;align-items:center;justify-content:center">${mk(F["keybow-mark"], s * 0.66, "#fff")}</div>`).join("")}
        ${[96, 60].map((s) => `<div style="width:${s}px;height:${s}px;border-radius:${s * 0.225}px;background:#000;border:1px solid #222;display:flex;align-items:center;justify-content:center">${mk(F["keybow-mark"], s * 0.66, "#FDDA24")}</div>`).join("")}
      </div>
    </div>
  </div>
</body>`);
await p.waitForTimeout(300);
await p.screenshot({ path: "/tmp/promo/keybow-proof.png", fullPage: true });
await b.close();
console.log("ok");
