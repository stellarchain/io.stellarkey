import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
mkdirSync("/tmp/shots/paper", { recursive: true });
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
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
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

async function shot(name) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `/tmp/shots/paper/${name}.png` });
  console.log("shot:", name);
}

// Open wizard → paper method → password → secure → open certificate
await page.locator("text=Settings").first().click();
await page.waitForSelector("text=Backup & Recovery", { timeout: 8000 });
await page.locator(".list-group button", { hasText: "Backup & Recovery" }).first().click();
await page.waitForTimeout(400);
await page.locator('button:has-text("Back Up Wallet")').click();
await page.locator('button:has-text("Paper Wallet")').click();
await page.fill('[role="dialog"] input[type="password"]', PASSWORD);
await page.locator('button:has-text("Verify & Reveal")').click();
await page.waitForTimeout(600);
await page.locator('button:has-text("Open Printable Certificate")').click();
await page.waitForTimeout(900);
await shot("01-paper-modal");

// Capture the print document via the popup Blob URL
const popupPromise = context.waitForEvent("page", { timeout: 8000 });
await page.locator('button:has-text("Export PDF Certificate")').click();
const popup = await popupPromise;
await popup.waitForLoadState("load");
const html = await popup.content();
writeFileSync("/tmp/shots/paper/cert.html", html);
await popup.close();

// Render the document to a real PDF exactly as the browser would print it
const printPage = await context.newPage();
await printPage.setContent(html, { waitUntil: "load" });
await printPage.waitForTimeout(600);
await printPage.pdf({
  path: "/tmp/shots/paper/cert.pdf",
  landscape: true,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
});
await printPage.close();
console.log("pdf written");

// Encrypted export → capture the download and inspect the payload
const downloadPromise = page.waitForEvent("download", { timeout: 8000 });
await page.locator('button:has-text("Download encrypted file instead")').click();
const download = await downloadPromise;
const dlPath = await download.path();
const payload = JSON.parse(readFileSync(dlPath, "utf8"));
console.log("download filename:", download.suggestedFilename());
console.log("payload keys:", Object.keys(payload).join(", "));
console.log("has address:", typeof payload.address === "string" && payload.address.startsWith("G"));
console.log("has crypto:", Boolean(payload.crypto && payload.crypto.ciphertext));

await browser.close();
console.log("done");
