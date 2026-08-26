import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
mkdirSync("/tmp/shots/modals2", { recursive: true });
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

async function boot(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
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
  return { context, page };
}

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/shots/modals2/${name}.png` });
  console.log("shot:", name);
}

// Desktop: add-account chips wrap + rename modal
{
  const { context, page } = await boot({ width: 1280, height: 900 });
  await page.locator('button:text-is("+ Add")').first().click();
  await shot(page, "desktop-add-account");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  await page.locator("text=Settings").first().click();
  await page.waitForSelector("text=Address Book", { timeout: 8000 });
  await page.waitForTimeout(400);
  await page.locator(".list-group button", { hasText: "Main" }).first().click();
  await page.waitForTimeout(400);
  await page.locator('button:text-is("Rename")').first().click();
  await shot(page, "desktop-rename");
  await context.close();
}

// Mobile: send form (fee section), send review (rows), tx detail (chips)
{
  const { context, page } = await boot({ width: 390, height: 844 });
  const actionRow = "div.max-w-\\[360px\\]";
  await page.click(`${actionRow} > button:has-text('Send')`);
  await shot(page, "mobile-send-form");
  await page.fill('input[placeholder="G... or user*domain.com"]', seed.counterpartyPublic);
  await page.fill('input[placeholder="0.00"]', "25");
  await page.waitForTimeout(300);
  await page.click('button:has-text("Review Transfer")');
  await page.waitForTimeout(300);
  await page.locator('[role="dialog"]').scrollIntoViewIfNeeded();
  await shot(page, "mobile-send-review");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.locator("text=Received Payment").first().click();
  await shot(page, "mobile-tx-detail");
  await context.close();
}

await browser.close();
console.log("done");
