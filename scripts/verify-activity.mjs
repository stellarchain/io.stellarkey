import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const seed = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));
mkdirSync("/tmp/shots/activity", { recursive: true });
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
  await page.waitForTimeout(2200);
  return { context, page };
}

// Desktop: home (mini-feed) + activity page
{
  const { context, page } = await boot({ width: 1280, height: 900 });
  await page.screenshot({ path: "/tmp/shots/activity/desktop-home.png" });
  await page.locator('button:has-text("Activity")').first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "/tmp/shots/activity/desktop-activity.png" });
  await context.close();
}

// Mobile: activity tab
{
  const { context, page } = await boot({ width: 390, height: 844 });
  await page.locator('nav[aria-label="Tabs"] button:has-text("Activity")').click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "/tmp/shots/activity/mobile-activity.png" });
  await context.close();
}

await browser.close();
console.log("done");
