import { chromium } from "playwright";
import { open } from "./seed.mjs";
const { ctx, p } = await open(chromium, { viewport: { width: 1728, height: 1080 } });
p.setDefaultTimeout(6000);
const btn = (re) => p.getByRole("button", { name: re }).first();
await btn(/^Merchant$/).click(); await p.waitForTimeout(1500);
// unlock operator
const choose = p.locator('main button:has-text("Choose staff")').first();
if (await choose.count()) {
  await choose.click(); await p.waitForTimeout(1400);
  const av = p.locator("main button:not([aria-haspopup]):visible").filter({ hasText: /Everyday/ }).first();
  if (await av.count()) {
    await av.click(); await p.waitForTimeout(800);
    await p.locator('[role="dialog"] input').first().fill("2468"); await p.waitForTimeout(300);
    await p.locator('[role="dialog"] button').filter({ hasText: /^Select$/ }).first().click();
    await p.waitForTimeout(1300);
  }
  for (let i=0;i<6 && await p.locator('[role="dialog"]').count();i++){await p.keyboard.press("Escape");await p.waitForTimeout(250);}
  await btn(/^Point of Sale$/).click(); await p.waitForTimeout(1300);
}
const dump = async (n) => {
  await p.waitForTimeout(1200);
  console.log(`\n### ${n}`);
  console.log((await p.evaluate(() => [...document.querySelectorAll("main button, [role=dialog] button")]
    .filter(b => b.offsetParent).map(b => (b.innerText||b.getAttribute("aria-label")||"").replace(/\s+/g," ").trim().slice(0,26)).filter(Boolean))).join(" | "));
  await p.screenshot({ path: `/tmp/promo/mp-${n}.png` });
};
await dump("pos");
// shift
console.log("\nALL buttons on POS:", (await p.evaluate(() => [...document.querySelectorAll("button")]
  .filter(b => b.offsetParent).map(b => (b.innerText||b.getAttribute("aria-label")||"").replace(/\s+/g," ").trim().slice(0,24)).filter(Boolean))).join(" | "));
const shift = p.locator("button:visible").filter({ hasText: /^Shift/ }).first();
if (await shift.count()) { await shift.click(); await dump("shift"); for(let i=0;i<6 && await p.locator('[role="dialog"]').count();i++){await p.keyboard.press("Escape");await p.waitForTimeout(250);} }
else console.log("SHIFT: not found anywhere");
// counter codes
await btn(/^Invoices$/).click(); await p.waitForTimeout(1400);
const cc = p.locator("main button:visible").filter({ hasText: /^Counter codes$/ }).first();
if (await cc.count()) { await cc.click(); await dump("counter-codes"); }
// order detail + receipt
await btn(/^Orders$/).click(); await p.waitForTimeout(1400);
const row = p.locator("main button:visible").filter({ hasText: /#\d+/ }).first();
if (await row.count()) { await row.click(); await dump("order-detail"); }
await ctx.close();
