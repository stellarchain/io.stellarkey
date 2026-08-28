import { chromium } from "playwright";
import { open } from "./seed.mjs";
const { ctx, p } = await open(chromium, { viewport: { width: 1728, height: 1080 } });
p.setDefaultTimeout(9000);
const btn = (re) => p.getByRole("button", { name: re }).first();
const list = async (view) => {
  await p.waitForTimeout(2200);
  const items = await p.evaluate(() =>
    [...document.querySelectorAll("main .panel, main .list-group, main .panel-inset, [role=dialog] > div")]
      .filter((e) => e.offsetParent)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { cls: e.className.split(" ").slice(0, 2).join("."), w: Math.round(r.width), h: Math.round(r.height),
                 t: (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 46) };
      })
      .filter((x) => x.w > 120 && x.h > 60));
  console.log(`\n### ${view}`);
  items.forEach((i, n) => console.log(`  [${n}] ${i.w}x${i.h}  ${i.cls}  "${i.t}"`));
};
await p.waitForTimeout(3500); await list("wallet-home");
await btn(/^DEX Swap/).click(); await list("swap");
await btn(/^Activity/).click(); await list("activity");
await btn(/^Settings$/).click(); await list("settings");
await btn(/^Merchant$/).click(); await p.waitForTimeout(1800);
const ch = p.locator('main button:has-text("Choose staff")').first();
if (await ch.count()) {
  await ch.click(); await p.waitForTimeout(1800);
  const av = p.locator("main button:not([aria-haspopup]):visible").filter({ hasText: /Everyday/ }).first();
  if (await av.count()) { await av.click(); await p.waitForTimeout(900);
    await p.locator('[role="dialog"] input').first().fill("2468"); await p.waitForTimeout(400);
    await p.locator('[role="dialog"] button').filter({ hasText: /^Select$/ }).first().click(); await p.waitForTimeout(1600); }
  for (let i=0;i<6 && await p.locator('[role="dialog"]').count();i++){ await p.keyboard.press("Escape"); await p.waitForTimeout(280); }
  await btn(/^Point of Sale$/).click(); await p.waitForTimeout(1500);
}
await list("pos");
await btn(/^Orders/).click(); await list("orders");
await btn(/^Insights$/).click(); await list("insights");
await ctx.close();
