/**
 * Records the promo, in two passes.
 *
 * Everything on screen is real: a funded testnet account, a day of sales rung
 * up through the till, and a payment submitted to Horizon mid-take so the
 * charge settles on camera rather than being faked. Annotations are injected
 * into the running app (overlay.js) so they composite in its own type.
 *
 * Captured at 1728×1080 → /tmp/promo/video/desktop, encoded by build.mjs.
 *
 * The running order gives the wallet and the till the same number of features,
 * because the point of the product is that they are one app, not a wallet with
 * a bolt-on.
 */
import { chromium } from "playwright";
import { open, account } from "./seed.mjs";
import { customer, pay } from "./pay.mjs";
import { makeDriver, makeLogger } from "./driver.mjs";
import { readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";

const ROOT = "/tmp/promo/video";
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(`${ROOT}/desktop`, { recursive: true });

const OVERLAY = readFileSync(new URL("./overlay.js", import.meta.url), "utf8");
const LOG = "/tmp/promo/run.log";
writeFileSync(LOG, "");
const t0 = Date.now();
const log = makeLogger(LOG, t0);

const { kp } = await account();
const payer = await customer();
const allBeats = [];

{
  const { ctx, p } = await open(chromium, {
    video: `${ROOT}/desktop`,
    viewport: { width: 1728, height: 1080 },
  });
  p.setDefaultTimeout(7000);
  const d = makeDriver(p, { log, overlay: OVERLAY });
  const { beat, tap, note, caption, clear, wait, promo, escape, side, ui } = d;
  await d.install();
  await wait(2600); // let balances and the market line land before the reveal

  await beat("title", async () => {
    await promo("chapter", "Stellar · self-custody", "Your keys. Your counter.",
      "A wallet that holds your money and a till that takes it — both on this device.");
    await wait(4300);
    await promo("chapterOut");
    await wait(600);
  });

  await beat("home", async () => {
    await promo("tick", 1, "The wallet", 0.04);
    await caption("ON THIS DEVICE", "Keys never leave",
      "The vault is encrypted in this browser. No account, no server, no custodian.");
    await wait(2900);
    await clear();
  });

  await beat("privacy", async () => {
    const eye = p.getByRole("button", { name: /Hide balances|Show balances/ }).first();
    if (await eye.count()) {
      await tap(eye, { settle: 900 });
      await caption("PRIVACY", "Blank the numbers",
        "Hide every balance for a shoulder-surfer, a screen share, or a shared desk.");
      await wait(2400);
      await clear();
      await tap(eye, { settle: 800 });
    }
  });

  await beat("palette", async () => {
    await p.keyboard.press("Meta+k");
    await wait(900);
    await note('[role="dialog"]', "⌘K", "Everything, one keystroke away",
      "Send, swap, switch account, open the till — the whole app from the keyboard.", "right");
    await wait(2900);
    await clear();
    await escape();
  });

  await beat("multisend", async () => {
    await promo("tick", 2, "Paying", 0.1);
    await tap(p.getByRole("button", { name: /^Multi-Send$/ }).first(), { settle: 1000 });
    await note('[role="dialog"]', "BATCH", "Many recipients, one transaction",
      "Disperse payroll or splits in a single atomic transaction. Paste a CSV and go.", "right");
    await wait(2900);
    await clear();
    await escape();
  });

  await beat("addasset", async () => {
    await tap(p.getByRole("button", { name: /^\+ Add Asset$/ }).first(), { settle: 1000 });
    await note('[role="dialog"]', "TRUSTLINES", "Add assets atomically",
      "Queue several verified assets and open every trustline in one transaction.", "right");
    await wait(2700);
    await clear();
    await escape();
  });

  await beat("receive", async () => {
    await tap(p.getByRole("button", { name: /^Receive$/ }).first(), { settle: 800 });
    await note('[role="dialog"]', "SEP-7", "A QR anyone can pay",
      "Address and amount in one code, readable by any Stellar wallet.", "right");
    await wait(2600);
    await clear();
    await escape();
  });

  await beat("send", async () => {
    await tap(p.getByRole("button", { name: /^Send$/ }).first(), { settle: 900 });
    await p.getByPlaceholder(/^G\.\.\./).first().fill(payer.publicKey());
    await wait(400);
    await p.getByPlaceholder("0.00").first().fill("120");
    await wait(300);
    await p.getByPlaceholder(/Max 28 bytes/).first().fill("Coffee");
    await note('[role="dialog"]', "SEND", "Address, amount, memo",
      "Signed on this device with the key in your vault, then handed to Horizon.", "right");
    await wait(2500);
    await clear();
    const review = p.locator('[role="dialog"] button').filter({ hasText: /^Review Transfer$/ }).first();
    if ((await review.count()) && !(await review.isDisabled())) {
      await tap(review, { settle: 1300 });
      await note('[role="dialog"]', "BEFORE YOU SIGN", "Nothing hidden",
        "Fee, destination and memo are all shown before a signature is made.", "right");
      await wait(2700);
      await clear();
    }
    await escape();
  });

  await beat("swap", async () => {
    await tap(side("DEX Swap"), { settle: 1100 });
    const amount = p.locator('main input[inputmode="decimal"]').first();
    if (await amount.count()) { await amount.fill("250"); await wait(500); }
    await caption("STELLAR DEX", "Swap on-chain",
      "Path payments through Stellar's own order books. No bridge, no wrapper.");
    await wait(2700);
    await clear();
  });

  await beat("contacts", async () => {
    await tap(side("Contacts"), { settle: 1100 });
    await caption("ADDRESS BOOK", "Names, not 56 characters",
      "Saved locally, so a regular payee is two taps instead of a paste.");
    await wait(2500);
    await clear();
  });

  await beat("activity", async () => {
    await tap(side("Activity"), { settle: 1200 });
    await caption("HORIZON", "Every payment, verifiable",
      "History is read from the network, not a database somebody else owns.");
    await wait(2700);
    await clear();
  });

  await beat("security", async () => {
    await promo("tick", 3, "Security", 0.3);
    await tap(side("Settings"), { settle: 1300 });
    await caption("SECURITY HEALTH", "Scored, not assumed",
      "AES-256, PBKDF2-GCM, auto-lock — the wallet grades its own posture.");
    await wait(2800);
    await clear();
  });

  const openSetting = async (label) => {
    const b = p.locator("main button").filter({ hasText: label }).first();
    if (await b.count()) { await tap(b, { settle: 1200 }); return true; }
    return false;
  };

  await beat("backup", async () => {
    if (await openSetting(/Backup & Recovery/)) {
      await note('[role="dialog"]', "RECOVERY", "One guided flow",
        "Recovery phrase, encrypted export, and a health check that tells you where you stand.", "right");
      await wait(2700);
      await clear();
      await escape();
    }
    await tap(side("Settings"), { settle: 900 });
  });

  await beat("hardware", async () => {
    if (await openSetting(/Hardware Wallets/)) {
      await caption("COLD STORAGE", "Trezor, on device",
        "Sign with a hardware wallet. The private key never touches the browser.");
      await wait(2600);
      await clear();
    }
    await tap(side("Settings"), { settle: 900 });
  });

  await beat("multisig", async () => {
    if (await openSetting(/Multi-Sig Studio/)) {
      await note('[role="dialog"]', "SHARED CONTROL", "Signers and thresholds",
        "Add co-signers, set weights, and collect approvals for an account you share.", "right");
      await wait(2800);
      await clear();
      await escape();
    }
  });

  /* ─────────────────────────────────────────────── merchant ─────────────── */
  await beat("merchant-card", async () => {
    await promo("tickOff");
    await promo("chapter", "Merchant mode", "Now open the till.",
      "The same account, the same device — with a point of sale on top of it.");
    await wait(3900);
    await promo("chapterOut");
    await wait(500);
  });

  await beat("switch", async () => {
    await promo("tick", 4, "Point of sale", 0.55);
    await tap(p.getByRole("button", { name: /^Merchant$/ }).first(), { settle: 1500 });
  });

  await beat("operator", async () => {
    if (await p.locator('main button:has-text("Choose staff")').count()) {
      await tap(p.getByRole("button", { name: /^Choose staff$/ }).first(), { settle: 1200 });
      const avatar = p.locator("main button:not([aria-haspopup]):visible").filter({ hasText: /Everyday/ }).first();
      if (await avatar.count()) {
        await avatar.click();
        await wait(900);
        await note('[role="dialog"]', "OPERATOR", "PIN-gated, on device",
          "A PIN attributes the till's actions. It authorises the counter, never a signature.", "right");
        await p.locator('[role="dialog"] input').first().fill("2468");
        await wait(2300);
        await clear();
        await p.locator('[role="dialog"] button').filter({ hasText: /^Select$/ }).first().click();
        await wait(1300);
      }
    }
  });

  await beat("catalogue", async () => {
    await tap(side("Catalogue"), { settle: 1300 });
    await caption("CATALOGUE", "Your products, priced and taxed",
      "Categories, tiles, modifiers and per-item VAT — all held on this device.");
    await wait(2700);
    await clear();
  });

  await beat("tiles", async () => {
    await tap(side("Point of Sale"), { settle: 1200 });
    const items = p.getByRole("button", { name: /^Items$/ }).first();
    if (await items.count()) {
      await tap(items, { settle: 1100 });
      await caption("TILES", "Tap what they ordered",
        "The catalogue as a till: categories, colours and prices, straight onto the ticket.");
      await wait(2500);
      await clear();
      await tap(p.getByRole("button", { name: /^Keypad$/ }).first(), { settle: 900 });
    }
  });

  await beat("ring-up", async () => {
    for (const dgt of ["4", "8", "0"]) {
      await tap(p.getByRole("button", { name: new RegExp(`^${dgt}$`) }).first(), { settle: 170 });
    }
    await caption("KEYPAD", "Ring it up",
      "Keypad or catalogue. Per-line VAT, tips and discounts, worked out on device.");
    await wait(1900);
    await clear();
    await tap(p.getByRole("button", { name: /^Add to ticket$/ }).first(), { settle: 700 });
    await tap(p.locator("main button:visible").filter({ hasText: /^Charge/ }).first(), { settle: 1300 });
  });

  await beat("tip", async () => {
    const noTip = p.locator('[role="dialog"] button').filter({ hasText: /^No tip$/ }).first();
    if (await noTip.count()) {
      await note('[role="dialog"]', "TIPS", "Asked, not assumed",
        "The customer is offered the tip before the QR appears.", "right");
      await wait(2200);
      await clear();
      const presets = p.locator('[role="dialog"] button').filter({ hasText: /^[\d.,]+\s/ });
      const n = await presets.count();
      await (n ? presets.nth(1) : noTip).click();
      await wait(1500);
    }
  });

  let ask = null;
  await beat("charge", async () => {
    // The sheet fills in stages, so read it until both halves are there — a
    // single read catches the amount without the memo on a slow load, and a
    // charge cannot be paid without its memo.
    for (let i = 0; i < 16; i++) {
      ask = await ui(() => {
        const dd = document.querySelector('[role="dialog"]');
        if (!dd) return null;
        const t = dd.innerText;
        const xlm = t.match(/([\d.]+)\s*XLM/);
        // References are shaped MC-O-1023 as well as the older MC1023.
      const memo = t.match(/\b(MC[A-Z-]*\d+)\b/);
        return { xlm: xlm && xlm[1], memo: memo && memo[1] };
      });
      if (ask?.xlm && ask?.memo) break;
      await wait(400);
    }
    log(`charge ${ask?.memo} for ${ask?.xlm} XLM`);
    await note('[role="dialog"]', "CHARGE", "One QR, one memo",
      "The memo ties the payment to this order, matched from Horizon on device.", "left");
    await wait(2600);
    await clear();
  });

  await beat("paid", async () => {
    if (!ask?.xlm || !ask?.memo) throw new Error("no charge to pay");
    const hash = await pay({ from: payer, destination: kp.publicKey(), amount: ask.xlm, memo: ask.memo });
    log(`paid — ${hash.slice(0, 12)}…`);
    await note('[role="dialog"]', "WATCHING", "A customer just paid",
      "Submitted to testnet for real. The till is polling Horizon for it now.", "left");
    for (let i = 0; i < 40; i++) {
      await wait(650);
      const done = await ui(() => {
        const dd = document.querySelector('[role="dialog"]');
        return !!dd && /Paid in full|Payment received/i.test(dd.innerText);
      });
      if (done) break;
    }
    await clear();
    await wait(400);
    await note('[role="dialog"]', "SETTLED", "Straight to your account",
      "Matched by memo, confirmed at the ledger. Nothing was held for you in between.", "left");
    await wait(3000);
    await clear();
    await p.locator('[role="dialog"] button[aria-label="Close"]').first().click().catch(() => {});
    await escape();
  });

  await beat("orders", async () => {
    await promo("tick", 5, "The books", 0.78);
    await tap(side("Orders"), { settle: 1300 });
    await caption("ORDERS", "Every sale, reconciled",
      "Each order carries its payment, its ledger, and the memo that matched them.");
    await wait(2500);
    await clear();
  });

  await beat("receipt", async () => {
    // The order rows are icon buttons: the label is on the control, not in the
    // row text, so they are addressed by it.
    const row = p.locator('main button[aria-label^="Open the receipt for order"]').first();
    await row.waitFor({ state: "visible", timeout: 20000 });
    {
      await tap(row, { settle: 1300 });
      await note('[role="dialog"]', "RECEIPT", "The whole audit trail",
        "Lines, VAT by rate, the payer, the transaction and the ledger it closed in.", "right");
      await wait(2900);
      await clear();
      await escape();
    }
  });

  await beat("counter-codes", async () => {
    await tap(side("Invoices"), { settle: 1200 });
    const cc = p.locator("main button:visible").filter({ hasText: /^Counter codes$/ }).first();
    if (await cc.count()) {
      await tap(cc, { settle: 1200 });
      await caption("COUNTER CODES", "A standing QR for the counter",
        "A reusable code for tips or a fixed price — no charge to ring up first.");
      await wait(2600);
      await clear();
    }
  });

  await beat("insights", async () => {
    await tap(side("Insights"), { settle: 1400 });
    await caption("ON DEVICE", "Your day, counted locally",
      "Takings, tips, VAT by rate and asset mix — computed here, sent nowhere.");
    await wait(2900);
    await clear();
  });

  await beat("customers", async () => {
    await tap(side("Customers"), { settle: 1300 });
    await caption("CUSTOMERS", "Regulars, recognised locally",
      "Built from the addresses that paid you. Only the address is ever public.");
    await wait(2400);
    await clear();
  });

  await beat("invoices", async () => {
    await tap(side("Invoices"), { settle: 1300 });
    await caption("INVOICES", "For the accounts that pay later",
      "Draft, issue and track what is owed — with counter codes for repeat payments.");
    await wait(2400);
    await clear();
  });

  await beat("end", async () => {
    await promo("tickOff");
    await wait(300);
    await promo("chapter", "No server. No custodian.", "It all runs here.",
      "Horizon for the chain, this device for everything else.");
    await wait(4800);
  });

  allBeats.push(...d.beats);
  await ctx.close();
  log("desktop pass closed");
}

console.log("\nbeats:");
for (const b of allBeats) console.log(`  ${b.ok ? "✓" : "✗"} ${b.name.padEnd(15)} ${b.s.toFixed(1)}s ${b.err ?? ""}`);
const bad = allBeats.filter((b) => !b.ok).length;
console.log(`\n${allBeats.length} beats, ${bad} failed, ${((Date.now() - t0) / 1000).toFixed(1)}s total`);
