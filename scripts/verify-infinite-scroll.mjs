import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
mkdirSync("/tmp/shots/scroll", { recursive: true });
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

// 1. Create 40 activity ops (batched in one tx) so history spans multiple pages
{
  const counterKp = Sdk.Keypair.fromSecret(seed.counterpartySecret);
  const acc = await (await fetch(`${HORIZON}/accounts/${counterKp.publicKey()}`)).json();
  const builder = new Sdk.TransactionBuilder(new Sdk.Account(counterKp.publicKey(), acc.sequence), {
    fee: "100",
    networkPassphrase: Sdk.Networks.TESTNET,
  });
  for (let i = 0; i < 40; i++) {
    builder.addOperation(Sdk.Operation.payment({
      destination: seed.mainPublic, asset: Sdk.Asset.native(), amount: "0.0001",
    }));
  }
  const tx = builder.setTimeout(180).build();
  tx.sign(counterKp);
  const res = await fetch(`${HORIZON}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `tx=${encodeURIComponent(tx.toXdr())}`,
  });
  assert(res.ok, "40 history ops submitted");
  await new Promise((r) => setTimeout(r, 3500));
}

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
await page.waitForTimeout(2500);

await page.locator('button:has-text("Activity")').first().click();
await page.waitForTimeout(1500);

const ROWS = ".list-group button.row-hover";
const count = () => page.locator(ROWS).count();
const initial = await count();
console.log("initial rows:", initial);
assert(initial > 0 && initial <= 30, `page 1 shows ≤30 rows (got ${initial})`);
assert(await page.locator('button:has-text("Load More Activity")').count() === 0, "no Load More button anymore");

// 2. Forever scroll: scroll to bottom → auto-load next page(s)
async function scrollBottom() {
  await page.locator("main").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await page.waitForTimeout(1800);
}
await scrollBottom();
const after1 = await count();
console.log("after scroll 1:", after1);
assert(after1 > initial, `scroll auto-loaded more rows (${initial} → ${after1})`);
await shot01(page);
await scrollBottom();
await scrollBottom();
const after2 = await count();
console.log("after scroll 3:", after2);

async function shot01(p) {
  await p.screenshot({ path: "/tmp/shots/scroll/01-mid-scroll.png" });
}

// keep scrolling until sentinel exhausted
for (let i = 0; i < 5 && (await page.locator(ROWS).count()) < 60; i++) await scrollBottom();
const finalCount = await count();
console.log("final rows:", finalCount);
const caughtUp = await page.locator("text=all caught up").count();
assert(caughtUp === 1, "'all caught up' end-state appears at the end of history");
await page.screenshot({ path: "/tmp/shots/scroll/02-caught-up.png" });

// 3. Refresh must NOT wipe loaded pages (the original reset bug)
await page.locator('main').evaluate((el) => el.scrollTo({ top: 0 }));
await page.locator('[title="Refresh Network Data"]').click();
await page.waitForTimeout(2500);
const afterRefresh = await count();
console.log("rows after refresh:", afterRefresh);
assert(afterRefresh >= finalCount, `refresh preserved loaded history (${afterRefresh} ≥ ${finalCount})`);

await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
