import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const svg = readFileSync("/tmp/promo/mark-preview.svg", "utf8").replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
const html = `<body style="margin:0;background:#000;display:flex;align-items:center;gap:28px;padding:28px;font-family:system-ui">
  ${[22, 26, 44, 96, 200].map((s) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64">${svg}</svg>`).join("")}
</body>`;
writeFileSync("/tmp/promo/mark.html", html);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 520, height: 260 }, deviceScaleFactor: 2 });
await p.goto("file:///tmp/promo/mark.html");
await p.waitForTimeout(400);
await p.screenshot({ path: "/tmp/promo/mark.png" });
await b.close();
