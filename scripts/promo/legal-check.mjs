import { chromium } from "playwright";
const SP = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await p.goto(`file://${SP}/stellarkey-legal.html`, { waitUntil: "networkidle" });
await p.waitForTimeout(400);
for (const k of ["about", "privacy", "terms", "security", "support"]) {
  await p.evaluate((key) => document.querySelector(`[data-go="${key}"]`).click(), k);
  await p.waitForTimeout(220);
  const info = await p.evaluate(() => {
    const d = [...document.querySelectorAll("[data-page]")].find((x) => !x.hidden);
    return { key: d?.dataset.page, h1: d?.querySelector("h1")?.textContent,
             secs: d?.querySelectorAll(".prose section").length, toc: d?.querySelectorAll(".toc a").length,
             words: (d?.querySelector(".prose")?.textContent || "").trim().split(/\s+/).length };
  });
  console.log(`${info.key.padEnd(9)} ${String(info.secs).padStart(2)} sections · ${String(info.toc).padStart(2)} toc · ${String(info.words).padStart(4)} words · "${info.h1}"`);
  if (k === "security") await p.screenshot({ path: "/tmp/promo/legal-security.png" });
  if (k === "about") await p.screenshot({ path: "/tmp/promo/legal-about.png" });
}
const of = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("\nhorizontal overflow:", of, "px · errors:", errs.length ? errs.slice(0, 2) : "none");
await b.close();
