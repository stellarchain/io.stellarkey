/**
 * Builds the promo's starting state inside a persistent browser profile.
 *
 * The merchant store is encrypted and lives outside localStorage, so it cannot
 * be seeded from Node — the state has to be grown through the app's own UI and
 * then kept, which is what the profile is for. record.mjs reuses it.
 */
import { chromium } from "playwright";
import { account, keepVault, forget, PASSWORD, PROFILE, BASE } from "./seed.mjs";
import { customer, pay } from "./pay.mjs";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";

const FRESH = process.argv.includes("--fresh");
if (FRESH) { rmSync(PROFILE, { recursive: true, force: true }); forget(); }
mkdirSync(PROFILE, { recursive: true });
const { kp, vault, reused } = await account({ fresh: FRESH });
console.log(`account ${kp.publicKey()} (${reused ? "reused" : "funded"})`);

const ctx = await chromium.launchPersistentContext(PROFILE, {
  viewport: { width: 1440, height: 900 },
  args: ["--force-device-scale-factor=1"],
});
const p = ctx.pages()[0] ?? (await ctx.newPage());
const cachedVault = existsSync("/tmp/promo/vault.json") ? readFileSync("/tmp/promo/vault.json", "utf8") : null;
await ctx.addInitScript(([v, cached]) => {
  if (cached) localStorage.setItem("stellarkey.vault.v1", cached);
  else if (!localStorage.getItem("stellarkey.vault.v1")) localStorage.setItem("stellarkey.vault.v1", v);
  localStorage.setItem("stellarkey.network.v1", "testnet");
}, [vault, cachedVault]);
await p.goto(BASE, { waitUntil: "domcontentloaded" });
const pw = p.locator('input[type="password"]').first();
await pw.waitFor({ state: "visible", timeout: 20000 });
await pw.fill(PASSWORD);
await p.getByRole("button", { name: /^Unlock Vault$/ }).click();
await p.waitForTimeout(6000);
await p.screenshot({ path: "/tmp/promo/prep-boot.png" });
console.log("url:", p.url(), "| buttons:", (await p.evaluate(() => [...document.querySelectorAll("button")].filter(b=>b.offsetParent).map(b=>(b.innerText||b.getAttribute("aria-label")||"").replace(/\s+/g," ").trim().slice(0,26)).filter(Boolean))).slice(0,14).join(" | "));

const shot = (n) => p.screenshot({ path: `/tmp/promo/prep-${n}.png` });
const dlg = () => p.locator('[role="dialog"]');
const btn = (re, scope) => (scope ?? p).getByRole("button", { name: re }).first();

// ---------------------------------------------------------------- onboarding
if (!(await btn(/^Merchant$/).count())) {
  console.log("running merchant onboarding…");
  await btn(/^Settings$/).click();
  await p.waitForTimeout(1200);
  await p.locator("main button").filter({ hasText: "Merchant Mode" }).first().click();
  await p.waitForTimeout(1500);

  for (let step = 1; step <= 6 && (await dlg().count()); step++) {
    const fill = async (label, value) => {
      const f = p.getByLabel(label, { exact: true });
      if ((await f.count()) && (await f.first().isVisible()) && !(await f.first().inputValue())) {
        await f.first().fill(value);
        await p.waitForTimeout(150);
      }
    };
    await fill("Shop name", "Meridian Coffee");
    await fill("Address, one line each", "27 Rua da Prata\n1100-062 Lisboa");
    await fill("Tax ID", "PT514902663");
    await fill("Terminal name", "Counter iPad");
    await fill("Staff PIN", "2468");
    await fill("Confirm staff PIN", "2468");

    // XLM only: a fresh testnet account has no USDC trustline, and the
    // settlement asset has to be one the till accepts.
    const usdc = p.locator('[role="dialog"] button').filter({ hasText: /^Accept USDC/ }).first();
    if ((await usdc.count()) && (await usdc.isVisible())) {
      const on = await usdc.evaluate((el) => el.getAttribute("aria-checked") === "true" || !!el.querySelector('[aria-checked="true"]'));
      if (on !== false) { await usdc.click(); await p.waitForTimeout(400); }
    }
    const settle = btn(/^Settlement asset/);
    if ((await settle.count()) && (await settle.isVisible())) {
      if (!/XLM/.test((await settle.innerText()).replace(/\s+/g, " "))) {
        await settle.click();
        await p.waitForTimeout(400);
        const opt = p.getByRole("option", { name: /XLM/ }).first();
        if (await opt.count()) await opt.click();
        await p.waitForTimeout(400);
      }
    }
    await shot(`onb-${step}`);
    const next = p.locator('[role="dialog"] button')
      .filter({ hasText: /^(Continue|Open the till|Done|Finish)$/ }).first();
    if (!(await next.count()) || (await next.isDisabled())) { console.log(`  stuck at step ${step}`); break; }
    await next.click();
    await p.waitForTimeout(1800);
  }
}
await p.waitForTimeout(2000);
console.log("merchant tab present:", (await btn(/^Merchant$/).count()) > 0);
// The migration to v3 has happened by now; keep that exact vault, because the
// merchant key is wrapped inside it.
await keepVault(p);

// ------------------------------------------------------------------- the till
await btn(/^Merchant$/).click();
await p.waitForTimeout(2000);
await shot("till");
const tillState = await p.evaluate(() => [...document.querySelectorAll("main button")]
  .filter(b => b.offsetParent).map(b => (b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 30)).filter(Boolean));
console.log("till buttons:", [...new Set(tillState)].join(" | "));

if (await btn(/^Choose staff$/).count()) {
  await btn(/^Choose staff$/).click();
  await p.waitForTimeout(1600);
  await shot("staff");
  const rows = await p.evaluate(() => [...document.querySelectorAll("main button")]
    .filter(b => b.offsetParent).map((b, i) => i + ":" + (b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 44)).filter(x => x.length > 3));
  console.log("staff page:\n  " + rows.join("\n  "));

  // The owner is already rostered by onboarding; what the till waits on is a
  // *current operator*, which is chosen by tapping their avatar and entering
  // the PIN.
  // Scoped past the header's account menu, which also carries the account name.
  const avatar = p.locator("main button:not([aria-haspopup]):visible").filter({ hasText: /Everyday/ }).first();
  if (await avatar.count()) {
    await avatar.click();
    await p.waitForTimeout(1200);
    await shot("operator-pin");
    const pin = p.locator('[role="dialog"] input').first();
    if ((await pin.count()) && (await pin.isVisible())) {
      await pin.fill("2468");
      await p.waitForTimeout(500);
      const ok = p.locator('[role="dialog"] button')
        .filter({ hasText: /^(Select|Unlock|Confirm|Done|Continue|Start)$/ }).first();
      if ((await ok.count()) && !(await ok.isDisabled())) await ok.click();
      await p.waitForTimeout(1500);
    }
  }
  await shot("after-operator");
  const dbtn = await p.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')]
    .filter(b => b.offsetParent).map(b => (b.innerText||"").replace(/\s+/g," ").trim().slice(0,34)).filter(Boolean));
  console.log("dialog buttons:", dbtn.join(" | ") || "(closed)");
  const opCard = await p.evaluate(() => {
    const m = document.querySelector("main");
    return m ? (m.innerText.match(/CURRENT OPERATOR[\s\S]{0,90}/) || [""])[0].replace(/\s+/g, " ") : "";
  });
  console.log("operator card:", opCard);
}

// Operator locking defaults to "after every sale", which would put a PIN pad
// between each sale. Timeout locking keeps the till open for the run.
{
  const lock = p.locator("main button").filter({ hasText: /^Operator locking/ }).first();
  if (await lock.count()) {
    await lock.click();
    await p.waitForTimeout(1200);
    await shot("lock-modal");
    const opts = await p.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')]
      .filter(b => b.offsetParent).map(b => (b.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean));
    console.log("lock options:", opts.join(" | "));
    const timeout = p.locator('[role="dialog"] button').filter({ hasText: /^Inactivity$/ }).first();
    if (await timeout.count()) { await timeout.click(); await p.waitForTimeout(700); }
    const save = p.locator('[role="dialog"] button').filter({ hasText: /^(Done|Save|Close)$/ }).first();
    if (await save.count()) await save.click();
    else await p.keyboard.press("Escape");
    await p.waitForTimeout(1000);
  }
}

// ------------------------------------------------------------------- shift
await btn(/^Point of Sale$/).click();
await p.waitForTimeout(1600);
if (await btn(/^Open shift$/).count()) {
  await btn(/^Open shift$/).click();
  await p.waitForTimeout(1400);
  await shot("shift-dialog");
  const f = await p.evaluate(() => [...document.querySelectorAll('[role="dialog"] input')]
    .filter(x => x.offsetParent).map(x => `${x.getAttribute("aria-label") || x.placeholder || ""}`));
  const bs = await p.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')]
    .filter(x => x.offsetParent).map(x => (x.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean));
  console.log("shift fields:", f.join(" | ") || "(none)");
  console.log("shift buttons:", bs.join(" | "));
  const float = p.locator('[role="dialog"] input').first();
  if (await float.count()) { await float.fill("50.00"); await p.waitForTimeout(300); }
  await p.locator('[role="dialog"] button').filter({ hasText: /^Open shift$/ }).first().click();
  await p.waitForTimeout(2000);
}
await shot("till-open");
const tillNow = await p.evaluate(() => [...document.querySelectorAll("main button")]
  .filter(b => b.offsetParent).map(b => (b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 24)).filter(Boolean));
console.log("till now:", [...new Set(tillNow)].join(" | "));

// ------------------------------------------------------- a day of real sales
const payer = await customer();
console.log("customer", payer.publicKey());

const key = async (d) => {
  await p.getByRole("button", { name: new RegExp(`^${d}$`) }).first().click();
  await p.waitForTimeout(120);
};

/** Ring up one sale and settle it with a real testnet payment. */
async function sell(digits, tip) {
  // Nothing may be over the keypad: a leftover sheet swallows every tap.
  for (let i = 0; i < 8 && (await p.locator('[role="dialog"]').count()); i++) {
    await p.keyboard.press("Escape");
    await p.waitForTimeout(400);
  }
  for (const d of digits) await key(d);
  await btn(/^Add to ticket$/).click();
  await p.waitForTimeout(700);
  await p.locator("main button").filter({ hasText: /^Charge / }).first().click();
  await p.waitForTimeout(1400);

  // The tip prompt comes before the QR. Presets are percentages, so their
  // amounts move with the ticket — pick by position, never by value.
  const noTip = p.locator('[role="dialog"] button').filter({ hasText: /^No tip$/ }).first();
  if (await noTip.count()) {
    if (tip === "none") await noTip.click();
    else {
      const presets = p.locator('[role="dialog"] button').filter({ hasText: /^[\d.,]+\s/ });
      const n = await presets.count();
      await (n ? presets.nth(Math.min(tip, n - 1)) : noTip).click();
    }
    await p.waitForTimeout(1600);
  }

  // Read what the customer is being asked for, straight off the sheet.
  const ask = await p.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    const t = d.innerText;
    const xlm = t.match(/([\d.]+)\s*XLM/);
    const memo = t.match(/\b(MC\d+)\b/);
    const to = [...d.querySelectorAll("*")].map((e) => e.textContent || "").join(" ");
    void to;
    return { xlm: xlm && xlm[1], memo: memo && memo[1] };
  });
  if (!ask?.xlm || !ask?.memo) {
    await shot("charge-unreadable");
    console.log("  could not read the charge");
    return false;
  }
  const hash = await pay({ from: payer, destination: kp.publicKey(), amount: ask.xlm, memo: ask.memo });
  console.log(`  ${ask.memo}: ${ask.xlm} XLM paid — ${hash.slice(0, 10)}…`);

  // Wait for the till's own watcher to see it.
  for (let i = 0; i < 30; i++) {
    await p.waitForTimeout(1000);
    const done = await p.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return !d || /\bPaid\b|Payment received|Receipt/i.test(d.innerText);
    });
    if (done) break;
  }
  await shot(`sale-${ask.memo}`);
  // "New charge" starts another sale rather than closing, so dismiss the sheet
  // and come back to the keypad.
  const x = p.locator('[role="dialog"] button[aria-label="Close"]').first();
  if (await x.count()) await x.click();
  else await p.keyboard.press("Escape");
  await p.waitForTimeout(600);
  for (let i = 0; i < 10 && (await p.locator('[role="dialog"]').count()); i++) {
    await p.keyboard.press("Escape");
    await p.waitForTimeout(400);
  }
  await p.waitForTimeout(600);
  return true;
}

// A believable morning: a few coffees, a couple of brunches, mixed tipping.
const DAY = [
  [["3", "2", "0"], "none"],
  [["4", "8", "0"], 1],
  [["1", "2", "5", "0"], 2],
  [["2", "6", "0"], "none"],
  [["9", "4", "0"], 1],
  [["5", "4", "0"], 0],
  [["1", "4", "9", "0"], 2],
];
for (const [digits, tip] of DAY) {
  const ok = await sell(digits, tip);
  if (!ok) break;
}
await shot("day-done");

// ------------------------------------------------- an address book and a book
// Empty screens make poor footage, so the surfaces the tour visits are given
// something real to show.
const esc = async () => {
  for (let i = 0; i < 8 && (await p.locator('[role="dialog"]').count()); i++) {
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
  }
};

try {
  await btn(/^Wallet$/).click();
  await p.waitForTimeout(1200);
  await btn(/^Contacts$/).click();
  await p.waitForTimeout(1200);
  const CONTACTS = [
    ["Alfama Bakery", Sdk.Keypair.random().publicKey()],
    ["Rua Coworking", Sdk.Keypair.random().publicKey()],
    ["Marta Coelho", payer.publicKey()],
  ];
  for (const [name, address] of CONTACTS) {
    const add = p.locator("main button").filter({ hasText: /Add Your First Contact|Add Contact|New Contact/ }).first();
    if (!(await add.count())) break;
    await add.click();
    await p.waitForTimeout(900);
    await p.getByPlaceholder("e.g. Alice").first().fill(name);
    await p.getByPlaceholder("G...").first().fill(address);
    await p.waitForTimeout(300);
    await p.locator('[role="dialog"] button').filter({ hasText: /^Save Contact$/ }).first().click();
    await p.waitForTimeout(1100);
    console.log(`  contact: ${name}`);
  }
  await esc();
} catch (err) {
  console.log("  contacts skipped —", String(err).split("\n")[0].slice(0, 70));
}

try {
  await btn(/^Merchant$/).click();
  await p.waitForTimeout(1300);
  await btn(/^Invoices$/).click();
  await p.waitForTimeout(1300);
  const INVOICES = [
    ["Praça Hotel", "contas@pracahotel.pt", "Weekly wholesale — beans and pastries."],
    ["Baixa Studio", "hello@baixastudio.pt", "Monthly coffee service."],
  ];
  for (const [name, email, note] of INVOICES) {
    const plus = p.locator("main button").filter({ hasText: /^\+$/ }).first();
    if (!(await plus.count())) break;
    await plus.click();
    await p.waitForTimeout(1000);
    await p.getByPlaceholder("Praça Hotel").first().fill(name);
    await p.getByPlaceholder("contas@example.pt").first().fill(email);
    await p.getByPlaceholder("Monthly wholesale order.").first().fill(note);
    const line = p.locator('[role="dialog"] button').filter({ hasText: /Add from the catalogue/ }).first();
    if (await line.count()) {
      await line.click();
      await p.waitForTimeout(900);
      const item = p.locator('[role="dialog"] button').filter({ hasText: /€|\d/ }).nth(2);
      if (await item.count()) { await item.click(); await p.waitForTimeout(700); }
      await esc();
      await p.waitForTimeout(500);
    }
    const save = p.locator('[role="dialog"] button').filter({ hasText: /^Save draft$/ }).first();
    if (await save.count() && !(await save.isDisabled())) {
      await save.click();
      await p.waitForTimeout(1400);
      console.log(`  invoice: ${name}`);
    }
    await esc();
  }
} catch (err) {
  console.log("  invoices skipped —", String(err).split("\n")[0].slice(0, 70));
}
await keepVault(p);
await ctx.close();
