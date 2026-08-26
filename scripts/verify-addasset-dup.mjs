import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
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
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
await context.addInitScript((v) => {
  window.localStorage.setItem("polaris.vault.v1", JSON.stringify(v));
  window.localStorage.setItem("polaris.network.v1", "testnet");
  window.localStorage.setItem("polaris.privacy.v1", "0");
}, vault);
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.fill("input[type=password]", PASSWORD);
await page.press("input[type=password]", "Enter");
await page.waitForSelector("text=Total Portfolio", { timeout: 25000 });
await page.waitForTimeout(1500);

await page.click("button:has-text('Add asset')");
await page.waitForSelector("text=Queued Trustlines");
await page.waitForTimeout(300);

// Search yXLM and click it twice (was: two queued rows with the same key)
await page.fill("input[placeholder*='Search popular']", "yxlm");
await page.waitForTimeout(200);
const card = page.locator("button:has-text('Yield XLM')");
await card.click();
await page.waitForTimeout(150);
await card.click(); // second click toggles OFF
await page.waitForTimeout(150);
await card.click(); // third click queues again
await page.waitForTimeout(200);

const queuedText = await page.locator("text=/Queued Trustlines \\(\\d+\\)/").innerText();
const dupKeys = consoleErrors.filter((e) => e.includes("same key"));
console.log("queue state:", queuedText);
console.log("duplicate-key console errors:", dupKeys.length);
await page.screenshot({ path: "/tmp/shots/addasset-yxlm.png" });

await browser.close();
