import { chromium } from "playwright";
import { open } from "./seed.mjs";
const { ctx, p } = await open(chromium, { viewport: { width: 1728, height: 1080 } });
p.setDefaultTimeout(6000);
const fields = async (label) => {
  await p.waitForTimeout(1000);
  console.log(`\n### ${label}`);
  console.log("fields:", (await p.evaluate(() => [...document.querySelectorAll('[role="dialog"] input,[role="dialog"] textarea,[role="dialog"] select')]
    .filter(x=>x.offsetParent).map(x=>`${x.tagName}[${x.type||""}] aria="${x.getAttribute("aria-label")||""}" ph="${x.placeholder||""}"`))).join("\n        ") || "(none)");
  console.log("buttons:", (await p.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')]
    .filter(x=>x.offsetParent).map(x=>(x.innerText||x.getAttribute("aria-label")||"").replace(/\s+/g," ").trim().slice(0,28)).filter(Boolean))).join(" | "));
  await p.screenshot({ path: `/tmp/promo/f-${label}.png` });
};
// contacts
await p.getByRole("button", { name: /^Contacts$/ }).first().click();
await p.waitForTimeout(1200);
const add = p.locator("main button").filter({ hasText: /Add Your First Contact|Add Contact/ }).first();
if (await add.count()) { await add.click(); await fields("contact"); }
for (let i=0;i<6 && await p.locator('[role="dialog"]').count(); i++) { await p.keyboard.press("Escape"); await p.waitForTimeout(250); }
// invoice
await p.getByRole("button", { name: /^Merchant$/ }).first().click(); await p.waitForTimeout(1400);
await p.getByRole("button", { name: /^Invoices$/ }).first().click(); await p.waitForTimeout(1400);
const plus = p.locator("main button").filter({ hasText: /^\+$|New invoice|Create/ }).first();
if (await plus.count()) { await plus.click(); await fields("invoice"); }
else console.log("\ninvoice + button MISS:", (await p.evaluate(() => [...document.querySelectorAll("main button")].filter(b=>b.offsetParent).map(b=>(b.innerText||b.getAttribute("aria-label")||"").replace(/\s+/g," ").trim().slice(0,20)).filter(Boolean))).join(" | "));
await ctx.close();
