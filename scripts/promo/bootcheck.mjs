import { chromium } from "playwright";
import { account, PASSWORD, PROFILE, BASE } from "./seed.mjs";
const { vault } = await account();
const ctx = await chromium.launchPersistentContext(PROFILE, { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? (await ctx.newPage());
await ctx.addInitScript(([v]) => {
  if (!localStorage.getItem("polaris.vault.v1")) localStorage.setItem("polaris.vault.v1", v);
  localStorage.setItem("polaris.network.v1", "testnet");
}, [vault]);
await p.goto(BASE, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4000);
const pw = p.locator('input[type="password"]').first();
if (await pw.isVisible().catch(() => false)) {
  await pw.fill("promo");
  await p.getByRole("button", { name: /^Unlock Vault$/ }).click();
  await p.waitForTimeout(8000);
}
console.log("url:", p.url());
console.log("has pw field:", await p.locator('input[type="password"]').count());
console.log("buttons:", (await p.evaluate(() => [...document.querySelectorAll("button")].filter(b=>b.offsetParent).map(b=>(b.innerText||b.getAttribute("aria-label")||"").replace(/\s+/g," ").trim().slice(0,26)).filter(Boolean))).slice(0,10).join(" | "));
console.log("body text:", (await p.evaluate(() => document.body.innerText.replace(/\s+/g," ").slice(0, 240))));
await p.screenshot({ path: "/tmp/promo/bootcheck.png" });
await ctx.close();
