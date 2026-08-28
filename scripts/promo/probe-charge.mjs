import { chromium } from "playwright";
import { open } from "./seed.mjs";
const { ctx, p } = await open(chromium, { viewport: { width: 1728, height: 1080 } });
p.setDefaultTimeout(9000);
const btn = (re) => p.getByRole("button", { name: re }).first();
await btn(/^Merchant$/).click(); await p.waitForTimeout(1800);
const choose = p.locator('main button:has-text("Choose staff")').first();
if (await choose.count()) {
  await choose.click(); await p.waitForTimeout(1600);
  const av = p.locator("main button:not([aria-haspopup]):visible").filter({ hasText: /Everyday/ }).first();
  if (await av.count()) {
    await av.click(); await p.waitForTimeout(900);
    await p.locator('[role="dialog"] input').first().fill("2468"); await p.waitForTimeout(400);
    await p.locator('[role="dialog"] button').filter({ hasText: /^Select$/ }).first().click(); await p.waitForTimeout(1500);
  }
  for (let i=0;i<6 && await p.locator('[role="dialog"]').count();i++){await p.keyboard.press("Escape");await p.waitForTimeout(300);}
  await btn(/^Point of Sale$/).click(); await p.waitForTimeout(1500);
}
console.log("=== ORDERS page ===");
await btn(/^Orders/).click(); await p.waitForTimeout(4000);
console.log("receipt rows:", await p.locator('main button[aria-label^="Open the receipt for order"]').count());
console.log("orders text:", (await p.evaluate(() => (document.querySelector("main")?.innerText||"").replace(/\s+/g," ").slice(0,220))));
console.log("\n=== CHARGE ===");
await btn(/^Point of Sale$/).click(); await p.waitForTimeout(1500);
for (const d of ["4","8","0"]) { await p.getByRole("button", { name: new RegExp(`^${d}$`) }).first().click(); await p.waitForTimeout(180); }
await p.getByRole("button", { name: /^Add to ticket$/ }).first().click(); await p.waitForTimeout(900);
await p.locator("main button:visible").filter({ hasText: /^Charge/ }).first().click(); await p.waitForTimeout(1800);
const noTip = p.locator('[role="dialog"] button').filter({ hasText: /^No tip$/ }).first();
if (await noTip.count()) { await noTip.click(); await p.waitForTimeout(2500); }
await p.waitForTimeout(2500);
console.log("dialog text:", (await p.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText||"(no dialog)").replace(/\s+/g," ").slice(0,400))));
await p.screenshot({ path: "/tmp/promo/charge-now.png" });
await ctx.close();
