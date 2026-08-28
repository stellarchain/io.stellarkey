import { chromium } from "playwright";
import { open } from "./seed.mjs";
const { ctx, p } = await open(chromium);
await p.waitForTimeout(1200);
await p.getByRole("button", { name: /^Send$/ }).first().click();
await p.waitForTimeout(1500);
console.log("fields:", (await p.evaluate(() => [...document.querySelectorAll('[role="dialog"] input,[role="dialog"] textarea')]
  .filter(x=>x.offsetParent).map(x=>`${x.tagName}[${x.type}] aria="${x.getAttribute("aria-label")||""}" ph="${x.placeholder||""}"`))).join("\n        "));
console.log("buttons:", (await p.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')]
  .filter(x=>x.offsetParent).map(x=>(x.innerText||x.getAttribute("aria-label")||"").replace(/\s+/g," ").trim().slice(0,26)).filter(Boolean))).join(" | "));
await p.screenshot({ path: "/tmp/promo/send.png" });
await ctx.close();
