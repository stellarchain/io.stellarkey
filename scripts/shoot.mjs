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
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(kp.secret()),
  );
  return {
    version: 1,
    accounts: [
      {
        id: "seed0001",
        label,
        publicKey: kp.publicKey(),
        createdAt: Date.now(),
        secret: { salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ct)) },
      },
    ],
    activeAccountId: "seed0001",
  };
}

const PASSWORD = seed.password;
const mainVault = await makeVault(seed.mainSecret, PASSWORD, "Main");
const emptyKp = Sdk.Keypair.random();
const unfundedVault = await makeVault(emptyKp.secret(), PASSWORD, "Fresh");

const initScript = (vaultJson) => `
  window.localStorage.setItem('polaris.vault.v1', ${JSON.stringify(vaultJson)});
  window.localStorage.setItem('polaris.network.v1', 'testnet');
  window.localStorage.setItem('polaris.privacy.v1', '0');
`;

const browser = await chromium.launch();
const BASE = "http://localhost:3000";
let n = 0;
const results = [];

async function shot(name, fn, opts = {}) {
  n++;
  const id = String(n).padStart(2, "0");
  const path = `/tmp/shots/${id}-${name}.png`;
  try {
    const context = await browser.newContext({
      viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 },
      deviceScaleFactor: 2,
    });
    if (opts.storage) {
      await context.addInitScript(initScript(opts.storage));
    }
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await fn(page);
    await page.screenshot({ path, fullPage: opts.mobile });
    results.push(`OK  ${path}`);
    await context.close();
  } catch (e) {
    results.push(`ERR ${id}-${name}: ${e.message.split("\n")[0]}`);
  }
}

async function unlock(page, waitSel = 'text=GOLD') {
  await page.fill("input[type=password]", PASSWORD);
  await page.press("input[type=password]", "Enter");
  await page.waitForSelector(waitSel, { timeout: 25000 });
  await page.waitForTimeout(900);
}

// ---- Onboarding states (clean storage)
await shot("onboarding-hero", async (page) => { await page.waitForTimeout(300); });
await shot("onboarding-create-password", async (page) => {
  await page.click("text=Create a new wallet");
  await page.waitForTimeout(400);
});
await shot("onboarding-import", async (page) => {
  await page.click("text=Import existing");
  await page.waitForTimeout(400);
});
await shot("onboarding-backup-reveal", async (page) => {
  await page.click("text=Create a new wallet");
  await page.fill("input[type=password]", "hunter22345");
  await page.locator("input[type=password]").nth(1).fill("hunter22345");
  await page.click("button:has-text('Continue')");
  await page.waitForSelector("text=Save your secret key", { timeout: 15000 });
  await page.waitForTimeout(400);
});

// ---- Locked
await shot("lock-screen", async () => { void 0; }, { storage: JSON.stringify(mainVault) });

// ---- Funded dashboard
await shot("dashboard-funded", async (page) => {
  await unlock(page);
}, { storage: JSON.stringify(mainVault) });

// ---- Account menu open
await shot("account-menu", async (page) => {
  await unlock(page);
  await page.click("text=Main");
  await page.waitForTimeout(400);
}, { storage: JSON.stringify(mainVault) });

// ---- Send flow
await shot("send-form", async (page) => {
  await unlock(page);
  await page.click("button:has-text('Send')");
  await page.fill(".modal-card input[placeholder='0']", "12.5");
  await page.fill(".modal-card input.input-mono", seed.counterpartyPublic);
  await page.fill(".modal-card input[placeholder*='Exchanges']", "demo memo");
  await page.waitForTimeout(300);
}, { storage: JSON.stringify(mainVault) });

await shot("send-review", async (page) => {
  await unlock(page);
  await page.click("button:has-text('Send')");
  await page.fill(".modal-card input[placeholder='0']", "12.5");
  await page.fill(".modal-card input.input-mono", seed.counterpartyPublic);
  await page.click("button:has-text('Review')");
  await page.waitForTimeout(400);
}, { storage: JSON.stringify(mainVault) });

// ---- Receive QR
await shot("receive-qr", async (page) => {
  await unlock(page);
  await page.click("button:has-text('Receive')");
  await page.waitForSelector("img[alt='Address QR code']");
  await page.waitForTimeout(400);
}, { storage: JSON.stringify(mainVault) });

// ---- Swap
await shot("swap-modal", async (page) => {
  await unlock(page);
  await page.click("button:has-text('Swap')");
  await page.fill(".modal-card input[placeholder='0']", "5");
  await page.waitForTimeout(2200);
}, { storage: JSON.stringify(mainVault) });

// ---- Add asset
await shot("add-asset", async (page) => {
  await unlock(page);
  await page.click("button:has-text('Add asset')");
  await page.fill(".modal-card input[placeholder='USDC']", "FOO");
  await page.fill(".modal-card input[placeholder='G…']", seed.counterpartyPublic);
  await page.waitForTimeout(300);
}, { storage: JSON.stringify(mainVault) });

// ---- Asset detail (click GOLD row)
await shot("asset-detail", async (page) => {
  await unlock(page);
  await page.click("button:has-text('GOLD')");
  await page.waitForSelector("text=Trustline limit");
  await page.waitForTimeout(300);
}, { storage: JSON.stringify(mainVault) });

// ---- Tx detail (first activity row)
await shot("tx-detail", async (page) => {
  await unlock(page);
  await page.click('.tab-item:has-text("Activity")');
  await page.click("section:has-text('Activity') button.row-hover >> nth=0");
  await page.waitForSelector("text=View on explorer");
  await page.waitForTimeout(300);
}, { storage: JSON.stringify(mainVault) });

// ---- Settings tabs
for (const tab of ["Security", "Accounts", "Contacts", "Network"]) {
  await shot(`settings-${tab.toLowerCase()}`, async (page) => {
    await unlock(page);
    await page.click("button[aria-label='Settings']");
    await page.click(`button:text-is('${tab}')`);
    await page.waitForTimeout(350);
    if (tab === "Contacts") {
      await page.fill(".modal-card input[placeholder*='Exchange']", "Cold wallet");
      await page.fill(".modal-card input[placeholder='G…']", seed.counterpartyPublic);
    }
  }, { storage: JSON.stringify(mainVault) });
}

// ---- Command palette
await shot("command-palette", async (page) => {
  await unlock(page);
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(400);
}, { storage: JSON.stringify(mainVault) });

// ---- Unfunded
await shot("dashboard-unfunded", async (page) => {
  await unlock(page, 'text=Activate your account');
}, { storage: JSON.stringify(unfundedVault) });

// ---- Privacy mode
await shot("dashboard-privacy", async (page) => {
  await unlock(page);
  await page.click("button[aria-label='Hide balances']");
  await page.waitForTimeout(400);
}, { storage: JSON.stringify(mainVault) });

// ---- Mobile
await shot("mobile-dashboard", async (page) => {
  await unlock(page);
}, { storage: JSON.stringify(mainVault), mobile: true });

await shot("mobile-send", async (page) => {
  await unlock(page);
  await page.click("button:has-text('Send')");
  await page.fill(".modal-card input[placeholder='0']", "7.5");
  await page.fill(".modal-card input.input-mono", seed.counterpartyPublic);
  await page.waitForTimeout(300);
}, { storage: JSON.stringify(mainVault), mobile: true });

await browser.close();
console.log(results.join("\n"));
