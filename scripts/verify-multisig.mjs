import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
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
const signerB = Sdk.Keypair.random(); // cosigner, imported as 2nd wallet account
const signerC = Sdk.Keypair.random(); // cosigner, never signs
// Persist cosigner secrets IMMEDIATELY — if a run fails mid-way, cleanup stays possible.
writeFileSync(
  "/tmp/multisig-cosigners.json",
  JSON.stringify({ signerB: signerB.secret(), signerC: signerC.secret(), at: new Date().toISOString() }, null, 2),
);
const vault = {
  version: 1,
  accounts: [
    await makeAccount(seed.mainSecret, PASSWORD, "acc-main", "Main"),
    await makeAccount(signerB.secret(), PASSWORD, "acc-b", "Second"),
  ],
  activeAccountId: "acc-main",
};

const HORIZON = "https://horizon-testnet.stellar.org";
let failures = 0;
const assert = (cond, msg) => {
  console.log(cond ? "  PASS" : "  FAIL", msg);
  if (!cond) failures++;
};

// Guard: the suite requires a single-sig starting state
{
  const res = await fetch(`${HORIZON}/accounts/${mainKp.publicKey()}`);
  const acc = await res.json();
  if ((acc.signers?.length ?? 0) > 1) {
    console.error("ABORT: account is multisig — run cleanup first. Cosigner secrets in /tmp/multisig-cosigners.json");
    process.exit(1);
  }
}

// Raw-SDK reset to single-sig with sequence refetch + retries (testnet lag safe)
async function rawReset(extraSigners) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${HORIZON}/accounts/${mainKp.publicKey()}`);
    const acc = await res.json();
    const builder = new Sdk.TransactionBuilder(new Sdk.Account(mainKp.publicKey(), acc.sequence), {
      fee: "100",
      networkPassphrase: Sdk.Networks.TESTNET,
    });
    for (const kp of extraSigners) {
      builder.addOperation(Sdk.Operation.setOptions({ signer: { ed25519PublicKey: kp.publicKey(), weight: 0 } }));
    }
    builder.addOperation(Sdk.Operation.setOptions({ masterWeight: 1, lowThreshold: 0, medThreshold: 0, highThreshold: 0 }));
    const tx = builder.setTimeout(180).build();
    tx.sign(mainKp, ...extraSigners);
    const post = await fetch(`${HORIZON}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `tx=${encodeURIComponent(tx.toXdr())}`,
    });
    if (post.ok) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

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
  await page.locator('text=Multi-Sig Studio').first().click();
  await page.waitForSelector("text=Shared control", { timeout: 8000 });
  await page.waitForTimeout(900);
}

/* ---- 1. Overview: single-sig state ---- */
await openStudio();
await shot("01-overview-singlesig");

/* ---- 2. Configure 3 signers, custom L2/M2/H1 ---- */
await page.locator('button:has-text("Set Up Multi-Sig")').click();
await page.waitForTimeout(400);
await page.fill('input[placeholder="Cosigner address (G...)"]', signerB.publicKey());
await page.locator('[role="dialog"] button:has-text("Add")').click();
await page.waitForTimeout(250);
await page.fill('input[placeholder="Cosigner address (G...)"]', signerC.publicKey());
await page.locator('[role="dialog"] button:has-text("Add")').click();
await page.waitForTimeout(250);
await shot("02-configure-signers");
// Custom thresholds L2 M2 H2 (proper ordering; cleanup uses raw SDK with both keys)
await page.locator('button:has-text("Custom")').click();
await page.waitForTimeout(250);
const numInputs = page.locator('input[type="number"]');
await numInputs.nth(0).fill("2"); // low
await numInputs.nth(1).fill("2"); // medium
await numInputs.nth(2).fill("2"); // high
await shot("03-configure-thresholds");
await page.locator('button:has-text("Review Configuration")').click();
await shot("04-configure-review");
await page.locator('button:has-text("Apply Configuration")').click();
await page.waitForTimeout(2500);
await shot("05-applied");

// verify on-chain
let onchain = null;
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(1500);
  const res = await fetch(`${HORIZON}/accounts/${mainKp.publicKey()}`);
  onchain = await res.json();
  if (onchain?.thresholds?.med_threshold === 2) break;
}
assert(onchain?.thresholds?.med_threshold === 2, `on-chain med threshold = 2 (got ${onchain?.thresholds?.med_threshold})`);
assert(onchain?.thresholds?.high_threshold === 2, "on-chain high threshold = 2");
assert(onchain?.signers?.length === 3, `on-chain 3 signers (got ${onchain?.signers?.length})`);
await shot("06-overview-multisig");

/* ---- 3. Send 1 XLM from Main → should produce a cosign envelope ---- */
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await page.locator('div.max-w-\\[360px\\] > button:has-text("Send")').click();
await page.fill('input[placeholder="G... or user*domain.com"]', seed.counterpartyPublic);
await page.fill('input[placeholder="0.00"]', "1");
await page.waitForTimeout(1200);
await page.locator('button:has-text("Review Transfer")').click();
await page.waitForTimeout(700);
const ctaLabel = await page.locator('button:has-text("Sign & Share for Approval")').count();
assert(ctaLabel === 1, "review CTA reads 'Sign & Share for Approval'");
await page.locator('button:has-text("Sign & Share for Approval")').click();
await page.waitForTimeout(1500);
await shot("07-send-cosign-stage");
const xdrText = await page.locator(".select-all.break-all").first().textContent();
assert(Boolean(xdrText && xdrText.length > 100 && xdrText.startsWith("AAAA")), "cosign envelope XDR produced");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

/* ---- 4. Switch to Second account, co-sign in Approvals → auto-submit ---- */
await page.locator('button:has-text("Second")').first().click();
await page.waitForTimeout(1200);
await openStudio();
await page.locator('button:has-text("Approvals")').click();
await page.waitForTimeout(400);
await page.locator("textarea").fill(xdrText.trim());
await shot("08-approvals-ready");
await page.locator('button:has-text("Review & Co-Sign")').click();
let submittedOk = true;
try {
  await page.waitForSelector("text=Threshold Met", { timeout: 15000 });
} catch {
  submittedOk = false;
}
await shot("09-approvals-result");
assert(submittedOk, "co-sign collected enough weight and submitted");

// verify the payment actually landed on-chain
const txRes = await fetch(`${HORIZON}/accounts/${mainKp.publicKey()}/payments?order=desc&limit=5`);
const txJson = await txRes.json();
const latest = txJson?._embedded?.records?.[0];
assert(
  latest?.type === "payment" && latest?.to === seed.counterpartyPublic && latest?.amount === "1.0000000",
  `payment of 1 XLM landed on-chain (got ${latest?.type} ${latest?.amount})`,
);

/* ---- 5. Phase-1 cleanup via raw SDK (high=2 needs both keys — by design) ---- */
assert(await rawReset([signerB, signerC]), "phase-1 cleanup tx accepted (both keys signed)");
await page.waitForTimeout(2500);

/* ---- 6. Phase 2: any-of-3 config, then disable via the studio UI ---- */
await page.keyboard.press("Escape"); // close the studio (still open from Approvals)
await page.waitForTimeout(500);
await page.locator('button:has-text("Main")').first().click();
await page.waitForTimeout(1200);
await openStudio();
await page.locator('button:has-text("Set Up Multi-Sig"), button:has-text("Edit Configuration")').first().click();
await page.waitForTimeout(400);
await page.fill('input[placeholder="Cosigner address (G...)"]', signerB.publicKey());
await page.locator('[role="dialog"] button:has-text("Add")').click();
await page.waitForTimeout(250);
await page.fill('input[placeholder="Cosigner address (G...)"]', signerC.publicKey());
await page.locator('[role="dialog"] button:has-text("Add")').click();
await page.waitForTimeout(250);
await page.locator('button:has-text("Custom")').click();
await page.waitForTimeout(250);
const numInputs2 = page.locator('input[type="number"]');
await numInputs2.nth(0).fill("1");
await numInputs2.nth(1).fill("1");
await numInputs2.nth(2).fill("1");
await page.locator('button:has-text("Review Configuration")').click();
await page.waitForTimeout(400);
await page.locator('button:has-text("Apply Configuration")').click();
// wait for the 1/1/1 config to land on-chain before touching the UI again
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(1500);
  const res = await fetch(`${HORIZON}/accounts/${mainKp.publicKey()}`);
  const acc = await res.json();
  if (acc?.thresholds?.high_threshold === 1 && acc?.signers?.length === 3) break;
}
// now disable via the UI (high = 1 → Main alone suffices) — link lives on Overview
await page.locator('[role="dialog"] button:has-text("Overview")').click();
await page.waitForTimeout(1200);
await page.locator('button:has-text("Disable multi-sig for this account")').click();
await page.waitForTimeout(400);
await shot("10-disable-confirm");
await page.locator('button:has-text("Disable Multi-Sig")').click();
await page.waitForTimeout(2500);
let restored = null;
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(1500);
  const res = await fetch(`${HORIZON}/accounts/${mainKp.publicKey()}`);
  restored = await res.json();
  if (restored?.signers?.length === 1) break;
}
assert(restored?.signers?.length === 1, `multi-sig disabled on-chain via UI (signers: ${restored?.signers?.length})`);
assert(restored?.thresholds?.med_threshold === 0, "thresholds reset to defaults");
await shot("11-disabled");

await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
