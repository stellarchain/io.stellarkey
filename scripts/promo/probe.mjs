import { chromium } from "playwright";
import { seed, PASSWORD } from "./seed.mjs";
const { kp, vault, merchant } = await seed();
console.log("PUBKEY", kp.publicKey());
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
await p.waitForTimeout(6000);
const dump = async (label) => {
  const btns = await p.evaluate(() => [...document.querySelectorAll("button,[role=button],a")]
    .filter(x => x.offsetParent).map(x => (x.getAttribute("aria-label") || x.innerText || "").trim().replace(/\s+/g," ").slice(0,40)).filter(Boolean));
  console.log(`\n### ${label}\n` + [...new Set(btns)].join(" | "));
  await p.screenshot({ path: `/tmp/promo/${label}.png` });
};
const go = async (name, label) => {
  const btn = p.getByRole("button", { name: new RegExp(`^${name}$`) }).first();
  if (await btn.count()) { await btn.click(); await p.waitForTimeout(1600); await dump(label); }
  else console.log(`\n### ${label}\n  (no button "${name}")`);
};
await dump("home");
await go("Merchant", "merchant-pos");
await go("Insights", "merchant-insights");
await go("Wallet", "back-wallet");
await go("DEX Swap", "swap");
await go("Activity", "activity");
await b.close();
