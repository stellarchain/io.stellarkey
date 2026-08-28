import { chromium } from "playwright";
import { account, PASSWORD, PROFILE, BASE } from "./seed.mjs";
import { readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
const V = "/tmp/promo/qtest";
rmSync(V, { recursive: true, force: true }); mkdirSync(V, { recursive: true });
const { vault } = await account();
const cached = existsSync("/tmp/promo/vault.json") ? readFileSync("/tmp/promo/vault.json", "utf8") : null;
const ctx = await chromium.launchPersistentContext(PROFILE, {
  viewport: { width: 1728, height: 1080 },
  deviceScaleFactor: 2,
  recordVideo: { dir: V, size: { width: 1728, height: 1080 } },
});
const p = ctx.pages()[0] ?? (await ctx.newPage());
await ctx.addInitScript(([v, c]) => {
  if (c) localStorage.setItem("stellarkey.vault.v1", c);
  else if (!localStorage.getItem("stellarkey.vault.v1")) localStorage.setItem("stellarkey.vault.v1", v);
  localStorage.setItem("stellarkey.network.v1", "testnet");
}, [vault, cached]);
await p.goto(BASE, { waitUntil: "domcontentloaded" });
const pw = p.locator('input[type="password"]').first();
await pw.waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
if (await pw.isVisible().catch(() => false)) { await pw.fill(PASSWORD); await p.getByRole("button", { name: /^Unlock Vault$/ }).click(); }
await p.getByRole("button", { name: /^Merchant$/ }).first().waitFor({ timeout: 30000 });
await p.waitForTimeout(2500);
await p.screenshot({ path: "/tmp/promo/q-desktop.png" });
// now the phone
await p.setViewportSize({ width: 402, height: 874 });
await p.waitForTimeout(3500);
await p.screenshot({ path: "/tmp/promo/q-mobile.png" });
console.log("mobile buttons:", (await p.evaluate(() => [...document.querySelectorAll("button")].filter(b=>b.offsetParent).map(b=>(b.innerText||b.getAttribute("aria-label")||"").replace(/\s+/g," ").trim().slice(0,20)).filter(Boolean))).slice(0,16).join(" | "));
await p.waitForTimeout(2000);
const page = p;
await ctx.close();
console.log("video:", await page.video()?.path());
