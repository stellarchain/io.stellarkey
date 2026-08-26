// Insights: renders the screen fresh (fixture) and seeded (real 400-day store),
// at 1440 and 393, and reports the figures the design critique turns on.
// Usage: npm run dev, then `node scripts/verify-insights.mjs [fresh|seeded|both]`
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const OUT = process.env.OUT || "/tmp/insights";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:3003";
const TAG = process.env.TAG || "now";
const WHICH = process.argv[2] || "both";

const PW = "pw", b64 = (b) => Buffer.from(b).toString("base64");
const kp = Sdk.Keypair.random();
const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
const mat = await crypto.subtle.importKey("raw", new TextEncoder().encode(PW), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, mat, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(kp.secret()));
const vault = JSON.stringify({ version: 1, accounts: [{ id: "a1", label: "Till", publicKey: kp.publicKey(), createdAt: Date.now(), secret: { salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ct)) } }], activeAccountId: "a1" });

const PK = kp.publicKey();
const USDC = { code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" };
const XLM = { code: "XLM", issuer: null };
const EURC = { code: "EURC", issuer: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2" };

const baseSettings = {
  enabled: true,
  receivingPublicKey: PK,
  currency: "EUR",
  settlementAsset: XLM,
  acceptedAssets: [XLM, USDC, EURC],
  taxMode: "inclusive",
  taxRates: [
    { id: "standard", label: "Standard", percent: 23 },
    { id: "intermediate", label: "Intermediate", percent: 13 },
  ],
  defaultTaxRateId: "standard",
  profile: { name: "Meridian Coffee", addressLines: ["27 Rua da Prata"], taxId: "PT514902663", receiptFooter: "Obrigado" },
  terminalName: "Counter iPad",
};

const emptyMerchant = JSON.stringify({
  version: 1, settings: baseSettings, catalogue: [], modifierGroups: [],
  orders: [], charges: [], refunds: [], unmatched: [], nextOrderNumber: 1042, cursors: {},
});

/* ---------------- a real 14-day shop ---------------- */

const MENU = [
  { name: "Flat White", price: 320, tax: "standard" },
  { name: "Espresso", price: 145, tax: "standard" },
  { name: "Cortado", price: 195, tax: "standard" },
  { name: "Toastie", price: 520, tax: "intermediate" },
  { name: "Pastel de Nata", price: 160, tax: "intermediate" },
  { name: "Croissant", price: 240, tax: "intermediate" },
];

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Weight per hour of a trading day, 10:00–22:00: a lunch peak and an evening
// one, so the shop is still open at the hour this script tends to be run and
// the running-day states (the now marker, the part-day comparison) are on screen.
const SHAPE = { 10: 0.6, 11: 0.9, 12: 1.9, 13: 2.0, 14: 1.0, 15: 0.8, 16: 0.7, 17: 0.9, 18: 1.4, 19: 1.7, 20: 1.5, 21: 1.1, 22: 0.5 };

function seededMerchant(todayFactor = 1.3) {
  const rnd = mulberry(20260825);
  const now = new Date();
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const orders = [], charges = [];
  let n = 1000;

  for (let back = 13; back >= 0; back -= 1) {
    const day = new Date(midnight); day.setDate(day.getDate() - back);
    const dow = day.getDay(); // 0 Sun
    if (dow === 0) continue; // shut on Sundays, and the shut day stays a real zero
    // Monday is the quiet day; Saturday is the busy one.
    const busy = (back === 0 ? todayFactor : 1) * (dow === 6 ? 1.35 : dow === 5 ? 1.15 : dow === 1 ? 0.72 : 1);
    for (const [hourStr, weight] of Object.entries(SHAPE)) {
      const hour = Number(hourStr);
      if (back === 0) {
        // Today only runs as far as the clock has got.
        if (hour > now.getHours()) continue;
        if (hour === now.getHours() && now.getMinutes() < 30) continue;
      }
      const count = Math.max(0, Math.round(weight * busy * 3.2 * (0.8 + rnd() * 0.45)));
      for (let k = 0; k < count; k += 1) {
        const at = new Date(day);
        at.setHours(hour, Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);
        if (at.getTime() > now.getTime()) continue;
        const lines = [];
        const picks = 1 + Math.floor(rnd() * 2.4);
        for (let j = 0; j < picks; j += 1) {
          const item = MENU[Math.floor(rnd() * MENU.length)];
          lines.push({
            id: `ln_${n}_${j}`, itemId: `it_${item.name}`, name: item.name,
            quantity: 1 + (rnd() > 0.82 ? 1 : 0), unitPriceMinor: item.price,
            modifiers: [], taxRateId: item.tax, note: null,
          });
        }
        const gross = lines.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0);
        const tip = rnd() > 0.72 ? Math.round(gross * 0.1) : 0;
        const taxByRate = {};
        for (const l of lines) {
          const rate = l.taxRateId === "standard" ? 23 : 13;
          const g = l.unitPriceMinor * l.quantity;
          taxByRate[l.taxRateId] = (taxByRate[l.taxRateId] ?? 0) + Math.round((g * rate) / (100 + rate));
        }
        const taxMinor = Object.values(taxByRate).reduce((s, v) => s + v, 0);
        const total = gross + tip;
        n += 1;
        const id = `ord_${n}`;
        orders.push({
          id, number: n, reference: `MC${n}`, network: "testnet", status: "paid",
          lines, currency: "EUR",
          totals: { grossMinor: gross, discountMinor: 0, tipMinor: tip, netMinor: gross - taxMinor, taxByRate, taxMinor, totalMinor: total },
          tender: [{ kind: "crypto", amountMinor: total, chargeId: `chg_${n}` }],
          staffName: "Ana Reis", terminalName: "Counter iPad",
          createdAt: at.getTime() - 90_000, paidAt: at.getTime(),
          payerAddress: PK, note: null,
        });
        const r = rnd();
        const asset = r < 0.62 ? USDC : r < 0.9 ? XLM : EURC;
        charges.push({
          id: `chg_${n}`, orderId: id, reference: `MC${n}`, network: "testnet",
          destination: PK, amountMinor: total, currency: "EUR", quotes: [],
          status: "paid", createdAt: at.getTime() - 90_000, expiresAt: at.getTime() + 600_000,
          payment: { id: `${n}`, transactionHash: `hash${n}`, ledger: 1000 + n, from: PK, amount: "1.0000000", asset, memo: `MC${n}`, createdAt: new Date(at).toISOString(), lane: "memo" },
        });
      }
    }
  }

  const first = orders.find((o) => o.paidAt >= midnight.getTime());
  const refunds = first
    ? [{ id: "rf_1", orderId: first.id, network: "testnet", amountMinor: 520, asset: XLM, amount: "20.0000000", destination: PK, reason: "wrong_item", note: null, transactionHash: "hashrf", createdAt: midnight.getTime() + 13 * 3600_000 }]
    : [];

  return JSON.stringify({
    version: 1, settings: baseSettings, catalogue: [], modifierGroups: [],
    orders, charges, refunds, unmatched: [], nextOrderNumber: n + 1, cursors: {},
  });
}

/* ---------------- probes ---------------- */

const probe = () => ({
  strip: (() => {
    const el = document.querySelector("main .panel-inset");
    return el ? el.innerText.replace(/\n+/g, " | ") : null;
  })(),
  lead: (() => {
    const p = [...document.querySelectorAll("main .panel")][0];
    return p ? p.innerText.replace(/\n+/g, " | ").slice(0, 340) : null;
  })(),
  words: (document.querySelector("main")?.innerText || "").trim().split(/\s+/).length,
  sparkStroke: (() => {
    const fig = [...document.querySelectorAll("main svg polyline")].map((n) => n.getAttribute("stroke"));
    return fig;
  })(),
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  trend: (() => {
    const el = [...document.querySelectorAll('main [role="img"]')].find((n) => /Takings for the last/.test(n.getAttribute("aria-label") || ""));
    if (!el) return null;
    const poly = el.querySelector("polyline");
    return {
      label: el.getAttribute("aria-label"),
      stroke: poly?.getAttribute("stroke") ?? null,
      // Plotted heights, top of the box = the biggest day in the series.
      points: poly?.getAttribute("points")?.split(" ").map((pt) => Number(pt.split(",")[1])) ?? null,
    };
  })(),
  chipTint: (() => {
    const el = [...document.querySelectorAll("main span.mono")].find((n) => /^[+-]|^level/.test(n.textContent.trim()));
    return el ? { text: el.textContent.trim(), color: getComputedStyle(el).color } : null;
  })(),
  monoOutliers: (() => {
    // Every number on the screen should be set in the mono face.
    const mono = getComputedStyle(document.querySelector(".mono") || document.body).fontFamily;
    const out = [];
    const walk = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const t = walk.currentNode.textContent || "";
      if (!/[0-9]/.test(t)) continue;
      const el = walk.currentNode.parentElement;
      if (!el || !el.offsetParent) continue;
      if (el.closest("svg")) continue;
      const ff = getComputedStyle(el).fontFamily;
      if (ff !== mono) out.push(t.trim().slice(0, 60));
    }
    return out;
  })(),
});

async function run(label, merchantJson, width, height) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 500, hasTouch: width < 500 });
  await ctx.addInitScript(([v, m]) => {
    localStorage.setItem("polaris.vault.v1", v);
    localStorage.setItem("polaris.network.v1", "testnet");
    localStorage.setItem("wallet.merchant.v1", m);
  }, [vault, merchantJson]);
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.getByPlaceholder(/password/i).first().fill(PW);
  await p.keyboard.press("Enter");
  await p.waitForTimeout(3400);
  const merch = p.getByRole("button", { name: /^Merchant$/ }).first();
  if (await merch.count()) { await merch.click(); await p.waitForTimeout(1200); }
  const ins = p.getByRole("button", { name: /^Insights$/ }).first();
  if (await ins.count()) { await ins.click(); await p.waitForTimeout(1400); }
  // The default state is the one everybody sees: shoot it before touching a
  // disclosure.
  await p.screenshot({ path: `${OUT}/${TAG}-${label}-${width}-closed.png`, fullPage: true });
  // Everything the disclosures hide is on the screen too, and has to obey the
  // same rules: open them all before probing.
  for (const d of await p.locator('main button[aria-expanded="false"]').all()) {
    await d.click().catch(() => {});
  }
  await p.waitForTimeout(500);
  const m = await p.evaluate(probe);
  m.hourTable = await p.evaluate(() => {
    const t = document.querySelector("main table");
    if (!t) return null;
    const rows = [...t.querySelectorAll("tbody tr")].map((r) => r.innerText.replace(/\s+/g, " ").trim());
    return { rows: rows.length, first: rows[0], last: rows[rows.length - 1] };
  });
  console.log(`\n### ${label} @ ${width}`);
  console.log(JSON.stringify(m, null, 1));
  const file = `${OUT}/${TAG}-${label}-${width}.png`;
  await p.screenshot({ path: file, fullPage: true });
  console.log("shot", file);
  await b.close();
}

/** A shop on its first day: today has traded, nothing before it ever has. */
function firstDayMerchant() {
  const store = JSON.parse(seededMerchant());
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const orders = store.orders.filter((o) => o.paidAt >= midnight.getTime());
  const kept = new Set(orders.map((o) => o.id));
  return JSON.stringify({
    ...store, orders,
    charges: store.charges.filter((c) => kept.has(c.orderId)),
    refunds: store.refunds.filter((r) => kept.has(r.orderId)),
  });
}

const seeded = seededMerchant();
if (WHICH === "quiet") {
  await run("quiet", seededMerchant(0.55), 1440, 1000);
}
if (WHICH === "firstday") {
  await run("firstday", firstDayMerchant(), 1440, 1000);
  await run("firstday", firstDayMerchant(), 393, 852);
}
if (WHICH === "fresh" || WHICH === "both") {
  await run("fresh", emptyMerchant, 1440, 1000);
  await run("fresh", emptyMerchant, 393, 852);
}
if (WHICH === "seeded" || WHICH === "both") {
  await run("seeded", seeded, 1440, 1000);
  await run("seeded", seeded, 393, 852);
}
