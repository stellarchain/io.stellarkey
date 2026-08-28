/** Rings up a handful of paid sales so "today" has trading in it. */
import { chromium } from "playwright";
import { open, account } from "./seed.mjs";
import { customer, pay } from "./pay.mjs";

const { kp } = await account();
const payer = await customer();
const { ctx, p } = await open(chromium, { viewport: { width: 1728, height: 1080 } });
p.setDefaultTimeout(12000);
const btn = (re) => p.getByRole("button", { name: re }).first();
const esc = async () => { for (let i=0;i<8 && await p.locator('[role="dialog"]').count();i++){ await p.keyboard.press("Escape"); await p.waitForTimeout(300);} };

await p.waitForTimeout(3000);
await btn(/^Merchant$/).click(); await p.waitForTimeout(2000);
const ch = p.locator('main button:has-text("Choose staff")').first();
if (await ch.count()) {
  await ch.click(); await p.waitForTimeout(1800);
  const av = p.locator("main button:not([aria-haspopup]):visible").filter({ hasText: /Everyday/ }).first();
  if (await av.count()) {
    await av.click(); await p.waitForTimeout(900);
    await p.locator('[role="dialog"] input').first().fill("2468"); await p.waitForTimeout(400);
    await p.locator('[role="dialog"] button').filter({ hasText: /^Select$/ }).first().click(); await p.waitForTimeout(1600);
  }
  await esc();
  await btn(/^Point of Sale$/).click(); await p.waitForTimeout(1600);
}
const shift = p.locator("button:visible").filter({ hasText: /^Open shift$/ }).first();
if (await shift.count()) {
  await shift.click(); await p.waitForTimeout(1400);
  const f = p.locator('[role="dialog"] input').first();
  if (await f.count()) await f.fill("50.00");
  await p.locator('[role="dialog"] button').filter({ hasText: /^Open shift$/ }).first().click();
  await p.waitForTimeout(1800);
}

async function sell(digits, tipIndex) {
  await esc();
  for (const d of digits) { await btn(new RegExp(`^${d}$`)).click(); await p.waitForTimeout(150); }
  await btn(/^Add to ticket$/).click(); await p.waitForTimeout(800);
  await p.locator("main button:visible").filter({ hasText: /^Charge/ }).first().click(); await p.waitForTimeout(1500);
  const noTip = p.locator('[role="dialog"] button').filter({ hasText: /^No tip$/ }).first();
  if (await noTip.count()) {
    if (tipIndex === null) await noTip.click();
    else { const pre = p.locator('[role="dialog"] button').filter({ hasText: /^[\d.,]+\s/ });
           const n = await pre.count(); await (n ? pre.nth(Math.min(tipIndex, n-1)) : noTip).click(); }
    await p.waitForTimeout(1800);
  }
  let ask = null;
  for (let i = 0; i < 16; i++) {
    ask = await p.evaluate(() => {
      const d = document.querySelector('[role="dialog"]'); if (!d) return null;
      const t = d.innerText;
      const x = t.match(/([\d.]+)\s*XLM/), m = t.match(/\b(MC[A-Z-]*\d+)\b/);
      return { xlm: x && x[1], memo: m && m[1] };
    });
    if (ask?.xlm && ask?.memo) break;
    await p.waitForTimeout(400);
  }
  if (!ask?.xlm || !ask?.memo) { console.log("  unreadable charge"); return false; }
  const h = await pay({ from: payer, destination: kp.publicKey(), amount: ask.xlm, memo: ask.memo });
  console.log(`  ${ask.memo}  ${ask.xlm} XLM  ${h.slice(0,10)}…`);
  for (let i = 0; i < 34; i++) {
    await p.waitForTimeout(700);
    const done = await p.evaluate(() => { const d = document.querySelector('[role="dialog"]');
      return !!d && /Paid in full|Payment received/i.test(d.innerText); });
    if (done) break;
  }
  await esc();
  return true;
}

for (const [d, t] of [[["3","2","0"],null],[["4","8","0"],1],[["1","2","5","0"],2],[["2","6","0"],null],
                      [["9","4","0"],1],[["5","4","0"],0],[["1","4","9","0"],2],[["6","8","0"],1]]) {
  if (!(await sell(d, t))) break;
}
await ctx.close();
console.log("today populated");
