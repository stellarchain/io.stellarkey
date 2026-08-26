import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
mkdirSync("/tmp/shots", { recursive: true });
const b64 = (buf) => Buffer.from(buf).toString("base64");

async function makeVault(secretKey, password, label) {
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
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(kp.secret()));
  return {
    version: 1,
    accounts: [
      { id: "seed0001", label, publicKey: kp.publicKey(), createdAt: Date.now(),
        secret: { salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ct)) } },
    ],
    activeAccountId: "seed0001",
  };
}

const PASSWORD = seed.password;
const mainVault = JSON.stringify(await makeVault(seed.mainSecret, PASSWORD, "Main"));

const browser = await chromium.launch();
const BASE = "http://localhost:3000";
const results = [];

async function newPage(opts = {}) {
  const context = await browser.newContext({
    viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 },
    deviceScaleFactor: 2,
  });
  await context.addInitScript((vault) => {
    window.localStorage.setItem("polaris.vault.v1", vault);
    window.localStorage.setItem("polaris.network.v1", "testnet");
    window.localStorage.setItem("polaris.privacy.v1", "0");
  }, mainVault);
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.fill("input[type=password]", PASSWORD);
  await page.press("input[type=password]", "Enter");
  await page.waitForSelector("text=GOLD", { timeout: 25000 });
  await page.waitForTimeout(900);
  return { context, page };
}

async function shot(page, name) {
  await page.screenshot({ path: `/tmp/shots/ui-${name}.png` });
  results.push(`shot ui-${name}.png`);
}

// 1. Send modal + new asset Select (closed)
{
  const { context, page } = await newPage();
  await page.click("button:has-text('Send')");
  await page.waitForTimeout(700);
  await shot(page, "01-send-modal");

  // open the select -> portal listbox
  await page.click('[aria-haspopup="listbox"]');
  await page.waitForTimeout(450);
  await shot(page, "02-select-open");

  // keyboard: ArrowDown + Enter selects next asset, modal stays open
  const before = await page.locator('[aria-haspopup="listbox"]').innerText();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const after = await page.locator('[aria-haspopup="listbox"]').innerText();
  results.push(`select kbd change: "${before.trim()}" -> "${after.trim()}"`);
  const modalVisible = await page.locator('[role="dialog"]').count();
  results.push(`modal still open after Enter: ${modalVisible > 0}`);
  await shot(page, "03-select-changed");

  // re-open, then Escape closes ONLY the listbox, not the modal
  await page.click('[aria-haspopup="listbox"]');
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const listboxes = await page.locator('[role="listbox"]').count();
  const dialogs = await page.locator('[role="dialog"]').count();
  results.push(`Escape: listbox closed=${listboxes === 0}, modal open=${dialogs > 0}`);

  // Escape again closes the modal
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  results.push(`Escape2: dialogs=${await page.locator('[role="dialog"]').count()}`);
  await context.close();
}

// 2. Account menu (Dropdown, portaled) — mobile nav only
try {
  const { context, page } = await newPage({ mobile: true });
  await page.locator('[aria-haspopup="menu"]').first().click();
  await page.waitForTimeout(500);
  await shot(page, "04-account-menu");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  results.push(`dropdown Escape: menus=${await page.locator('[role="menu"]').count()}`);
  await context.close();
} catch (e) {
  results.push(`ERR account-menu: ${e.message.split("\n")[0]}`);
}

// 3. Command palette
{
  const { context, page } = await newPage();
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(500);
  await shot(page, "05-command-palette");
  await context.close();
}

// 4. Receive modal (select inside scrollable modal)
{
  const { context, page } = await newPage();
  await page.click("button:has-text('Receive')");
  await page.waitForSelector("img[alt='Address QR code']");
  await page.waitForTimeout(400);
  await shot(page, "06-receive-modal");
  await context.close();
}

// 5. Swap page selects (sm variant)
try {
  const { context, page } = await newPage();
  await page.click('button:has-text("DEX Swap")');
  await page.waitForTimeout(800);
  await page.locator('[aria-haspopup="listbox"]').first().click();
  await page.waitForTimeout(450);
  await shot(page, "07-swap-select-open");
  await context.close();
} catch (e) {
  results.push(`ERR swap: ${e.message.split("\n")[0]}`);
}

// 6. Currency converter (md fixed-width selects)
try {
  const { context, page } = await newPage();
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(400);
  await page.keyboard.type("converter");
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  const dlg = await page.locator('[role="dialog"]').count();
  results.push(`converter open via palette: ${dlg > 0}`);
  if (dlg > 0) {
    await page.locator('[aria-haspopup="listbox"]').first().click();
    await page.waitForTimeout(450);
    await shot(page, "08-converter-select-open");
  }
  await context.close();
} catch (e) {
  results.push(`ERR converter: ${e.message.split("\n")[0]}`);
}

await browser.close();
console.log(results.join("\n"));
