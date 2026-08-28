/**
 * Retina screenshots of the real app for the landing page.
 * Same profile as the film, so the figures on screen are genuine testnet state.
 */
import { chromium } from "playwright";
import { open } from "./seed.mjs";

const OUT = "/tmp/promo/shots";
const { ctx, p } = await open(chromium, { viewport: { width: 1728, height: 1080 } });
p.setDefaultTimeout(9000);
const btn = (re) => p.getByRole("button", { name: re }).first();
const shot = async (name) => { await p.waitForTimeout(900); await p.screenshot({ path: `${OUT}/${name}.png` }); console.log("shot", name); };
const esc = async () => { for (let i=0;i<8 && await p.locator('[role="dialog"]').count();i++){ await p.keyboard.press("Escape"); await p.waitForTimeout(280);} };

await p.waitForTimeout(4000);
await shot("wallet-home");

await btn(/^Send$/).click(); await p.waitForTimeout(1200);
await p.getByPlaceholder(/^G\.\.\./).first().fill("GC33RABAJCGGTWRMBHBLXXKMAFKCOO3PJEXNCDYTQGRNE73HZO3U76O4");
await p.getByPlaceholder("0.00").first().fill("120");
await p.getByPlaceholder(/Max 28 bytes/).first().fill("Coffee");
await shot("wallet-send"); await esc();

await btn(/^DEX Swap/).click(); await p.waitForTimeout(1500);
const amt = p.locator('main input[inputmode="decimal"]').first();
if (await amt.count()) await amt.fill("250");
await shot("wallet-swap");

await btn(/^Activity/).click(); await p.waitForTimeout(2200); await shot("wallet-activity");
await btn(/^Settings$/).click(); await p.waitForTimeout(2000); await shot("wallet-security");

// merchant, with the till actually open
await btn(/^Merchant$/).click(); await p.waitForTimeout(2000);
const choose = p.locator('main button:has-text("Choose staff")').first();
if (await choose.count()) {
  await choose.click(); await p.waitForTimeout(1800);
  const av = p.locator("main button:not([aria-haspopup]):visible").filter({ hasText: /Everyday/ }).first();
  if (await av.count()) {
    await av.click(); await p.waitForTimeout(900);
    await p.locator('[role="dialog"] input').first().fill("2468"); await p.waitForTimeout(400);
    await p.locator('[role="dialog"] button').filter({ hasText: /^Select$/ }).first().click();
    await p.waitForTimeout(1600);
  }
  await esc();
  await btn(/^Point of Sale$/).click(); await p.waitForTimeout(1600);
}

await btn(/^Catalogue$/).click(); await p.waitForTimeout(1800); await shot("till-catalogue");
await btn(/^Point of Sale$/).click(); await p.waitForTimeout(1500);
for (const d of ["4","8","0"]) { await btn(new RegExp(`^${d}$`)).click(); await p.waitForTimeout(160); }
await btn(/^Add to ticket$/).click(); await p.waitForTimeout(900);
await shot("till-keypad");

await p.locator("main button:visible").filter({ hasText: /^Charge/ }).first().click(); await p.waitForTimeout(1600);
const noTip = p.locator('[role="dialog"] button').filter({ hasText: /^No tip$/ }).first();
if (await noTip.count()) { await shot("till-tip"); const pre = p.locator('[role="dialog"] button').filter({ hasText: /^[\d.,]+\s/ }); await (await pre.count() ? pre.nth(1) : noTip).click(); await p.waitForTimeout(2600); }
await p.waitForTimeout(2200);
await shot("till-charge");
await esc();

await btn(/^Orders/).click(); await p.waitForTimeout(3000); await shot("till-orders");
const row = p.locator('main button[aria-label^="Open the receipt for order"]').first();
if (await row.count()) { await row.click(); await p.waitForTimeout(1800); await shot("till-receipt"); await esc(); }
await btn(/^Insights$/).click(); await p.waitForTimeout(2600); await shot("till-insights");
await btn(/^Customers$/).click(); await p.waitForTimeout(2200); await shot("till-customers");
await ctx.close();
console.log("done");
