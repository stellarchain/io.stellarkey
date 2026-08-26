// Compares merchant screens against the wallet's own screens: content width,
// row geometry, button size and type scale. The app is the reference.
// Usage: npm run dev, then `node scripts/verify-merchant-consistency.mjs`
import { chromium } from "playwright";
import * as Sdk from "@stellar/stellar-sdk";
const BASE = process.env.BASE_URL || "http://localhost:3003";
const PW = "pw", b64 = (b) => Buffer.from(b).toString("base64");
const kp = Sdk.Keypair.random();
const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
const mat = await crypto.subtle.importKey("raw", new TextEncoder().encode(PW), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, mat, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(kp.secret()));
const vault = JSON.stringify({ version: 1, accounts: [{ id: "a1", label: "Till", publicKey: kp.publicKey(), createdAt: Date.now(), secret: { salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ct)) } }], activeAccountId: "a1" });
const merchant = JSON.stringify({ version: 1, settings: { enabled: true, receivingPublicKey: kp.publicKey(), currency: "EUR", acceptedAssets: [{ code: "XLM", issuer: null }], profile: { name: "Meridian Coffee", addressLines: ["27 Rua da Prata"], taxId: "PT514902663", receiptFooter: "Obrigado" }, terminalName: "Counter iPad" }, catalogue: [], modifierGroups: [], orders: [], charges: [], refunds: [], unmatched: [], nextOrderNumber: 1042, cursors: {} });

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
await p.waitForTimeout(2800);

const probe = () => p.evaluate(() => {
  const main = document.querySelector("main");
  if (!main) return null;
  const inner = main.querySelector(".mx-auto");
  const btns = [...main.querySelectorAll("button")].filter((x) => x.offsetParent && x.className.includes("btn"));
  const heights = [...new Set(btns.map((x) => Math.round(x.getBoundingClientRect().height)))].sort((a, z) => a - z);
  const fullWidth = btns.filter((x) => x.getBoundingClientRect().width > 320).length;
  const rows = [...main.querySelectorAll(".row-hover, .list-group > *")].filter((x) => x.offsetParent);
  const rowPad = [...new Set(rows.map((x) => {
    const cs = getComputedStyle(x);
    return `${cs.paddingTop}/${cs.paddingLeft}`;
  }))].slice(0, 4);
  const rowH = [...new Set(rows.map((x) => Math.round(x.getBoundingClientRect().height)))].sort((a, z) => a - z).slice(0, 5);
  const sizes = {};
  main.querySelectorAll("*").forEach((el) => {
    if (!el.offsetParent || !el.textContent?.trim()) return;
    const fs = getComputedStyle(el).fontSize;
    sizes[fs] = (sizes[fs] || 0) + 1;
  });
  const top = Object.entries(sizes).sort((a, z) => z[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}x${v}`);
  return {
    contentW: inner ? Math.round(inner.getBoundingClientRect().width) : null,
    btnHeights: heights, fullWidthBtns: fullWidth,
    rowPads: rowPad, rowHeights: rowH, topFontSizes: top,
  };
});

const go = async (label, click) => {
  await click();
  await p.waitForTimeout(1100);
  console.log(label.padEnd(16), JSON.stringify(await probe()));
};

console.log("--- the app's own screens (reference) ---");
await go("Home", async () => p.getByRole("button", { name: /^Home$/ }).first().click());
await go("Contacts", async () => p.getByRole("button", { name: /^Contacts$/ }).first().click());
await go("Settings", async () => p.getByRole("button", { name: /^Settings$/ }).first().click());
console.log("--- merchant ---");
await p.getByRole("button", { name: /^Merchant$/ }).first().click();
await p.waitForTimeout(1000);
for (const r of ["Point of Sale", "Orders", "Catalogue", "Invoices", "Customers", "Insights"]) {
  await go(r, async () => p.getByRole("button", { name: new RegExp(`^${r}$`) }).first().click());
}
await b.close();
