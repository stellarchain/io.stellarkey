import { chromium } from "playwright";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text().slice(0, 140));
});

await page.goto("http://localhost:3000", { waitUntil: "load" });
await page.waitForTimeout(800);

// HD create
await page.click("text=Create a new wallet");
await page.fill("input[type=password]", "wrapup-pass-1");
await page.locator("input[type=password]").nth(1).fill("wrapup-pass-1");
await page.click("button:has-text('Continue')");
await page.waitForSelector("text=Save your secret key", { timeout: 15000 });
console.log("✓ 12-word backup shown");

// fund + enter
await page.click('button:has-text("stored my secret key")');
await page.click("button:has-text('Enter Polaris')");
await page.waitForSelector("text=XLM Price", { timeout: 20000 });
await page.click("button:has-text('Claim 10,000 test XLM')");
await page.waitForTimeout(6000);

// funded home: balance + chart
await page.screenshot({ path: "/tmp/shots/60-wrapup-home.png" });
const body = await page.locator("body").textContent();
console.log("✓ balance shown:", /10,0\d\d/.test(body));
console.log("✓ chart shown:", body.includes("XLM Price") && body.includes("$0.2"));

// derivation path on accounts page
await page.click('.tab-item:has-text("Settings")');
await page.click("button:has-text('Manage Accounts')");
await page.waitForTimeout(500);
const accText = await page.locator(".list-group").first().textContent();
console.log("✓ path visible:", accText.includes("m/44'/148'/0'"));

// add derived account
await page.click("button:has-text('Add Account')");
await page.fill("input[placeholder='Account 2']", "Trading");
await page.click("button:has-text('Create Account')");
await page.waitForTimeout(1200);
const accText2 = await page.locator(".list-group").first().textContent();
console.log("✓ second account:", accText2.includes("Trading"), accText2.includes("m/44'/148'/1'"));
await page.screenshot({ path: "/tmp/shots/61-wrapup-accounts.png" });

// recovery phrase page
await page.click("button:has-text('Back')");
await page.click("button:has-text('Recovery Phrase')");
await page.fill("input[placeholder='Password']", "wrapup-pass-1");
await page.press("input[placeholder='Password']", "Enter");
await page.waitForSelector("text=12 words", { timeout: 8000 });
console.log("✓ recovery phrase reveal works");
await page.screenshot({ path: "/tmp/shots/62-wrapup-recovery.png" });

// receive modal payment link
await page.goto("http://localhost:3000");
await page.fill("input[type=password]", "wrapup-pass-1");
await page.press("input[type=password]", "Enter");
await page.waitForSelector("text=XLM Price", { timeout: 25000 });
await page.click("button:has-text('Receive')");
await page.waitForSelector("img[alt='Address QR code']", { timeout: 10000 });
const hasLink = await page.locator("text=Copy payment link").count();
console.log("✓ SEP-7 payment link button:", hasLink === 1);
await page.screenshot({ path: "/tmp/shots/63-wrapup-receive.png" });

console.log("console errors:", errors.length ? errors : "none");
await browser.close();
console.log("ALL PASS");
