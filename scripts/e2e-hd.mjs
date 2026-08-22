import { chromium } from "playwright";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 160));
});

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

// 1. Create wallet with generated mnemonic
await page.click("text=Create a new wallet");
await page.fill("input[type=password]", "test-hd-pass-1");
await page.locator("input[type=password]").nth(1).fill("test-hd-pass-1");
await page.click("button:has-text('Continue')");
await page.waitForSelector("text=Save your secret key", { timeout: 15000 });
const cells = await page.locator(".panel-inset .grid > span").allTextContents();
const words = cells.map((c) => c.replace(/^\d+/, ""));
console.log("mnemonic words shown:", words.length, "|", words.slice(0, 3).join(" "));
if (words.length !== 12 || words.some((w) => !/^[a-z]+$/.test(w))) throw new Error("expected 12 clean words");
await page.screenshot({ path: "/tmp/shots/40-hd-backup-words.png" });

// confirm + enter
await page.click('button:has-text("stored my secret key")');
await page.click("button:has-text('Enter Polaris')");
await page.waitForTimeout(1200);

// 2. Settings > Recovery Phrase reveal
await page.click('.tab-item:has-text("Settings")');
await page.click("button:has-text('Recovery Phrase')");
await page.fill("input[placeholder='Password']", "test-hd-pass-1");
await page.press("input[placeholder='Password']", "Enter");
await page.waitForSelector("text=12 words", { timeout: 8000 });
const phraseWords = (await page.locator(".list-group .grid > span").allTextContents()).map((c) => c.replace(/^\d+/, ""));
console.log("recovery phrase words:", phraseWords.length);
await page.screenshot({ path: "/tmp/shots/41-settings-recovery.png" });

// 3. Accounts: derivation path visible
await page.press("body", "Escape");
await page.click("button:has-text('Back')");
await page.click("button:has-text('Manage Accounts')");
await page.waitForSelector("text=m/44'/148'/0'", { timeout: 8000 });
const paths = await page.locator("span.mono:has-text(\"m/44\")").allTextContents();
console.log("account paths:", paths.join(","));
await page.screenshot({ path: "/tmp/shots/42-hd-accounts-path.png" });

// 4. Add account -> derives index 1
await page.click("button:has-text('Add Account')");
await page.fill("input[placeholder='Account 2']", "Trading");
await page.click("button:has-text('Create Account')");
await page.waitForSelector("text=m/44'/148'/1'", { timeout: 10000 });
console.log("derived second account at m/44'/148'/1'");
await page.screenshot({ path: "/tmp/shots/43-hd-second-account.png" });

console.log("console errors:", errors.length ? errors : "none");
await browser.close();
console.log("E2E PASS");
