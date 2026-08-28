import { chromium } from "playwright";
import { open } from "./seed.mjs";
const { ctx, p } = await open(chromium);
await p.waitForTimeout(1500);
await p.getByRole("button", { name: /^Merchant$/ }).first().click();
await p.waitForTimeout(1500);
for (const v of ["Orders", "Insights", "Customers", "Point of Sale"]) {
  await p.getByRole("button", { name: new RegExp(`^${v}$`) }).first().click();
  await p.waitForTimeout(2200);
  await p.screenshot({ path: `/tmp/promo/state-${v.replace(/\s+/g, "-").toLowerCase()}.png` });
}
await ctx.close();
console.log("peeked");
