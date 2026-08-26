// The merchant summary strip is one shape reused on every merchant page. This
// checks it still is: same source, same height, everywhere it shows up. It
// exists because five hand-copied versions had drifted to three different
// heights (61px, 74px, 164px) before they were merged into Stat.tsx.
// Usage: npm run dev, then `node scripts/verify-stat-strip.mjs`
import { chromium } from "playwright";
import { readdirSync, readFileSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";

const EXPECT = 61;
const BASE = process.env.BASE_URL || "http://localhost:3003";

// --- a strip drawn anywhere but Stat.tsx is a copy waiting to drift again ---
const DIR = "src/components/merchant";
const copies = readdirSync(DIR)
  .filter((f) => f.endsWith(".tsx") && f !== "Stat.tsx")
  .filter((f) =>
    /text-\[10\.5px\][\s\S]{0,120}uppercase[\s\S]{0,260}text-\[15\.5px\]/.test(
      readFileSync(`${DIR}/${f}`, "utf8"),
    ),
  );

const PW = "pw", b64 = (b) => Buffer.from(b).toString("base64");
const kp = Sdk.Keypair.random();
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const mat = await crypto.subtle.importKey("raw", new TextEncoder().encode(PW), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, mat, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(kp.secret()));
const vault = JSON.stringify({ version: 1, accounts: [{ id: "a1", label: "Till", publicKey: kp.publicKey(), createdAt: Date.now(), secret: { salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ct)) } }], activeAccountId: "a1" });

// Orders only draws its strip once the day has takings in it.
const now = Date.now();
const order = (n, totalMinor, tipMinor) => ({
  id: `o${n}`, number: 1000 + n, reference: `MC${1000 + n}`, network: "testnet",
  status: "paid", currency: "EUR",
  lines: [{ id: `l${n}`, itemId: null, name: "Flat white", quantity: 1, unitPriceMinor: totalMinor - tipMinor, modifiers: [], taxRateId: "std", note: null }],
  totals: { grossMinor: totalMinor - tipMinor, discountMinor: 0, tipMinor, netMinor: Math.round((totalMinor - tipMinor) / 1.23), taxByRate: { std: totalMinor - tipMinor - Math.round((totalMinor - tipMinor) / 1.23) }, taxMinor: totalMinor - tipMinor - Math.round((totalMinor - tipMinor) / 1.23), totalMinor },
  tender: [{ kind: "crypto", amountMinor: totalMinor, chargeId: `c${n}` }],
  staffName: "Ana Reis", terminalName: "Counter iPad",
  createdAt: now - n * 900000, paidAt: now - n * 900000, payerAddress: null, note: null,
});
const merchant = JSON.stringify({
  version: 1,
  settings: { enabled: true, receivingPublicKey: kp.publicKey(), currency: "EUR", acceptedAssets: [{ code: "XLM", issuer: null }], profile: { name: "Meridian Coffee", addressLines: ["27 Rua da Prata"], taxId: "PT514902663", receiptFooter: "Obrigado" }, terminalName: "Counter iPad" },
  catalogue: [], modifierGroups: [], orders: [order(1, 480, 50), order(2, 1250, 0), order(3, 320, 30)],
  charges: [], refunds: [], unmatched: [], nextOrderNumber: 1042, cursors: {},
});

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addInitScript(([v, m]) => {
  localStorage.setItem("polaris.vault.v1", v);
  localStorage.setItem("polaris.network.v1", "testnet");
  localStorage.setItem("wallet.merchant.v1", m);
}, [vault, merchant]);
const p = await ctx.newPage();
await p.goto(BASE, { waitUntil: "domcontentloaded" });
await p.getByPlaceholder(/password/i).first().fill(PW);
await p.keyboard.press("Enter");
await p.waitForTimeout(3000);
await p.getByRole("button", { name: /^Merchant$/ }).first().click();
await p.waitForTimeout(1200);

/** The strip is the first panel-inset holding a 15.5px figure under a 10.5px label. */
const stripHeight = () =>
  p.evaluate(() => {
    const main = document.querySelector("main");
    for (const el of main.querySelectorAll(".panel-inset")) {
      const label = el.querySelector('p[class*="10.5px"][class*="uppercase"]');
      const figure = el.querySelector('[class*="15.5px"]');
      // The mobile sub-nav strip is in the DOM at desktop width but display:none.
      if (label && figure && el.offsetParent) return Math.round(el.getBoundingClientRect().height);
    }
    return null;
  });

const rows = [];
for (const [page, open] of [
  ["Orders", "Orders"],
  ["Invoices", "Invoices"],
  ["Counter codes", "Counter codes"],
  ["Customers", "Customers"],
  ["Insights", "Insights"],
]) {
  const btn = p.getByRole("button", { name: new RegExp(`^${open}$`) }).first();
  if (!(await btn.count())) { rows.push({ page, height: "not found" }); continue; }
  await btn.click();
  await p.waitForTimeout(900);
  rows.push({ page, height: await stripHeight() });
}
await b.close();

let bad = 0;
for (const r of rows) {
  const ok = r.height === EXPECT;
  if (!ok) bad++;
  console.log(`${r.page.padEnd(15)}${String(r.height).padStart(5)}px  ${ok ? "ok" : `<-- expected ${EXPECT}px`}`);
}
if (copies.length) {
  bad++;
  console.log(`\nstrip markup outside Stat.tsx: ${copies.join(", ")}`);
}
console.log(bad === 0 ? "\nsummary strip is consistent" : `\n${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 1);
