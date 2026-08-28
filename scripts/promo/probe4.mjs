import { chromium } from "playwright";
import { seed, PASSWORD } from "./seed.mjs";
const { vault, merchant } = await seed();
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([v, m]) => {
  localStorage.setItem("stellarkey.vault.v1", v);
  localStorage.setItem("stellarkey.network.v1", "testnet");
  localStorage.setItem("wallet.merchant.v1", m);
}, [vault, merchant]);
const p = await ctx.newPage();
await p.goto("http://localhost:3003", { waitUntil: "domcontentloaded" });
await p.getByPlaceholder(/password/i).first().fill(PASSWORD);
await p.keyboard.press("Enter");
await p.waitForTimeout(5000);
const state = async (label) => {
  const f = await p.evaluate(() => [...document.querySelectorAll('[role="dialog"] input, [role="dialog"] select, [role="dialog"] textarea')]
    .map(x => `${x.tagName}[${x.type||""}] ph="${x.placeholder||""}" aria="${x.getAttribute("aria-label")||""}" val="${x.value||""}"`));
  const btn = await p.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')]
    .map((x,i) => i + ":" + (x.getAttribute("aria-label")||x.innerText||"").replace(/\s+/g," ").trim().slice(0,30)));
  console.log(`\n### ${label}\nfields: ${f.join(" ;; ")||"(none)"}\nbuttons: ${btn.join(" | ")||"(none)"}`);
  await p.screenshot({ path: `/tmp/promo/${label}.png` });
};
await p.getByRole("button", { name: /^Merchant$/ }).first().click(); await p.waitForTimeout(1000);
await p.getByRole("button", { name: /^Choose staff$/ }).first().click(); await p.waitForTimeout(1400);
await p.getByRole("button", { name: /^Add staff$/ }).first().click(); await p.waitForTimeout(1200);
await state("add-staff");
