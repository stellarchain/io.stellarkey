import { chromium } from "playwright";
import { seed, PASSWORD } from "./seed.mjs";
const { vault, merchant } = await seed();
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([v, m]) => {
  localStorage.setItem("polaris.vault.v1", v);
  localStorage.setItem("polaris.network.v1", "testnet");
  localStorage.setItem("wallet.merchant.v1", m);
}, [vault, merchant]);
const p = await ctx.newPage();
await p.goto("http://localhost:3003", { waitUntil: "domcontentloaded" });
await p.getByPlaceholder(/password/i).first().fill(PASSWORD);
await p.keyboard.press("Enter");
await p.waitForTimeout(5000);
const shot = async (n) => p.screenshot({ path: `/tmp/promo/${n}.png` });
const fields = async (label) => {
  const f = await p.evaluate(() => [...document.querySelectorAll("input,select,textarea")]
    .filter(x => x.offsetParent).map(x => `${x.tagName}[${x.type||""}] ph="${x.placeholder||""}" aria="${x.getAttribute("aria-label")||""}"`));
  console.log(`\n### ${label} fields\n` + f.join("\n"));
  const btns = await p.evaluate(() => [...document.querySelectorAll("button")]
    .filter(x => x.offsetParent).map(x => (x.getAttribute("aria-label")||x.innerText||"").trim().replace(/\s+/g," ").slice(0,34)).filter(Boolean));
  console.log("buttons: " + [...new Set(btns)].join(" | "));
};
await p.getByRole("button", { name: /^Merchant$/ }).first().click();
await p.waitForTimeout(1200);
await p.getByRole("button", { name: /^Choose staff$/ }).first().click();
await p.waitForTimeout(1500);
await fields("staff-settings");
await shot("staff-settings");
await p.evaluate(() => {
  const rows = [...document.querySelectorAll("main button")].filter(b => b.offsetParent);
  console.log(rows.length);
});
const names = await p.evaluate(() => [...document.querySelectorAll("main button")]
  .filter(b => b.offsetParent).map((b,i) => i + ": " + (b.innerText||"").replace(/\s+/g," ").trim().slice(0,50)));
console.log("\nMAIN BUTTONS:\n" + names.join("\n"));
await b.close();
