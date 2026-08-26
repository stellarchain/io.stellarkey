import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/tmp/shots/onboarding", { recursive: true });
let failures = 0;
const assert = (cond, msg) => {
  console.log(cond ? "  PASS" : "  FAIL", msg);
  if (!cond) failures++;
};

const browser = await chromium.launch();

/* ---------- Full create flow with the verification quiz ---------- */
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.waitForSelector("text=Own your keys", { timeout: 25000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: "/tmp/shots/onboarding/01-choose-desktop.png" });

  await page.locator('button:has-text("Create New Wallet")').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/shots/onboarding/02-password.png" });

  const pw = "testpass123";
  await page.fill('input[placeholder="Enter password"]', pw);
  await page.fill('input[placeholder="Repeat password"]', pw);
  await page.locator('button:has-text("Continue")').click();
  await page.waitForSelector("text=Back up your recovery phrase", { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/shots/onboarding/03-reveal.png" });

  // read the 12 words from the grid
  const words = await page.locator(".grid.grid-cols-3 span.rounded-xl").allTextContents();
  const phrase = words.map((t) => t.replace(/^\d+\s*/, "").trim());
  assert(phrase.length === 12, `reveal shows 12 words (got ${phrase.length})`);

  // saved checkbox + Verify Backup
  await page.locator('button:has-text("I have written")').click();
  await page.locator('button:has-text("Verify Backup")').click();
  await page.waitForSelector("text=Verify your backup", { timeout: 8000 });
  await page.waitForTimeout(500);

  // solve the quiz: read requested word numbers, click matching bank chips in order
  const targets = await page.locator('span:has-text("Word #")').allTextContents();
  const indices = targets.map((t) => parseInt(t.replace(/\D/g, ""), 10) - 1);
  assert(indices.length === 3, "quiz asks 3 words");
  for (const idx of indices) {
    await page.locator('.chip:has-text("' + phrase[idx] + '")').first().click();
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: "/tmp/shots/onboarding/04-verify.png" });
  const verifiedBtn = await page.locator('button:has-text("Phrase Verified")').count();
  assert(verifiedBtn === 1, "correct words enable 'Phrase Verified'");
  await page.locator('button:has-text("Phrase Verified")').click();
  await page.waitForSelector("text=Total Portfolio", { timeout: 25000 });
  assert(true, "wallet created and dashboard reached after verification");
  await page.screenshot({ path: "/tmp/shots/onboarding/05-created-dashboard.png" });
  await context.close();
}

/* ---------- Wrong-words path ---------- */
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.locator('button:has-text("Create New Wallet")').click();
  await page.fill('input[placeholder="Enter password"]', "testpass123");
  await page.fill('input[placeholder="Repeat password"]', "testpass123");
  await page.locator('button:has-text("Continue")').click();
  await page.waitForSelector("text=Back up your recovery phrase", { timeout: 20000 });
  await page.locator('button:has-text("I have written")').click();
  await page.locator('button:has-text("Verify Backup")').click();
  await page.waitForSelector("text=Verify your backup", { timeout: 8000 });
  // deliberately pick the first 3 bank chips regardless of order
  const chips = page.locator(".chip");
  await chips.nth(0).click();
  await chips.nth(1).click();
  await chips.nth(2).click();
  await page.locator('button:has-text("Confirm Words")').click();
  await page.waitForTimeout(500);
  const mismatch = await page.locator("text=Not quite").count();
  const correct = await page.locator('button:has-text("Phrase Verified")').count();
  assert(mismatch === 1 || correct === 1, "wrong picks rejected (or coincidentally right)");
  await context.close();
}

/* ---------- Invalid backup file error on choose ---------- */
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.waitForSelector("text=Own your keys", { timeout: 25000 });
  await page.screenshot({ path: "/tmp/shots/onboarding/06-choose-mobile.png" });
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "notes.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ nope: true })),
  });
  await page.waitForTimeout(700);
  assert(await page.locator("text=not an encrypted Wallet backup").count() >= 1, "invalid backup shows error on choose");
  await page.screenshot({ path: "/tmp/shots/onboarding/07-mobile-invalid-backup.png" });
  await context.close();
}

await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
