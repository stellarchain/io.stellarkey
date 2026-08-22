import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
const b64 = (b) => Buffer.from(b).toString("base64");

async function makeVault(secretKey, password, label) {
  const kp = Sdk.Keypair.fromSecret(secretKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(kp.secret()));
  return {
    version: 1,
    accounts: [{ id: "seed0001", label, publicKey: kp.publicKey(), createdAt: Date.now(), secret: { salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ct)) } }],
    activeAccountId: "seed0001",
  };
}

const vault = await makeVault(seed.mainSecret, seed.password, "Main");
const browser = await chromium.launch();

async function snap(name, fn, mobile = false) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 },
    deviceScaleFactor: 2,
  });
  await ctx.addInitScript(
    `window.localStorage.setItem('polaris.vault.v1', ${JSON.stringify(JSON.stringify(vault))});window.localStorage.setItem('polaris.network.v1','testnet');`,
  );
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.fill("input[type=password]", seed.password);
  await page.press("input[type=password]", "Enter");
  await page.waitForSelector("text=GOLD", { timeout: 25000 });
  await page.waitForTimeout(900);
  if (fn) await fn(page);
  await page.screenshot({ path: `/tmp/shots/${name}.png` });
  console.log("OK", name);
  await ctx.close();
}

await snap("24-swap-page", async (p) => {
  await p.click('.tab-item:has-text("Swap")');
  await p.fill("input[placeholder='0']", "5");
  await p.waitForTimeout(2200);
});

await snap("25-settings-root", async (p) => {
  await p.click('.tab-item:has-text("Settings")');
  await p.waitForTimeout(500);
});

await snap("26-settings-reveal", async (p) => {
  await p.click('.tab-item:has-text("Settings")');
  await p.click("button:has-text('Reveal Secret Key')");
  await p.waitForTimeout(400);
});

await snap("27-settings-accounts", async (p) => {
  await p.click('.tab-item:has-text("Settings")');
  await p.click("button:has-text('Manage Accounts')");
  await p.waitForTimeout(400);
});

await snap("28-settings-contacts", async (p) => {
  await p.click('.tab-item:has-text("Settings")');
  await p.click("button:has-text('Contacts')");
  await p.fill("input[placeholder*='Exchange']", "Cold wallet");
  await p.fill(".list-group input[placeholder='G…']", seed.counterpartyPublic);
  await p.click("button:has-text('Save Contact')");
  await p.waitForTimeout(600);
});

await snap("29-settings-network", async (p) => {
  await p.click('.tab-item:has-text("Settings")');
  await p.click("button:has-text('Network')");
  await p.waitForTimeout(400);
});

await snap("30-activity-tab", async (p) => {
  await p.click('.tab-item:has-text("Activity")');
  await p.waitForTimeout(500);
});

await snap("31-mobile-settings", async (p) => {
  await p.click('.tab-item:has-text("Settings")');
  await p.waitForTimeout(500);
}, true);

await browser.close();
console.log("done");
