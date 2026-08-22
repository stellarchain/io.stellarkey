import { chromium } from "playwright";

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.click("text=Create a new wallet");
await page.fill("input[type=password]", "path-dbg-7");
await page.locator("input[type=password]").nth(1).fill("path-dbg-7");
await page.click("button:has-text('Continue')");
await page.waitForSelector("text=Save your secret key", { timeout: 15000 });
await page.click('button:has-text("stored my secret key")');
await page.click("button:has-text('Enter Polaris')");
await page.waitForTimeout(1500);
const raw = await page.evaluate(() => localStorage.getItem("polaris.vault.v1"));
console.log("STORED:", raw);
await browser.close();
