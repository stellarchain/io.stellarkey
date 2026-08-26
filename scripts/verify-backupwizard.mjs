import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
mkdirSync("/tmp/shots/wizard", { recursive: true });
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
await page.waitForTimeout(1800);

async function shot(name) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `/tmp/shots/wizard/${name}.png` });
  console.log("shot:", name);
}

// Settings → single Backup & Recovery row
await page.locator("text=Settings").first().click();
await page.waitForSelector("text=Backup & Recovery", { timeout: 8000 });
await shot("01-settings-row");

// Open wizard → choose step
await page.locator(".list-group button", { hasText: "Backup & Recovery" }).first().click();
await shot("02-choose");

// → backup method step
await page.locator('button:has-text("Back Up Wallet")').click();
await shot("03-method");

// → file method → secure step (no password)
await page.locator('button:has-text("Encrypted Backup File")').click();
await shot("04-secure-file");
await page.locator('[role="dialog"] button:text-is("Back")').click();
await page.waitForTimeout(300);

// → secret method → password gate
await page.locator('button:has-text("Secret Key")').click();
await shot("05-password");
await page.fill('[role="dialog"] input[type="password"]', PASSWORD);
await page.locator('button:has-text("Verify & Reveal")').click();
await page.waitForTimeout(600);
await shot("06-secure-secret");

// acknowledge → done
await page.locator('[role="dialog"] label:has-text("I understand")').click();
await page.waitForTimeout(200);
await page.locator('button:has-text("I\'ve Stored It Safely")').click();
await shot("07-done");
await page.locator('[role="dialog"] button:text-is("Done")').click();
await page.waitForTimeout(400);

// Restore path
await page.locator(".list-group button", { hasText: "Backup & Recovery" }).first().click();
await page.waitForTimeout(400);
await page.locator('button:has-text("Restore From Backup")').click();
await shot("08-restore-pick");

const fakeBackup = JSON.stringify({
  kind: "stellar-wallet-backup",
  exportedAt: new Date().toISOString(),
  network: "testnet",
  vault: { version: 1, accounts: [{}, {}, {}], mnemonic: { ciphertext: "x" } },
});
await page.locator('input[type="file"]').setInputFiles({
  name: "wallet-backup-2026-08-20.json",
  mimeType: "application/json",
  buffer: Buffer.from(fakeBackup),
});
await shot("09-restore-confirm");

// invalid file error state
await page.locator('[role="dialog"] button:text-is("Back")').click();
await page.waitForTimeout(300);
await page.locator('input[type="file"]').setInputFiles({
  name: "notes.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify({ hello: "world" })),
});
await shot("10-restore-invalid");

await browser.close();
console.log("done");
