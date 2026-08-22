import { chromium } from "playwright";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 140));
});

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.click("text=Create a new wallet");
await page.fill("input[type=password]", "final-pass-3");
await page.locator("input[type=password]").nth(1).fill("final-pass-3");
await page.click("button:has-text('Continue')");
await page.waitForSelector("text=Save your secret key", { timeout: 15000 });
await page.click('button:has-text("stored my secret key")');
await page.click("button:has-text('Enter Polaris')");
await page.waitForTimeout(2500);

// Chart card present with live data?
await page.waitForSelector("text=XLM Price", { timeout: 15000 });
await page.waitForSelector(".panel svg polyline", { timeout: 15000 });
const price = await page.locator("text=/\\$[0-9]/").first().textContent();
console.log("live price text:", price);
// switch range
await page.click("button:text-is('1M')");
await page.waitForTimeout(1800);
await page.screenshot({ path: "/tmp/shots/50-price-chart.png" });

// accounts path check
await page.click('.tab-item:has-text("Settings")');
await page.click("button:has-text('Manage Accounts')");
await page.waitForTimeout(600);
const accText = await page.locator(".list-group").first().textContent();
console.log("accounts contains path:", accText.includes("m/44'/148'/0'"));
await page.screenshot({ path: "/tmp/shots/51-hd-path-fixed.png" });

// hydration/console errors?
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
