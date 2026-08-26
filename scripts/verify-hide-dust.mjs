import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
mkdirSync("/tmp/shots/dust", { recursive: true });
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
const HORIZON = "https://horizon-testnet.stellar.org";
let failures = 0;
const assert = (cond, msg) => {
  console.log(cond ? "  PASS" : "  FAIL", msg);
  if (!cond) failures++;
};

// 1. Send real dust (0.00001 XLM) + a normal payment (0.5 XLM) from counterparty → main
{
  const counterKp = Sdk.Keypair.fromSecret(seed.counterpartySecret);
  const acc = await (await fetch(`${HORIZON}/accounts/${counterKp.publicKey()}`)).json();
  const tx = new Sdk.TransactionBuilder(new Sdk.Account(counterKp.publicKey(), acc.sequence), {
    fee: "100",
    networkPassphrase: Sdk.Networks.TESTNET,
  })
    .addOperation(Sdk.Operation.payment({
      destination: seed.mainPublic, asset: Sdk.Asset.native(), amount: "0.00001",
    }))
    .addOperation(Sdk.Operation.payment({
      destination: seed.mainPublic, asset: Sdk.Asset.native(), amount: "0.5",
    }))
    .setTimeout(180)
    .build();
  tx.sign(counterKp);
  const res = await fetch(`${HORIZON}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `tx=${encodeURIComponent(tx.toXdr())}`,
  });
  assert(res.ok, "dust + normal test payments submitted");
  await new Promise((r) => setTimeout(r, 3000));
}

// 2. UI check
const vault = {
  version: 1,
  accounts: [await makeAccount(seed.mainSecret, PASSWORD, "acc-main", "Main")],
  activeAccountId: "acc-main",
};
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
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

await page.locator('button:has-text("Activity")').first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/shots/dust/01-activity-with-dust.png" });

const dustVisible = await page.locator("text=+0.00001 XLM").count();
const normalVisible = await page.locator("text=+0.5 XLM").count();
assert(dustVisible >= 1, "dust payment row visible by default");
assert(normalVisible >= 1, "normal payment row visible by default");

await page.locator('button:has-text("Hide Dust")').click();
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/shots/dust/02-activity-dust-hidden.png" });

const dustAfter = await page.locator("text=+0.00001 XLM").count();
const normalAfter = await page.locator("text=+0.5 XLM").count();
assert(dustAfter === 0, "dust row hidden after toggle");
assert(normalAfter >= 1, "normal payment still visible after toggle");
assert(await page.locator('button:has-text("Dust Hidden")').count() === 1, "toggle shows active state");

// toggle back off
await page.locator('button:has-text("Dust Hidden")').click();
await page.waitForTimeout(500);
assert(await page.locator("text=+0.00001 XLM").count() >= 1, "dust row returns when toggled off");

await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
