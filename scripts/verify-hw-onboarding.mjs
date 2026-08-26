import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
mkdirSync("/tmp/shots/hwonboard", { recursive: true });
const b64 = (buf) => Buffer.from(buf).toString("base64");
const PASSWORD = seed.password;
let failures = 0;
const assert = (cond, msg) => {
  console.log(cond ? "  PASS" : "  FAIL", msg);
  if (!cond) failures++;
};

// Build a hardware-only vault WITH the password canary (mirrors initializeHardwareVault)
async function encryptText(text, password) {
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
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(text),
  );
  return { salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ct)) };
}

const hwVault = {
  version: 1,
  passwordCheck: await encryptText("polaris-vault-ok", PASSWORD),
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

/* ---------- 1. Hardware-only vault: wrong password rejected, right one unlocks ---------- */
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((v) => {
    window.localStorage.setItem("polaris.vault.v1", JSON.stringify(v));
    window.localStorage.setItem("polaris.network.v1", "testnet");
  }, hwVault);
  const page = await context.newPage();
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.waitForSelector("input[type=password]", { timeout: 25000 });

  await page.fill("input[type=password]", "wrong-password");
  await page.press("input[type=password]", "Enter");
  await page.waitForTimeout(1500);
  const wrongRejected = await page.locator("text=Incorrect password").count();
  assert(wrongRejected >= 1, "hardware vault rejects wrong password (canary verified)");

  await page.fill("input[type=password]", PASSWORD);
  await page.press("input[type=password]", "Enter");
  await page.waitForSelector("text=Total Portfolio", { timeout: 25000 });
  assert(true, "hardware vault unlocks with correct password");
  const labelVisible = await page.locator("text=Trezor 1").first().count();
  assert(labelVisible >= 1, "Trezor 1 account shown after unlock");
  await context.close();
}

/* ---------- 2. Choose screen Trezor card + hardware step ---------- */
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.waitForSelector("text=Own your keys", { timeout: 25000 });
  await page.waitForTimeout(600);
  assert(await page.locator('button:has-text("Connect Trezor")').count() === 1, "Trezor path card on choose screen");
  await page.screenshot({ path: "/tmp/shots/hwonboard/01-choose-trezor.png" });

  await page.locator('button:has-text("Connect Trezor")').click();
  await page.waitForTimeout(600);
  assert(await page.locator("text=Connect your Trezor").count() === 1, "hardware step renders");
  assert(await page.locator('button:has-text("Connect Trezor via WebUSB")').count() === 1, "WebUSB connect button present");
  await page.screenshot({ path: "/tmp/shots/hwonboard/02-hardware-step.png" });
  await context.close();
}

await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
