import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
mkdirSync("/tmp/shots/fiat", { recursive: true });
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
const vault = {
  version: 1,
  accounts: [await makeAccount(seed.mainSecret, PASSWORD, "acc-main", "Main")],
  activeAccountId: "acc-main",
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
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
await page.waitForSelector("text=Total Portfolio", { timeout: 25000 });
await page.waitForTimeout(2200);

async function shot(name) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `/tmp/shots/fiat/${name}.png` });
  console.log("shot:", name);
}
const actionRow = "div.max-w-\\[360px\\]";

// Send form with amount
await page.click(`${actionRow} > button:has-text('Send')`);
await page.fill('input[placeholder="G... or user*domain.com"]', seed.counterpartyPublic);
await page.fill('input[placeholder="0.00"]', "25");
await page.waitForTimeout(500);
await shot("01-send-form");
await page.click('button:has-text("Review Transfer")');
await shot("02-send-review");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// Tx detail
await page.locator("text=Received Payment").first().click();
await shot("03-tx-detail");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// Receive with custom amount
await page.click(`${actionRow} > button:has-text('Receive')`);
await page.locator('button:has-text("Set Amount / Memo")').click();
await page.waitForTimeout(300);
await page.fill('input[placeholder="e.g. 50"]', "50");
await shot("04-receive");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// Batch send with a valid row
await page.click('button:has-text("Multi-Send")');
await page.waitForTimeout(400);
await page.fill('input[placeholder="Recipient address (G...)"]', seed.counterpartyPublic);
await page.fill('input[placeholder="Amount"]', "10");
await shot("05-batch");
await page.keyboard.press("Escape");

await browser.close();
console.log("done");
