// Density budget for the merchant screens: one notice, one primary action,
// no nested panels, and prose that fits on a counter rather than in a spec.
// Usage: npm run dev, then `node scripts/verify-merchant-density.mjs`
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import * as Sdk from "@stellar/stellar-sdk";
const PW = "pw", b64 = (b) => Buffer.from(b).toString("base64");
mkdirSync("/tmp/audit", { recursive: true });
const kp = Sdk.Keypair.random();
const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
const mat = await crypto.subtle.importKey("raw", new TextEncoder().encode(PW), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, mat, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(kp.secret()));
const vault = JSON.stringify({ version: 1, accounts: [{ id: "a1", label: "Till", publicKey: kp.publicKey(), createdAt: Date.now(), secret: { salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ct)) } }], activeAccountId: "a1" });
const merchant = JSON.stringify({ version: 1, settings: { enabled: true, receivingPublicKey: kp.publicKey(), currency: "EUR", acceptedAssets: [{ code: "XLM", issuer: null }], profile: { name: "Meridian Coffee", addressLines: ["27 Rua da Prata"], taxId: "PT514902663", receiptFooter: "Obrigado" }, terminalName: "Counter iPad" }, catalogue: [], modifierGroups: [], orders: [], charges: [], refunds: [], unmatched: [], nextOrderNumber: 1042, cursors: {} });

const BASE = process.env.BASE_URL || "http://localhost:3003";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
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

const measure = async (name) => {
  await p.waitForTimeout(900);
  const m = await p.evaluate(() => {
    const main = document.querySelector("main");
    const q = (s) => main ? main.querySelectorAll(s).length : 0;
    // how much vertical space is spent before the first real content
    const panels = main ? [...main.querySelectorAll(".panel, .panel-inset, .list-group")] : [];
    const notices = main ? [...main.querySelectorAll('[role="status"], [role="alert"]')] : [];
    const noticeH = notices.reduce((a, n) => a + n.getBoundingClientRect().height, 0);
    const buttons = main ? [...main.querySelectorAll("button")].filter(b => b.offsetParent) : [];
    const primary = buttons.filter(b => b.className.includes("btn-primary"));
    const words = main ? (main.innerText || "").trim().split(/\s+/).length : 0;
    // nesting depth of panels
    let maxNest = 0;
    for (const el of panels) {
      let d = 0, cur = el.parentElement;
      while (cur && cur !== main) { if (cur.classList?.contains("panel") || cur.classList?.contains("panel-inset") || cur.classList?.contains("list-group")) d++; cur = cur.parentElement; }
      maxNest = Math.max(maxNest, d);
    }
    return { panels: panels.length, nestDepth: maxNest, notices: notices.length, noticePx: Math.round(noticeH),
             buttons: buttons.length, primaryButtons: primary.length, words, toggles: q('[role="switch"]') };
  });
  const fail = [];
  if (m.notices > 1) fail.push(`${m.notices} notices`);
  if (m.words > 260) fail.push(`${m.words} words`);
  if (m.primaryButtons > 1) fail.push(`${m.primaryButtons} primary buttons`);
  if (m.nestDepth > 0) fail.push(`panels nested ${m.nestDepth} deep`);
  console.log(name.padEnd(14), JSON.stringify(m), fail.length ? "  <-- " + fail.join(", ") : "  ok");
};

for (const row of ["Point of Sale","Orders","Catalogue","Invoices","Customers","Insights"]) {
  const btn = p.getByRole("button", { name: new RegExp(`^${row}$`) }).first();
  if (await btn.count()) { await btn.click(); await measure(row); await p.screenshot({ path: `/tmp/audit/${row.replace(/\s+/g,'-').toLowerCase()}.png` }); }
}
await b.close();
