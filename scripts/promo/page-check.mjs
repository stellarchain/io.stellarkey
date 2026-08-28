/** Renders the page and checks the interactions actually work. */
import { chromium } from "playwright";
const SP = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
const errs = [];
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(`file://${SP}/stellarkey.html`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);

// the calculator must produce real figures
const calc = await p.evaluate(() => ({
  turnover: document.getElementById("o-turnover")?.textContent,
  verdict: document.getElementById("o-verdict")?.textContent,
  rows: document.getElementById("o-rows")?.children.length,
}));
console.log("calculator:", calc.rows, "rows");
console.log("  ", calc.turnover);
console.log("  ", calc.verdict);

// drag the sliders and confirm it recomputes
await p.evaluate(() => {
  const s = document.getElementById("i-sales"), t = document.getElementById("i-ticket");
  s.value = 150; s.dispatchEvent(new Event("input"));
  t.value = 12; t.dispatchEvent(new Event("input"));
});
await p.waitForTimeout(200);
console.log("after drag:", await p.evaluate(() => document.getElementById("o-verdict").textContent));

// both demos must advance through their steps
for (const key of ["sign", "sale"]) {
  await p.evaluate((k) => document.querySelector(`[data-demo="${k}"]`)?.scrollIntoView({ block: "center" }), key);
  await p.waitForTimeout(500);
  const seen = new Set();
  for (let i = 0; i < 26; i++) {
    seen.add(await p.evaluate((k) => document.querySelector(`[data-demo="${k}"] .step.on`)?.dataset.step, key));
    await p.waitForTimeout(300);
  }
  console.log(`demo ${key}:`, [...seen].filter(Boolean).sort().join(" → ") || "NEVER PLAYED");
}
await p.evaluate(() => window.scrollTo(0, 0));
await p.waitForTimeout(700);
await p.screenshot({ path: "/tmp/promo/v2-hero.png" });
await p.screenshot({ path: "/tmp/promo/v2-full.png", fullPage: true });
// horizontal overflow is a real bug on a page this wide
const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("horizontal overflow:", overflow, "px");
console.log("console errors:", errs.length ? errs.slice(0, 3) : "none");
await b.close();
