import { chromium } from "playwright";
import { open } from "./seed.mjs";
const { ctx, p } = await open(chromium);
p.setDefaultTimeout(8000);
await p.getByRole("button", { name: /^DEX Swap/ }).first().click();
await p.waitForTimeout(1800);
console.log("inputs:", (await p.evaluate(() => [...document.querySelectorAll("main input")]
  .filter(x => x.offsetParent).map((x,i) => `${i}: ph="${x.placeholder||""}" aria="${x.getAttribute("aria-label")||""}" val="${x.value}" inMode="${x.inputMode||""}"`))).join("\n        "));
// try the 25% button
const q = p.getByRole("button", { name: /^25%$/ }).first();
if (await q.count()) { await q.click(); await p.waitForTimeout(1200); }
console.log("after 25%:", (await p.evaluate(() => {
  const m = document.querySelector("main");
  return m.innerText.replace(/\s+/g," ").slice(0, 180);
})));
await p.screenshot({ path: "/tmp/promo/swap-25.png" });
await ctx.close();
