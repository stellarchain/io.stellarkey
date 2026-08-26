import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
const cos = JSON.parse(readFileSync("/tmp/multisig-cosigners.json", "utf8"));
mkdirSync("/tmp/shots/multisig", { recursive: true });
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
const mainKp = Sdk.Keypair.fromSecret(seed.mainSecret);
const signerB = Sdk.Keypair.fromSecret(cos.signerB);
const signerC = Sdk.Keypair.fromSecret(cos.signerC);
const HORIZON = "https://horizon-testnet.stellar.org";
let failures = 0;
const assert = (cond, msg) => {
  console.log(cond ? "  PASS" : "  FAIL", msg);
  if (!cond) failures++;
};

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
await page.waitForTimeout(2000);

async function shot(name) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `/tmp/shots/multisig/${name}.png` });
  console.log("shot:", name);
}
async function openStudio() {
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(400);
  await page.locator("text=Multi-Sig Studio").first().click();
  await page.waitForSelector("text=Shared control", { timeout: 8000 });
  await page.waitForTimeout(900);
}

// Configure any-of-3 (1/1/1) via the studio
await openStudio();
await page.locator('button:has-text("Set Up Multi-Sig")').click();
await page.waitForTimeout(400);
await page.fill('input[placeholder="Cosigner address (G...)"]', signerB.publicKey());
await page.locator('[role="dialog"] button:has-text("Add")').click();
await page.waitForTimeout(250);
await page.fill('input[placeholder="Cosigner address (G...)"]', signerC.publicKey());
await page.locator('[role="dialog"] button:has-text("Add")').click();
await page.waitForTimeout(250);
await page.locator('button:has-text("Custom")').click();
await page.waitForTimeout(250);
const nums = page.locator('input[type="number"]');
await nums.nth(0).fill("1");
await nums.nth(1).fill("1");
await nums.nth(2).fill("1");
await page.locator('button:has-text("Review Configuration")').click();
await page.waitForTimeout(400);
await page.locator('button:has-text("Apply Configuration")').click();

let acc = null;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1500);
  acc = await (await fetch(`${HORIZON}/accounts/${mainKp.publicKey()}`)).json();
  if (acc?.thresholds?.high_threshold === 1 && acc?.signers?.length === 3) break;
}
assert(acc?.thresholds?.high_threshold === 1 && acc?.signers?.length === 3, "any-of-3 config applied on-chain");

// Overview shows the active scheme
await page.locator('[role="dialog"] button:has-text("Overview")').click();
await page.waitForTimeout(1200);
await shot("p2-overview-multisig");

// Disable via UI (high = 1 → Main alone suffices)
await page.locator('button:has-text("Disable multi-sig for this account")').click();
await page.waitForTimeout(400);
await shot("p2-disable-confirm");
await page.locator('button:has-text("Disable Multi-Sig")').click();

let restored = null;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1500);
  restored = await (await fetch(`${HORIZON}/accounts/${mainKp.publicKey()}`)).json();
  if (restored?.signers?.length === 1) break;
}
assert(restored?.signers?.length === 1, `multi-sig disabled on-chain via UI (signers: ${restored?.signers?.length})`);
assert(restored?.thresholds?.med_threshold === 0, "thresholds reset to defaults");
await shot("p2-disabled");

await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
