import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
mkdirSync("/tmp/shots/trezor-hang", { recursive: true });

// Vault with a HARDWARE Trezor account (address = funded seed account so the form validates)
const vault = {
  version: 1,
  accounts: [
    {
      id: "acc-hw",
      label: "Trezor 1",
      publicKey: seed.mainPublic,
      createdAt: Date.now(),
      hardware: "trezor",
      index: 0,
      path: "m/44'/148'/0'",
    },
  ],
  activeAccountId: "acc-hw",
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript((v) => {
  window.localStorage.setItem("polaris.vault.v1", JSON.stringify(v));
  window.localStorage.setItem("polaris.network.v1", "testnet");
  window.localStorage.setItem("polaris.privacy.v1", "0");
}, vault);
const page = await context.newPage();

let corsBlocked = 0;
let connRefused = 0;
page.on("console", (m) => {
  const t = m.text();
  if (t.includes("loopback")) corsBlocked++;
  if (t.includes("ERR_CONNECTION_REFUSED") || t.includes("ERR_FAILED")) connRefused++;
});
context.on("page", (p) => console.log(`[popup opened] ${p.url()}`));

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.fill("input[type=password]", seed.password);
await page.press("input[type=password]", "Enter");
await page.waitForSelector("text=Total Portfolio", { timeout: 25000 });
await page.waitForTimeout(2000);
console.log("unlocked, hardware account active");

// Send flow
await page.locator('div.max-w-\\[360px\\] > button:has-text("Send")').click();
await page.fill('input[placeholder="G... or user*domain.com"]', seed.counterpartyPublic);
await page.fill('input[placeholder="0.00"]', "1");
await page.waitForTimeout(900);
await page.locator('button:has-text("Review Transfer")').click();
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/shots/trezor-hang/01-review.png" });

await page.locator('button:has-text("Confirm Send")').click();
console.log("confirm clicked, watching 12s…");

await page.waitForTimeout(12000);
console.log("loopback CORS blocks:", corsBlocked, "| conn refused/failed:", connRefused);
const iframes = await page.locator("iframe").count();
console.log("iframes:", iframes);
await page.screenshot({ path: "/tmp/shots/trezor-hang/iframe-mode.png" });
console.log("done");
await browser.close();
