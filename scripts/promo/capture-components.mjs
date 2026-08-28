/**
 * Component crops for the landing page.
 * Whole-page shots read as clutter at web sizes; a single panel reads as a
 * product. Captured at 2x, clipped to the element, height-capped where a list
 * would otherwise run for a thousand pixels.
 */
import { chromium } from "playwright";
import { open } from "./seed.mjs";

const OUT = "/tmp/promo/comp";
const { ctx, p } = await open(chromium, { viewport: { width: 1728, height: 1080 }, scale: 2 });
p.setDefaultTimeout(10000);
const btn = (re) => p.getByRole("button", { name: re }).first();
const esc = async () => { for (let i=0;i<8 && await p.locator('[role="dialog"]').count();i++){ await p.keyboard.press("Escape"); await p.waitForTimeout(300);} };

/** Screenshot just this element, padded a little, capped in height. */
async function snap(name, locator, { maxH = 3000, pad = 0 } = {}) {
  const loc = typeof locator === "string" ? p.locator(locator).first() : locator;
  if (!(await loc.count())) { console.log("MISS", name); return; }
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await p.waitForTimeout(500);
  const b = await loc.boundingBox();
  if (!b) { console.log("MISS(box)", name); return; }
  const clip = {
    x: Math.max(0, b.x - pad),
    y: Math.max(0, b.y - pad),
    width: Math.min(b.width + pad * 2, 1728 - Math.max(0, b.x - pad)),
    height: Math.min(b.height + pad * 2, maxH, 1080 - Math.max(0, b.y - pad)),
  };
  await p.screenshot({ path: `${OUT}/${name}.png`, clip });
  console.log(`snap ${name}  ${Math.round(clip.width)}x${Math.round(clip.height)}`);
}

const panel = (n) => p.locator("main .panel").nth(n);

/**
 * Find the tightest block that contains some text and is still card-sized.
 * Several surfaces are laid out without .panel, so class selectors miss them.
 */
async function snapText(name, source, opts = {}) {
  const { minW = 260, minH = 90, maxH = 3000, pad = 0 } = opts;
  const box = await p.evaluate(([src, mw, mh]) => {
    const re = new RegExp(src, "i");
    let best = null;
    for (const el of document.querySelectorAll("main div, main section, [role=dialog] div")) {
      if (!el.offsetParent) continue;
      const t = el.innerText || "";
      if (!re.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < mw || r.height < mh) continue;
      const area = r.width * r.height;
      if (!best || area < best.area) best = { x: r.x, y: r.y, width: r.width, height: r.height, area };
    }
    return best;
  }, [source, minW, minH]);
  if (!box) { console.log("MISS", name); return; }
  const clip = {
    x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
    width: Math.min(box.width + pad * 2, 1728 - Math.max(0, box.x - pad)),
    height: Math.min(box.height + pad * 2, maxH, 1080 - Math.max(0, box.y - pad)),
  };
  await p.screenshot({ path: `${OUT}/${name}.png`, clip });
  console.log(`snap ${name}  ${Math.round(clip.width)}x${Math.round(clip.height)}`);
}
const byText = (sel, re) => p.locator(sel).filter({ hasText: re }).first();

await p.waitForTimeout(4000);
await snap("w-portfolio", panel(0));
await snap("w-market", byText("main .panel", /XLM Market/));
await snap("w-asset", "main .list-group");
await snap("w-recent", byText("main .panel", /Recent Activity/));

await btn(/^Send$/).click(); await p.waitForTimeout(1400);
await p.getByPlaceholder(/^G\.\.\./).first().fill("GC33RABAJCGGTWRMBHBLXXKMAFKCOO3PJEXNCDYTQGRNE73HZO3U76O4");
await p.getByPlaceholder("0.00").first().fill("120");
await p.getByPlaceholder(/Max 28 bytes/).first().fill("Coffee");
await p.waitForTimeout(600);
await snap("w-send", '[role="dialog"] > div', { maxH: 1040 });
await esc();

await btn(/^DEX Swap/).click(); await p.waitForTimeout(1600);
const amt = p.locator('main input[inputmode="decimal"]').first();
if (await amt.count()) await amt.fill("250");
await snapText("w-swap", "YOU PAY", { minW: 340, minH: 200, maxH: 560 });

await btn(/^Settings$/).click(); await p.waitForTimeout(1800);
await snapText("w-security", "Security Health", { minW: 340, minH: 160, maxH: 560 });
await snap("w-multisig", byText("main .list-group", /Multi-Sig Studio/));

// ── merchant ──────────────────────────────────────────────
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

await snap("m-keypad", panel(0));
// An amount that already has an awaiting charge triggers the duplicate sheet
// instead of the tip prompt, so pick one today has not seen.
for (const d of ["7","3","0"]) { await btn(new RegExp(`^${d}$`)).click(); await p.waitForTimeout(150); }
await btn(/^Add to ticket$/).click(); await p.waitForTimeout(1000);
await snap("m-ticket", byText("main .panel", /Ticket/));

await p.locator("main button:visible").filter({ hasText: /^Charge/ }).first().click(); await p.waitForTimeout(1600);
// If the till still warns about a duplicate, acknowledge it first.
const dup = p.locator('[role="dialog"] button').filter({ hasText: /anyway|Ring it up|Continue|Charge again/i }).first();
if (await dup.count()) { await dup.click(); await p.waitForTimeout(1500); }
const pre = p.locator('[role="dialog"] button').filter({ hasText: /^[\d.,]+\s/ });
await snap("m-tip", '[role="dialog"] > div', { maxH: 620 });
void pre;
await p.locator('[role="dialog"] button').filter({ hasText: /^No tip$/ }).first().click().catch(() => {});
// The charge sheet replaces the tip sheet; wait for the memo block rather than
// a fixed delay, or the tip sheet gets captured twice.
for (let i = 0; i < 25; i++) {
  await p.waitForTimeout(500);
  const ready = await p.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return !!d && /MEMO/i.test(d.innerText);
  });
  if (ready) break;
}
await p.waitForTimeout(1200);
await snap("m-charge", '[role="dialog"] > div', { maxH: 1040 });
// A live charge deliberately ignores Escape, so it is left running instead.
await p.locator('[role="dialog"] button').filter({ hasText: /^Leave it running$/ }).first().click().catch(() => {});
await p.waitForTimeout(1200);
await esc();
await p.waitForTimeout(600);

await btn(/^Catalogue$/).click(); await p.waitForTimeout(2000);
await snapText("m-catalogue", "Bakery|Coffee", { minW: 400, minH: 200, maxH: 520 });

await btn(/^Orders/).click(); await p.waitForTimeout(3000);
// The mobile sub-nav renders a strip too; at desktop width it is display:none.
await snap("m-strip", "main .panel-inset:visible");
await snap("m-orders", p.locator("main .list-group").last(), { maxH: 430 });
const row = p.locator('main button[aria-label^="Open the receipt for order"]').first();
if (await row.count()) { await row.click(); await p.waitForTimeout(2200); await snap("m-receipt", '[role="dialog"] > div', { maxH: 1040 }); await esc(); }

await btn(/^Insights$/).click(); await p.waitForTimeout(3200);
await snap("m-hours", byText("main .panel", /Takings by hour/));
await snap("m-standout", byText("main .panel", /What stands out/));
await snap("m-tax", byText("main .panel", /Tax and refunds/));
await snap("m-assets", byText("main .panel", /Asset mix/));

await btn(/^Customers$/).click(); await p.waitForTimeout(2400);
await snapText("m-customers", "visits|Lifetime", { minW: 500, minH: 150, maxH: 400 });
await ctx.close();
console.log("done");
