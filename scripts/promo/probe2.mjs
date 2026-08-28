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
const dump = async (label) => {
  const btns = await p.evaluate(() => [...document.querySelectorAll("button,[role=button]")]
    .filter(x => x.offsetParent).map(x => (x.getAttribute("aria-label") || x.innerText || "").trim().replace(/\s+/g," ").slice(0,36)).filter(Boolean));
  console.log(`\n### ${label}\n` + [...new Set(btns)].join(" | "));
  await p.screenshot({ path: `/tmp/promo/${label}.png` });
};
const tap = async (re, wait = 1200) => {
  const el = p.getByRole("button", { name: re }).first();
  if (!(await el.count())) { console.log(`  MISS ${re}`); return false; }
  await el.click(); await p.waitForTimeout(wait); return true;
};
await tap(/^Merchant$/);
await tap(/^Choose staff$/); await dump("staff-modal");
// pick the first staff row inside the dialog
const row = p.locator('[role="dialog"] button').nth(1);
if (await row.count()) { await row.click(); await p.waitForTimeout(1200); }
await dump("after-staff");
await tap(/^Open shift$/); await dump("shift-modal");
await b.close();
