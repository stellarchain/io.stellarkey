import { spawn } from "node:child_process";
import { chromium } from "playwright";

console.log("Starting Next.js server for automated verification...");
const server = spawn("npm", ["run", "start"], {
  stdio: "pipe",
  env: { ...process.env, PORT: "3456" },
});

let serverReady = false;
server.stdout.on("data", (data) => {
  const str = data.toString();
  if (str.includes("Ready") || str.includes("localhost") || str.includes("3456")) {
    serverReady = true;
  }
});

for (let i = 0; i < 30; i++) {
  if (serverReady) break;
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type === "error") {
    consoleErrors.push(msg.text());
  }
});

page.on("response", (res) => {
  if (res.status() >= 400) {
    console.log("HTTP Error:", res.status(), res.url());
  }
});

try {
  console.log("Navigating to Wallet app...");
  await page.goto("http://localhost:3456", { waitUntil: "networkidle" });

  // 1. Onboarding Flow Verification
  console.log("Testing Onboarding Flow...");
  await page.waitForSelector("text=Create New Wallet");
  await page.click("button:has-text('Create New Wallet')");

  await page.waitForSelector("text=Create Your Password");
  await page.fill("input[placeholder='Enter password']", "SuperSecurePass123!");
  await page.fill("input[placeholder='Repeat password']", "SuperSecurePass123!");
  await page.click("button:has-text('Continue to Secret Phrase')");

  await page.waitForSelector("text=Save Your Recovery Phrase");
  await page.click("text=I have written down");
  await page.click("button:has-text('Enter Wallet')");

  // 2. Account Activation & Friendbot Funding
  console.log("Testing Account Activation...");
  await page.waitForSelector("text=Activate your account");
  await page.click("button:has-text('Claim 10,000 Test XLM')");

  await page.waitForSelector("text=Total Portfolio", { timeout: 25000 });
  console.log("Account funded and Total Portfolio loaded!");

  // 3. In-App DEX Swap Page Verification
  console.log("Testing In-App DEX Swap Page...");
  await page.click("nav button:has-text('Swap')");
  await page.waitForSelector("text=In-App Swap");
  await page.click("button[aria-label='Slippage Settings']");
  await page.waitForSelector("text=Slippage Tolerance");
  await page.click("button:has-text('1%')");

  // 4. Explore Ecosystem & dApps Page Verification
  console.log("Testing Explore Ecosystem & dApps Tab...");
  await page.click("nav button:has-text('Explore')");
  await page.waitForSelector("text=Explore dApps & Protocols");
  await page.waitForSelector("text=Soroswap");
  await page.click("button:has-text('Lending & Yield')");
  await page.waitForSelector("text=Blend Protocol");
  await page.click("button:has-text('All Ecosystem')");

  // 5. Activity View Verification & Filters
  console.log("Testing Activity View & Filters...");
  await page.click("nav button:has-text('Activity')");
  await page.waitForSelector("text=Account Activated");
  await page.click("button:text-is('Received')");
  await page.click("button:text-is('Sent')");
  await page.click("button:text-is('Swaps')");
  await page.click("button:text-is('All')");

  // 6. Settings & Auto-lock Verification
  console.log("Testing Settings Page & Preferences...");
  await page.click("nav button:has-text('Settings')");
  await page.waitForSelector("text=Security & Backup");
  await page.waitForSelector("text=Auto-Lock Timer");
  await page.click("button:has-text('Auto-Lock Timer')");
  await page.waitForSelector("text=5 Minutes");
  await page.click("button:has-text('5 Minutes')");
  await page.waitForSelector("text=5 Minutes");

  // 6.5 Hardware Wallets (Trezor & Ledger) Hub Verification
  console.log("Testing Hardware Wallets (Trezor & Ledger) Hub...");
  await page.click("nav button:has-text('Settings')");
  await page.click("button:has-text('Hardware Wallets')");
  await page.waitForSelector("text=Trezor");
  await page.waitForSelector("text=Safe 3 · Model T · Model One");
  await page.waitForSelector("text=Ledger");

  // Connect Trezor Device
  await page.click("button:has-text('Connect Trezor Device')");
  await page.waitForSelector("text=Trezor");
  await page.click("button:has-text('Connect Trezor via WebUSB')");
  await page.waitForSelector("text=✓ Device Connected");
  await page.click("button:has-text('Import Hardware Account')");
  await page.waitForTimeout(500);

  // Return to Settings
  await page.click("nav button:has-text('Settings')");

  // 7. Address Book (Contacts) Verification
  console.log("Testing Address Book / Contacts...");
  await page.click("button:has-text('Address Book')");
  await page.click("text=+ Add New Contact");
  await page.fill("input[placeholder*='Alice']", "Treasury Alpha");
  await page.fill(
    "input[placeholder*='G...']",
    "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  );
  await page.click("button:has-text('Save Contact')");
  await page.waitForSelector("text=Treasury Alpha");

  // Return to Settings Accounts and switch back to Account 1
  await page.click("nav button:has-text('Settings')");
  await page.click("button:has-text('Accounts')");
  await page.click("button:has-text('Main Account')");
  await page.waitForTimeout(300);

  // Return to Home
  await page.click("nav button:has-text('Home')");
  await page.waitForSelector("text=Total Portfolio");

  // 8. Modals: Send and Receive
  console.log("Testing Send & Receive Modals...");
  await page.click("button:has-text('Receive')");
  await page.waitForSelector("text=Receive Funds");
  await page.click("button:has-text('Set Amount / Memo')");
  await page.waitForSelector("text=Dynamic Payment Request");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await page.click("button:has-text('Send')");
  await page.waitForSelector("text=Send Payment");
  await page.waitForSelector("text=Treasury Alpha"); // Quick contact chip
  await page.keyboard.press("Escape");

  // 9. Keyboard Shortcuts Hotkey Verification
  console.log("Testing Keyboard Shortcuts & Hotkeys...");
  await page.keyboard.press("?");
  await page.waitForSelector("text=Keyboard Shortcuts");
  await page.keyboard.press("Escape");

  // 10. Responsive Viewport Checks (Mobile & iPad)
  console.log("Testing Mobile & Tablet Viewports...");
  await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14 Pro
  await page.waitForSelector("nav.tab-bar");
  await page.click("nav.tab-bar button:has-text('Explore')");
  await page.waitForSelector("text=Explore dApps & Protocols");
  await page.click("nav.tab-bar button:has-text('Activity')");
  await page.waitForSelector("text=Account Activated");

  await page.setViewportSize({ width: 820, height: 1180 }); // iPad Air
  await page.click("nav button:has-text('Home')");
  await page.waitForSelector("text=Total Portfolio");

  console.log("All UI and Functional checks passed perfectly across Desktop, Tablet & Mobile!");
} catch (err) {
  console.error("Test error:", err);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
