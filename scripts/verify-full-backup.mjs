import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
mkdirSync("/tmp/shots/backup2", { recursive: true });
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
const mainAccount = await makeAccount(seed.mainSecret, PASSWORD, "acc-main", "Main");
const vault = { version: 1, accounts: [mainAccount], activeAccountId: "acc-main" };
const contacts = [
  { name: "Alice", address: Sdk.Keypair.random().publicKey(), favorite: true },
  { name: "Bob", address: Sdk.Keypair.random().publicKey() },
];

const browser = await chromium.launch();
let failures = 0;
const assert = (cond, msg) => {
  console.log(cond ? "  PASS" : "  FAIL", msg);
  if (!cond) failures++;
};

/* ---------- Context A: export the backup via the wizard ---------- */
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctxA.addInitScript(
  ({ v, c }) => {
    window.localStorage.setItem("polaris.vault.v1", JSON.stringify(v));
    window.localStorage.setItem("polaris.network.v1", "testnet");
    window.localStorage.setItem("polaris.privacy.v1", "0");
    window.localStorage.setItem("polaris.contacts.v1", JSON.stringify(c));
    window.localStorage.setItem("wallet.currency.v1", "EUR");
  },
  { v: vault, c: contacts },
);
const pageA = await ctxA.newPage();
await pageA.goto("http://localhost:3000", { waitUntil: "networkidle" });
await pageA.fill("input[type=password]", PASSWORD);
await pageA.press("input[type=password]", "Enter");
await pageA.waitForSelector("text=Total Portfolio", { timeout: 25000 });
await pageA.waitForTimeout(1500);

const vaultJsonAtRest = await pageA.evaluate(() => window.localStorage.getItem("polaris.vault.v1"));

await pageA.locator("text=Settings").first().click();
await pageA.waitForSelector("text=Backup & Recovery", { timeout: 8000 });
await pageA.locator(".list-group button", { hasText: "Backup & Recovery" }).first().click();
await pageA.waitForTimeout(400);
await pageA.locator('button:has-text("Back Up Wallet")').click();
await pageA.locator('button:has-text("Encrypted Backup File")').click();
await pageA.waitForTimeout(400);
await pageA.screenshot({ path: "/tmp/shots/backup2/01-file-method.png" });

const dlPromise = pageA.waitForEvent("download", { timeout: 15000 });
await pageA.locator('button:has-text("Download Encrypted Backup")').click();
const dl = await dlPromise;
const backupJson = readFileSync(await dl.path(), "utf8");
console.log("downloaded:", dl.suggestedFilename());

const envelope = JSON.parse(backupJson);
assert(envelope.kind === "stellar-wallet-backup", "envelope kind marker");
assert(envelope.version === 2, "envelope version 2");
assert(Boolean(envelope.crypto?.salt && envelope.crypto?.iv && envelope.crypto?.ciphertext), "crypto payload present");
assert(!backupJson.includes(mainAccount.publicKey), "no plaintext public key in file");
assert(!backupJson.includes('"Main"'), "no plaintext account label in file");
assert(!backupJson.includes("Alice"), "no plaintext contact name in file");
assert(!("vault" in envelope), "no plaintext vault key in envelope");

/* ---------- Wizard restore path: encrypted file → password step → confirm ---------- */
await pageA.keyboard.press("Escape");
await pageA.waitForTimeout(400);
await pageA.locator(".list-group button", { hasText: "Backup & Recovery" }).first().click();
await pageA.waitForTimeout(400);
await pageA.locator('button:has-text("Restore From Backup")').click();
await pageA.locator('input[type="file"]').setInputFiles({
  name: "wallet-backup.json", mimeType: "application/json", buffer: Buffer.from(backupJson),
});
await pageA.waitForTimeout(500);
await pageA.screenshot({ path: "/tmp/shots/backup2/02-restore-password.png" });
assert(await pageA.locator('input[placeholder="Backup password"]').count() === 1, "password step shown for encrypted backup");

// wrong password first
await pageA.fill('input[placeholder="Backup password"]', "wrongpass1");
await pageA.locator('button:has-text("Decrypt & Review")').click();
await pageA.waitForTimeout(800);
assert(await pageA.locator("text=Incorrect password").count() >= 1, "wrong password rejected");

await pageA.fill('input[placeholder="Backup password"]', PASSWORD);
await pageA.locator('button:has-text("Decrypt & Review")').click();
await pageA.waitForTimeout(800);
await pageA.screenshot({ path: "/tmp/shots/backup2/03-restore-confirm.png" });
assert(await pageA.locator("text=2 contacts · settings included").count() === 1, "confirm shows contacts+settings");
assert(await pageA.locator("text=AES-256-GCM · whole file").count() === 1, "confirm shows whole-file encryption");
await pageA.keyboard.press("Escape");
await ctxA.close();

/* ---------- Context B: fresh profile, restore via Onboarding ---------- */
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const pageB = await ctxB.newPage();
await pageB.goto("http://localhost:3000", { waitUntil: "networkidle" });
await pageB.waitForSelector("text=Restore From Backup File", { timeout: 25000 });
await pageB.locator('input[type="file"]').first().setInputFiles({
  name: "wallet-backup.json", mimeType: "application/json", buffer: Buffer.from(backupJson),
});
await pageB.waitForTimeout(600);
await pageB.fill('input[placeholder="Enter password"]', PASSWORD);
await pageB.locator('button:has-text("Restore Wallet")').click();
// app flips to lock screen
await pageB.waitForSelector("input[type=password]", { timeout: 15000 });
await pageB.waitForTimeout(800);
await pageB.fill("input[type=password]", PASSWORD);
await pageB.press("input[type=password]", "Enter");
await pageB.waitForSelector("text=Total Portfolio", { timeout: 25000 });
await pageB.waitForTimeout(1500);
assert(await pageB.locator("text=Main").first().count() >= 1, "restored wallet unlocks, Main account present");
const restoredCurrency = await pageB.evaluate(() => window.localStorage.getItem("wallet.currency.v1"));
assert(restoredCurrency === "EUR", "fiat currency setting restored");
await pageB.locator('button:has-text("Contacts")').first().click();
await pageB.waitForTimeout(600);
const aliceVisible = await pageB.locator("text=Alice").count();
assert(aliceVisible >= 1, "contacts restored and visible in Contacts view");
await pageB.screenshot({ path: "/tmp/shots/backup2/04-restored-contacts.png" });
await ctxB.close();

/* ---------- Context C: legacy v1 plaintext backup is now REJECTED ---------- */
const legacyJson = JSON.stringify({
  kind: "stellar-wallet-backup",
  exportedAt: new Date().toISOString(),
  network: "testnet",
  vault: JSON.parse(vaultJsonAtRest),
});
const ctxC = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const pageC = await ctxC.newPage();
await pageC.goto("http://localhost:3000", { waitUntil: "networkidle" });
await pageC.waitForSelector("text=Restore From Backup File", { timeout: 25000 });
await pageC.locator('input[type="file"]').first().setInputFiles({
  name: "legacy.json", mimeType: "application/json", buffer: Buffer.from(legacyJson),
});
await pageC.waitForTimeout(1000);
const legacyError = await pageC.locator("text=outdated legacy export").count();
assert(legacyError >= 1, "legacy plaintext backup rejected with clear error");
const stillOnboarding = await pageC.locator("text=Restore From Backup File").count();
assert(stillOnboarding >= 1, "no restore happened for legacy file");
await ctxC.close();

await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
