import { chromium } from "playwright";
import { open } from "./seed.mjs";
const { ctx, p } = await open(chromium, { viewport: { width: 1728, height: 1080 } });
p.setDefaultTimeout(6000);
await p.getByRole("button", { name: /^Merchant$/ }).first().click(); await p.waitForTimeout(1500);
await p.getByRole("button", { name: /^Orders/ }).first().click(); await p.waitForTimeout(4000);
console.log("clickables:", (await p.evaluate(() => [...document.querySelectorAll("main button, main [role=button], main a, main li")]
  .filter(b => b.offsetParent).slice(0, 14).map(b => `${b.tagName}[${b.getAttribute("aria-label")||""}]."${(b.textContent||"").replace(/\s+/g," ").trim().slice(0,34)}"`))).join(" | "));
const row = p.locator("main button:visible").filter({ hasText: /\d{4}/ }).first();
console.log("row count:", await p.locator("main button:visible").filter({ hasText: /\d{4}/ }).count());
if (await row.count()) {
  await row.click(); await p.waitForTimeout(1600);
  console.log("dialog buttons:", (await p.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')]
    .filter(b=>b.offsetParent).map(b=>(b.innerText||b.getAttribute("aria-label")||"").replace(/\s+/g," ").trim().slice(0,24)).filter(Boolean))).join(" | "));
  await p.screenshot({ path: "/tmp/promo/order-detail.png" });
}
await ctx.close();
