import { chromium } from "playwright";
import { seed, PASSWORD } from "./seed.mjs";
const { vault } = await seed();
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([v]) => {
  localStorage.setItem("polaris.vault.v1", v);
  localStorage.setItem("polaris.network.v1", "testnet");
}, [vault]);
const p = await ctx.newPage();
await p.goto("http://localhost:3003", { waitUntil: "domcontentloaded" });
await p.getByPlaceholder(/password/i).first().fill(PASSWORD);
await p.keyboard.press("Enter");
await p.waitForTimeout(5000);
const state = async (label) => {
  const f = await p.evaluate(() => [...document.querySelectorAll("input,select,textarea")]
    .filter(x => x.offsetParent && !/Search assets/.test(x.placeholder||""))
    .map(x => `${x.tagName}[${x.type||""}] ph="${x.placeholder||""}" aria="${x.getAttribute("aria-label")||""}"`));
  const btn = await p.evaluate(() => [...document.querySelectorAll("main button, [role=dialog] button")]
    .filter(x => x.offsetParent).map(x => (x.getAttribute("aria-label")||x.innerText||"").replace(/\s+/g," ").trim().slice(0,40)).filter(Boolean));
  console.log(`\n### ${label}\nfields: ${f.join(" ;; ")||"(none)"}\nbuttons: ${[...new Set(btn)].join(" | ")}`);
  await p.screenshot({ path: `/tmp/promo/${label}.png` });
};
await p.getByRole("button", { name: /^Settings$/ }).first().click(); await p.waitForTimeout(1400);
await state("settings-root");
const m = p.locator("main button").filter({ hasText: "Merchant Mode" }).first();
if (await m.count()) { await m.click(); await p.waitForTimeout(1500); await state("settings-merchant"); }
await b.close();
