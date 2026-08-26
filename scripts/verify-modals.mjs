import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
mkdirSync("/tmp/shots/modals", { recursive: true });
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
const skipped = [];

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/shots/modals/${name}.png` });
  console.log("shot:", name);
}

async function closeModal(page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
}

async function run(label, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await context.addInitScript((v) => {
    window.localStorage.setItem("polaris.vault.v1", JSON.stringify(v));
    window.localStorage.setItem("polaris.network.v1", "testnet");
    window.localStorage.setItem("polaris.privacy.v1", "0");
  }, vault);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.fill("input[type=password]", PASSWORD);
  await page.press("input[type=password]", "Enter");
  await page.waitForSelector("text=Total Portfolio", { timeout: 25000 });
  await page.waitForTimeout(2000);

  const tag = (n) => `${label}-${n}`;
  const actionRow = "div.max-w-\\[360px\\]";

  // 01 Send form
  await page.click(`${actionRow} > button:has-text('Send')`);
  await shot(page, tag("01-send-form"));

  // 02 Send review
  await page.fill('input[placeholder="G... or user*domain.com"]', seed.counterpartyPublic);
  await page.fill('input[placeholder="0.00"]', "25");
  await page.waitForTimeout(300);
  await page.click('button:has-text("Review Transfer")');
  await shot(page, tag("02-send-review"));
  await closeModal(page);

  // 03 Receive
  await page.click(`${actionRow} > button:has-text('Receive')`);
  await shot(page, tag("03-receive"));
  await closeModal(page);

  // 04 Add Asset
  await page.click(`${actionRow} > button:has-text('Add')`);
  await shot(page, tag("04-add-asset"));
  await closeModal(page);

  // 05 Batch send
  await page.click('button:has-text("Multi-Send")');
  await shot(page, tag("05-batch-send"));
  await closeModal(page);

  // 06 Asset detail
  await page.click("text=Stellar Lumens");
  await shot(page, tag("06-asset-detail"));
  await closeModal(page);

  // 07 Tx detail
  try {
    await page.locator("text=Received Payment").first().click({ timeout: 3000 });
    await shot(page, tag("07-tx-detail"));
    await closeModal(page);
  } catch { skipped.push(tag("07-tx-detail")); }

  if (label === "desktop") {
    // 08 Currency converter (sidebar footer icon)
    await page.click('[title="Live Currency Converter & Calculator"]');
    await shot(page, tag("08-converter"));
    await closeModal(page);

    // 09 Network stats (latency pill)
    await page.click('[title="Click to view network performance & gas savings"]');
    await shot(page, tag("09-network-stats"));
    await closeModal(page);

    // 10 Keyboard shortcuts
    await page.keyboard.press("?");
    await shot(page, tag("10-shortcuts"));
    await closeModal(page);

    // 11 Network switch
    await page.click('[title="Switch Network"]');
    await shot(page, tag("11-network"));
    await closeModal(page);

    // 12 Command palette
    await page.keyboard.press("Meta+k");
    await shot(page, tag("12-palette"));
    await closeModal(page);

    // 13 Add account
    await page.locator('button:text-is("+ Add")').first().click();
    await shot(page, tag("13-add-account"));
    await closeModal(page);

    // 14 Trezor
    await page.click('[title="Open Trezor Hardware Suite"]');
    await shot(page, tag("14-trezor"));
    await closeModal(page);

    // 15 Settings → Rename account
    await page.keyboard.press("Meta+4");
    await page.waitForTimeout(800);
    try {
      await page.locator('button:has-text("Rename")').first().click({ timeout: 4000 });
      await shot(page, tag("15-rename"));
      await closeModal(page);
    } catch { skipped.push(tag("15-rename")); }

    // 16 Settings → Reset wallet (Danger Zone)
    try {
      await page.locator('text=Reset Wallet').last().scrollIntoViewIfNeeded({ timeout: 4000 });
      await page.waitForTimeout(200);
      await page.locator('button:has-text("Reset Wallet"), div:has-text("Reset Wallet")').last().click({ timeout: 4000 });
      await page.waitForTimeout(400);
      const open = await page.locator('[role="dialog"]').count();
      if (open) await shot(page, tag("16-reset"));
      else skipped.push(tag("16-reset"));
      await closeModal(page);
    } catch { skipped.push(tag("16-reset")); }

    // 17 Settings → Paper wallet (reveal secret → print certificate)
    try {
      const revealBtn = page.locator('button:has-text("Reveal")').first();
      await revealBtn.scrollIntoViewIfNeeded({ timeout: 4000 });
      await revealBtn.click({ timeout: 4000 });
      const pwInput = page.locator('[role="dialog"] input[type="password"], input[type="password"]').first();
      await pwInput.fill(PASSWORD, { timeout: 4000 });
      await pwInput.press("Enter");
      await page.waitForTimeout(1200);
      await page.locator('text=Print Paper Wallet').first().click({ timeout: 4000 });
      await shot(page, tag("17-paper-wallet"));
      await closeModal(page);
    } catch { skipped.push(tag("17-paper-wallet")); }
  }

  await context.close();
}

await run("desktop", { width: 1280, height: 900 });
await run("mobile", { width: 390, height: 844 });
await browser.close();
console.log("skipped:", skipped.length ? skipped.join(", ") : "none");
console.log("done");
