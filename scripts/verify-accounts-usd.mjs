import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
mkdirSync("/tmp/shots", { recursive: true });
const b64 = (buf) => Buffer.from(buf).toString("base64");

async function makeAccount(secretKey, password, id, label) {
  const kp = Sdk.Keypair.fromSecret(secretKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(kp.secret()),
  );
  return {
    id, label, publicKey: kp.publicKey(), createdAt: Date.now(),
    secret: { salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ct)) },
  };
}

const PASSWORD = seed.password;
// Three accounts: funded main + two unfunded (must show their own 0, not Main's balance)
const vault = {
  version: 1,
  accounts: [
    await makeAccount(seed.mainSecret, PASSWORD, "acc-main", "Main"),
    await makeAccount(Sdk.Keypair.random().secret(), PASSWORD, "acc-savings", "Savings"),
    await makeAccount(Sdk.Keypair.random().secret(), PASSWORD, "acc-fresh", "Fresh"),
  ],
  activeAccountId: "acc-main",
};

const browser = await chromium.launch();
const results = [];
const log = (s) => { results.push(s); console.log(s); };

const context = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 2,
});
await context.addInitScript((v) => {
  window.localStorage.setItem("polaris.vault.v1", JSON.stringify(v));
  window.localStorage.setItem("polaris.network.v1", "testnet");
  window.localStorage.setItem("polaris.privacy.v1", "0");
}, vault);
const page = await context.newPage();
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.fill("input[type=password]", PASSWORD);
await page.press("input[type=password]", "Enter");
await page.waitForSelector("text=Savings", { timeout: 25000 });
await page.waitForTimeout(3500); // let all-accounts balance fetch + price fetch land

// Sidebar balance rows: read each account row's balance line
const rows = await page.locator("nav >> text=/^(Main|Savings|Fresh)$/").all();
for (const row of rows) {
  const label = await row.innerText();
  const container = row.locator("xpath=ancestor::button[1]");
  log(`sidebar row: ${label.trim()} -> ${(await container.innerText()).replace(/\n/g, " | ")}`);
}

// Explore gone?
const bodyText = await page.locator("body").innerText();
log(`explore in nav: ${/Explore|dApps|Ecosystem/i.test(bodyText)}`);

// USD pill on testnet?
log(`usd pill on testnet: ${/≈\s*\$|≈\s*[0-9]/.test(bodyText) && /USD|EUR|GBP/.test(bodyText)}`);

await page.screenshot({ path: "/tmp/shots/acct-01-dashboard.png" });

// Switch to Savings to prove per-account balances differ
await page.click("text=Savings");
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/shots/acct-02-savings-active.png" });

// Mobile tab bar (Explore should be gone)
await context.close();
const mc = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
await mc.addInitScript((v) => {
  window.localStorage.setItem("polaris.vault.v1", JSON.stringify(v));
  window.localStorage.setItem("polaris.network.v1", "testnet");
  window.localStorage.setItem("polaris.privacy.v1", "0");
}, vault);
const mp = await mc.newPage();
await mp.goto("http://localhost:3000", { waitUntil: "networkidle" });
await mp.fill("input[type=password]", PASSWORD);
await mp.press("input[type=password]", "Enter");
await mp.waitForSelector('[aria-haspopup="menu"]', { timeout: 25000 });
await mp.waitForTimeout(3000);
await mp.screenshot({ path: "/tmp/shots/acct-03-mobile.png", fullPage: false });
await mc.close();

await browser.close();
console.log(results.join("\n"));
