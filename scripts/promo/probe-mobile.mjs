import { chromium } from "playwright";
import { open } from "./seed.mjs";
const { ctx, p } = await open(chromium, { viewport: { width: 402, height: 874 } });
p.setDefaultTimeout(6000);
await p.waitForTimeout(2000);
const dump = async (n) => {
  await p.waitForTimeout(1200);
  console.log(`\n### ${n}`);
  console.log((await p.evaluate(() => [...document.querySelectorAll("button")]
    .filter(b => b.offsetParent)
    .map(b => `${(b.innerText||"").replace(/\s+/g," ").trim().slice(0,22)}|${b.getAttribute("aria-label")||""}`)
    .filter(x => x !== "|"))).join(" · "));
  await p.screenshot({ path: `/tmp/promo/mob-${n}.png`, fullPage: false });
};
await p.getByRole("button", { name: /^Merchant$/ }).first().click();
await dump("merchant");
const choose = p.locator('main button:has-text("Choose staff")').first();
if (await choose.count()) {
  await choose.click();
  await p.waitForTimeout(1500);
  const avatar = p.locator("main button:not([aria-haspopup]):visible").filter({ hasText: /Everyday/ }).first();
  if (await avatar.count()) {
    await avatar.click(); await p.waitForTimeout(900);
    await p.locator('[role="dialog"] input').first().fill("2468");
    await p.waitForTimeout(400);
    await p.locator('[role="dialog"] button').filter({ hasText: /^Select$/ }).first().click();
    await p.waitForTimeout(1400);
  }
  for (let i=0;i<6 && await p.locator('[role="dialog"]').count();i++){await p.keyboard.press("Escape");await p.waitForTimeout(250);}
  await p.getByRole("button", { name: /^Merchant$/ }).first().click();
  await p.waitForTimeout(1600);
}
for (const d of ["3","6","0"]) { await p.getByRole("button", { name: new RegExp(`^${d}$`) }).first().click(); await p.waitForTimeout(150); }
await p.getByRole("button", { name: /^Add to ticket$/ }).first().click();
await p.waitForTimeout(1200);
await dump("ticket");
const charge = p.locator("main button").filter({ hasText: /^Charge / });
console.log("charge count:", await charge.count());
for (let i = 0; i < await charge.count(); i++) {
  console.log(`  [${i}] visible=${await charge.nth(i).isVisible().catch(()=>false)} text="${(await charge.nth(i).innerText().catch(()=>""))?.replace(/\s+/g," ")}"`);
}
await ctx.close();
