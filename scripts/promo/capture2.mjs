import { chromium } from "playwright";
import { open } from "./seed.mjs";
const OUT = "/tmp/promo/shots";
const { ctx, p } = await open(chromium, { viewport: { width: 1728, height: 1080 } });
p.setDefaultTimeout(12000);
const btn = (re) => p.getByRole("button", { name: re }).first();
const shot = async (n) => { await p.waitForTimeout(900); await p.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot", n); };
const esc = async () => { for (let i=0;i<8 && await p.locator('[role="dialog"]').count();i++){ await p.keyboard.press("Escape"); await p.waitForTimeout(300);} };

await p.waitForTimeout(3500);
await btn(/^Merchant$/).click(); await p.waitForTimeout(2200);
const choose = p.locator('main button:has-text("Choose staff")').first();
if (await choose.count()) {
  await choose.click(); await p.waitForTimeout(2000);
  const av = p.locator("main button:not([aria-haspopup]):visible").filter({ hasText: /Everyday/ }).first();
  if (await av.count()) {
    await av.click(); await p.waitForTimeout(1000);
    await p.locator('[role="dialog"] input').first().fill("2468"); await p.waitForTimeout(500);
    await p.locator('[role="dialog"] button').filter({ hasText: /^Select$/ }).first().click();
    await p.waitForTimeout(1800);
  }
  await esc();
}
// orders / receipt / insights / customers first — they need no ticket
await btn(/^Orders/).click(); await p.waitForTimeout(3500); await shot("till-orders");
const row = p.locator('main button[aria-label^="Open the receipt for order"]').first();
if (await row.count()) { await row.click(); await p.waitForTimeout(2200); await shot("till-receipt"); await esc(); }
await btn(/^Insights$/).click(); await p.waitForTimeout(3200); await shot("till-insights");
await btn(/^Customers$/).click(); await p.waitForTimeout(2600); await shot("till-customers");

// then a live charge sheet
await btn(/^Point of Sale$/).click(); await p.waitForTimeout(2000);
for (const d of ["4","8","0"]) { await btn(new RegExp(`^${d}$`)).click(); await p.waitForTimeout(180); }
await btn(/^Add to ticket$/).click(); await p.waitForTimeout(1200);
const charge = p.locator("main button:visible").filter({ hasText: /^Charge/ }).first();
console.log("charge enabled:", await charge.isEnabled().catch(() => "?"));
await charge.click({ timeout: 8000 }).catch((e) => console.log("charge click:", String(e).split("\n")[0]));
await p.waitForTimeout(2000);
const pre = p.locator('[role="dialog"] button').filter({ hasText: /^[\d.,]+\s/ });
if (await pre.count()) { await pre.nth(1).click().catch(()=>{}); await p.waitForTimeout(3000); }
else { const nt = p.locator('[role="dialog"] button').filter({ hasText: /^No tip$/ }).first(); if (await nt.count()) { await nt.click(); await p.waitForTimeout(3000); } }
await p.waitForTimeout(2500);
await shot("till-charge");
await ctx.close();
console.log("done");
