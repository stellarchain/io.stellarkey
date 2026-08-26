import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
mkdirSync("/tmp/shots/book", { recursive: true });
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

const demoContacts = [
  { name: "Zoe", address: Sdk.Keypair.random().publicKey(), favorite: true },
  { name: "Alice", address: Sdk.Keypair.random().publicKey() },
  { name: "Bob", address: Sdk.Keypair.random().publicKey() },
  { name: "Coinbase", address: seed.counterpartyPublic, favorite: true },
  { name: "Treasury Ops", address: Sdk.Keypair.random().publicKey() },
];

const browser = await chromium.launch();

async function boot(viewport, contacts) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await context.addInitScript(
    ({ v, c }) => {
      window.localStorage.setItem("polaris.vault.v1", JSON.stringify(v));
      window.localStorage.setItem("polaris.network.v1", "testnet");
      window.localStorage.setItem("polaris.privacy.v1", "0");
      window.localStorage.setItem("polaris.contacts.v1", JSON.stringify(c));
    },
    { v: vault, c: contacts },
  );
  const page = await context.newPage();
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.fill("input[type=password]", PASSWORD);
  await page.press("input[type=password]", "Enter");
  await page.waitForSelector("text=Total Portfolio", { timeout: 25000 });
  await page.waitForTimeout(1800);
  return { context, page };
}

async function shot(page, name) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `/tmp/shots/book/${name}.png` });
  console.log("shot:", name);
}

// Desktop with contacts
{
  const { context, page } = await boot({ width: 1280, height: 900 }, demoContacts);
  await page.locator('button:has-text("Address Book")').first().click();
  await page.waitForTimeout(500);
  // hover a row to reveal quick actions
  await page.locator('.list-group [role="button"]', { hasText: "Alice" }).first().hover();
  await shot(page, "desktop-book");

  // New contact modal
  await page.click('[aria-label="Add Contact"]');
  await shot(page, "desktop-book-add");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Edit contact modal (click the Coinbase row)
  await page.locator('.list-group [role="button"]', { hasText: "Coinbase" }).first().click();
  await shot(page, "desktop-book-edit");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Send pill → SendModal prefilled
  await page.locator('.list-group [role="button"]', { hasText: "Zoe" }).first().hover();
  await page.waitForTimeout(200);
  await page.locator('.list-group [role="button"]', { hasText: "Zoe" })
    .first()
    .locator('button:has-text("Send")')
    .click({ force: true });
  await shot(page, "desktop-book-send");
  await page.keyboard.press("Escape");

  // Settings root — Address Book row should be gone
  await page.locator("text=Settings").first().click();
  await page.waitForSelector("text=Danger Zone", { timeout: 8000 }).catch(() => {});
  await shot(page, "desktop-settings-root");
  await context.close();
}

// Desktop empty state
{
  const { context, page } = await boot({ width: 1280, height: 900 }, []);
  await page.locator('button:has-text("Address Book")').first().click();
  await shot(page, "desktop-book-empty");
  await context.close();
}

// Mobile
{
  const { context, page } = await boot({ width: 390, height: 844 }, demoContacts);
  await page.locator('nav[aria-label="Tabs"] button:has-text("Contacts")').click();
  await shot(page, "mobile-book");
  await context.close();
}

await browser.close();
console.log("done");
