import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const V = JSON.parse(readFileSync("/tmp/promo/vaults.json", "utf8"));
const inner = (s) => s.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const mk = (svg, size, color) => `<svg width="${size}" height="${size}" viewBox="0 0 64 64" style="color:${color}">${inner(svg)}</svg>`;
const cell = (name, svg) => `
  <div style="border:1px solid #24242a;border-radius:12px;overflow:hidden">
    <div style="background:#000;padding:16px 18px;display:flex;align-items:center;gap:20px">
      ${[104, 48, 32, 24, 16].map((s) => mk(svg, s, "#fff")).join("")}
    </div>
    <div style="background:#fff;padding:12px 18px;display:flex;align-items:center;gap:20px">
      ${[48, 32, 24, 16].map((s) => mk(svg, s, "#000")).join("")}
    </div>
    <div style="background:#FDDA24;padding:12px 18px;display:flex;align-items:center;gap:20px">
      ${[48, 32, 24].map((s) => mk(svg, s, "#000")).join("")}
    </div>
    <div style="background:#0d0d10;padding:10px 18px;font:600 12px/1.3 system-ui;color:#e8e8ec">${name}</div>
  </div>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
await p.setContent(`<body style="margin:0;background:#141416;padding:16px;font-family:system-ui">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
    ${Object.entries(V).map(([k, v]) => cell(k.replace("vault-", "").replace(/^(\w)-/, "$1 · "), v)).join("")}
  </div></body>`);
await p.waitForTimeout(300);
await p.screenshot({ path: "/tmp/promo/vault-sheet.png", fullPage: true });
await b.close();
console.log("ok");
