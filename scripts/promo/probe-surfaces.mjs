import { chromium } from "playwright";
import { open } from "./seed.mjs";
const { ctx, p } = await open(chromium, { viewport: { width: 1728, height: 1080 } });
p.setDefaultTimeout(6000);
const shot = (n) => p.screenshot({ path: `/tmp/promo/s-${n}.png` });
const dlg = async (label) => {
  await p.waitForTimeout(1200);
  const has = await p.locator('[role="dialog"]').count();
  const txt = await p.evaluate(() => {
    const d = document.querySelector('[role="dialog"]') || document.querySelector("main");
    return (d?.innerText || "").replace(/\s+/g, " ").slice(0, 150);
  });
  console.log(`${label.padEnd(18)} dialog=${has}  ${txt}`);
  await shot(label);
};
const click = async (re, scope) => {
  const l = (scope ?? p).getByRole("button", { name: re }).first();
  if (!(await l.count())) { console.log(`${String(re).padEnd(18)} MISS`); return false; }
  await l.click().catch(() => {});
  return true;
};
const esc = async () => {
  for (let i = 0; i < 6 && (await p.locator('[role="dialog"]').count()); i++) {
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  }
};

// wallet surfaces
await p.keyboard.press("Meta+k"); await dlg("palette"); await esc();
if (await click(/^Multi-Send$/)) await dlg("multisend"); await esc();
if (await click(/^\+ Add Asset$/)) await dlg("addasset"); await esc();
if (await click(/^Contacts$/)) await dlg("contacts");
if (await click(/^Settings$/)) await dlg("settings");
for (const [re, name] of [[/Backup & Recovery/, "backup"], [/Hardware Wallets/, "hardware"], [/Multi-Sig Studio/, "multisig"]]) {
  const b = p.locator("main button").filter({ hasText: re }).first();
  if (await b.count()) { await b.click(); await dlg(name); await esc(); await click(/^Settings$/); await p.waitForTimeout(800); }
  else console.log(`${name.padEnd(18)} MISS`);
}
// merchant surfaces
await click(/^Merchant$/); await p.waitForTimeout(1500);
for (const v of ["Catalogue", "Invoices", "Customers", "Insights"]) {
  await click(new RegExp(`^${v}$`)); await dlg(`m-${v.toLowerCase()}`);
}
await click(/^Point of Sale$/); await p.waitForTimeout(1200);
console.log("till:", (await p.evaluate(() => [...document.querySelectorAll("main button")].filter(b=>b.offsetParent).map(b=>(b.innerText||"").replace(/\s+/g," ").trim().slice(0,22)).filter(Boolean))).slice(0,24).join(" | "));
await ctx.close();
