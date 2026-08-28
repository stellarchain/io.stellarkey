import { chromium } from "playwright";
import { open } from "./seed.mjs";
const { ctx, p } = await open(chromium, { viewport: { width: 1728, height: 1080 } });
p.setDefaultTimeout(6000);
console.log("all buttons:", (await p.evaluate(() => [...document.querySelectorAll("button")]
  .filter(b => b.offsetParent).map(b => (b.innerText||b.getAttribute("aria-label")||"").replace(/\s+/g," ").trim().slice(0,22)).filter(Boolean))).join(" | "));
await p.screenshot({ path: "/tmp/promo/labels-boot.png" });
await ctx.close();
