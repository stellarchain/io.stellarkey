import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const V = JSON.parse(readFileSync("/tmp/promo/keybow.json", "utf8"));
const inner = (s) => s.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const mk = (svg, size, color) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 64 64" style="color:${color}">${inner(svg)}</svg>`;
const row = (label, svg, bg, color) => `
  <div style="background:${bg};padding:20px 22px;border-radius:12px;border:1px solid rgba(128,128,128,.25)">
    <div style="font:500 10px/1 ui-monospace;letter-spacing:.16em;text-transform:uppercase;color:${color};opacity:.55;margin-bottom:16px">${label}</div>
    <div style="display:flex;align-items:center;gap:26px">
      ${[128, 64, 48, 32, 24, 16].map((s) => mk(svg, s, color)).join("")}
    </div>
  </div>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 700, height: 900 }, deviceScaleFactor: 2 });
await p.setContent(`<body style="margin:0;background:#141416;padding:20px;display:grid;gap:16px;font-family:system-ui">
  ${row("solid · knockout · on black", V.knockout, "#000", "#fff")}
  ${row("solid · knockout · on white", V.knockout, "#fff", "#000")}
  ${row("two-tone · white on black", V.onBlack, "#000", "#fff")}
  ${row("two-tone · black on white", V.onWhite, "#fff", "#000")}
</body>`);
await p.waitForTimeout(300);
await p.screenshot({ path: "/tmp/promo/keybow-sheet.png", fullPage: true });
await b.close();
console.log("rendered");
