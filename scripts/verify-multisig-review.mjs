import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
const cos = JSON.parse(readFileSync("/tmp/multisig-cosigners.json", "utf8"));
mkdirSync("/tmp/shots/msreview", { recursive: true });
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
  accounts: [
    await makeAccount(seed.mainSecret, PASSWORD, "acc-main", "Main"),
    await makeAccount(cos.signerB, PASSWORD, "acc-b", "Second"),
  ],
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
  await page.screenshot({ path: `/tmp/shots/msreview/${name}.png` });
  console.log("shot:", name);
}
async function openStudioApprovals() {
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(400);
  await page.locator("text=Multi-Sig Studio").first().click();
  await page.waitForSelector("text=Shared control", { timeout: 8000 });
  await page.locator('button:has-text("Approvals")').click();
  await page.waitForTimeout(600);
}
async function buildSignedTx(build) {
  const acc = await (await fetch(`${HORIZON}/accounts/${mainKp.publicKey()}`)).json();
  const tx = new Sdk.TransactionBuilder(new Sdk.Account(mainKp.publicKey(), acc.sequence), {
    fee: "100",
    networkPassphrase: Sdk.Networks.TESTNET,
  });
  build(tx);
  const built = tx.setTimeout(600).build();
  built.sign(mainKp);
  return built.toXdr();
}

/* ---- 1. Configure 2-of-2 (Main + B), H=1 so cleanup works from Main ---- */
await page.keyboard.press("Meta+k");
await page.waitForTimeout(400);
await page.locator("text=Multi-Sig Studio").first().click();
await page.waitForSelector("text=Shared control", { timeout: 8000 });
await page.locator('button:has-text("Set Up Multi-Sig")').click();
await page.waitForTimeout(400);
await page.fill('input[placeholder="Cosigner address (G...)"]', signerB.publicKey());
await page.locator('[role="dialog"] button:has-text("Add")').click();
await page.waitForTimeout(250);
await page.locator('button:has-text("Custom")').click();
await page.waitForTimeout(250);
const nums = page.locator('input[type="number"]');
await nums.nth(0).fill("2");
await nums.nth(1).fill("2");
await nums.nth(2).fill("2");
await page.locator('button:has-text("Review Configuration")').click();
await page.waitForTimeout(400);
await page.locator('button:has-text("Apply Configuration")').click();
let acc = null;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1500);
  acc = await (await fetch(`${HORIZON}/accounts/${mainKp.publicKey()}`)).json();
  if (acc?.thresholds?.med_threshold === 2) break;
}
assert(acc?.thresholds?.med_threshold === 2, "2-of-2 config applied on-chain");
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

/* ---- 2. Payment envelope: review as Main (already signed) ---- */
const payXdr = await buildSignedTx((tx) =>
  tx.addOperation(Sdk.Operation.payment({
    destination: seed.counterpartyPublic,
    asset: Sdk.Asset.native(),
    amount: "1",
  })),
);
await openStudioApprovals();
await page.locator("textarea").fill(payXdr);
await page.locator('button:has-text("Review Transaction")').click();
await page.waitForTimeout(1500);
await shot("01-review-payment");
assert(await page.locator('text=Send 1.0000000 XLM').count() >= 1, "review shows 'Send 1.0000000 XLM'");
assert(await page.locator("text=Source account").count() === 1, "review shows source account row");
assert(await page.locator("text=Signatures collected").count() === 1, "review shows signature status");
assert(await page.locator("text=Network fee").count() === 1, "review shows fee row");

// Sign as Main → already signed → progress view with updated envelope
await page.locator('button:has-text("Sign as Main")').click();
await page.waitForTimeout(1800);
await shot("02-after-own-sign");
assert(await page.locator("text=Collected weight").count() === 1, "progress view shown (needs more weight)");

/* ---- 3. Switch to Second, review + sign → submits ---- */
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await page.locator('button:has-text("Second")').first().click();
await page.waitForTimeout(1200);
await openStudioApprovals();
await page.locator("textarea").fill(payXdr);
await page.locator('button:has-text("Review Transaction")').click();
await page.waitForTimeout(1500);
await shot("03-review-as-second");
await page.locator('button:has-text("Sign as Second")').click();
let metOk = true;
try {
  await page.waitForSelector("text=Threshold Met", { timeout: 15000 });
} catch { metOk = false; }
assert(metOk, "co-sign as Second submits (threshold met)");
await shot("04-submitted");
const payments = await (await fetch(`${HORIZON}/accounts/${mainKp.publicKey()}/payments?order=desc&limit=3`)).json();
const latest = payments?._embedded?.records?.[0];
assert(latest?.amount === "1.0000000" && latest?.to === seed.counterpartyPublic, "payment landed on-chain");

/* ---- 4. Danger-op review (setOptions) — warn and do NOT sign ---- */
const dangerXdr = await buildSignedTx((tx) =>
  tx.addOperation(Sdk.Operation.setOptions({
    signer: { ed25519PublicKey: signerC.publicKey(), weight: 1 },
  })),
);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await page.locator('button:has-text("Main")').first().click();
await page.waitForTimeout(1200);
await openStudioApprovals();
await page.locator("textarea").fill(dangerXdr);
await page.locator('button:has-text("Review Transaction")').click();
await page.waitForTimeout(1500);
await shot("05-review-danger");
assert(await page.locator("text=Change signers / thresholds").count() >= 1, "danger op titled correctly");
assert(await page.locator("text=High risk").count() >= 1, "high-risk badge shown");
assert(await page.locator("text=High-risk transaction").count() >= 1, "danger banner shown");

/* ---- 5. Cleanup (high=2 → both keys) ---- */
await page.keyboard.press("Escape");
const cleanAcc = await (await fetch(`${HORIZON}/accounts/${mainKp.publicKey()}`)).json();
const cleanup = new Sdk.TransactionBuilder(new Sdk.Account(mainKp.publicKey(), cleanAcc.sequence), {
  fee: "100", networkPassphrase: Sdk.Networks.TESTNET,
})
  .addOperation(Sdk.Operation.setOptions({ signer: { ed25519PublicKey: signerB.publicKey(), weight: 0 } }))
  .addOperation(Sdk.Operation.setOptions({ masterWeight: 1, lowThreshold: 0, medThreshold: 0, highThreshold: 0 }))
  .setTimeout(180)
  .build();
cleanup.sign(mainKp, signerB);
const cleanupRes = await fetch(`${HORIZON}/transactions`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: `tx=${encodeURIComponent(cleanup.toXdr())}`,
});
assert(cleanupRes.ok, "cleanup tx accepted (account back to single-sig)");

await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
