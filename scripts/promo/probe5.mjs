import { chromium } from "playwright";
import { seed, PASSWORD } from "./seed.mjs";
const { vault } = await seed();
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([v]) => {
  localStorage.setItem("stellarkey.vault.v1", v);
  localStorage.setItem("stellarkey.network.v1", "testnet");
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
    .filter(x => x.offsetParent).map(x => (x.getAttribute("aria-label")||x.innerText||"").replace(/\s+/g," ").trim().slice(0,32)).filter(Boolean));
  console.log(`\n### ${label}\nfields: ${f.join(" ;; ")||"(none)"}\nbuttons: ${[...new Set(btn)].join(" | ")}`);
  await p.screenshot({ path: `/tmp/promo/${label}.png` });
};
const has = async (re) => (await p.getByRole("button", { name: re }).count()) > 0;
if (await has(/^Merchant$/)) { await p.getByRole("button", { name: /^Merchant$/ }).first().click(); await p.waitForTimeout(1500); await state("merchant-off"); }
else { await state("no-merchant-tab"); }
await b.close();
