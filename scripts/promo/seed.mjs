/**
 * The promo's testnet account.
 *
 * Cached on disk because the recording runs against a persistent browser
 * profile: regenerating the keypair each run would replace the vault the
 * profile's encrypted merchant store is bound to.
 */
import * as Sdk from "@stellar/stellar-sdk";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const PASSWORD = "promo";
export const PROFILE = "/tmp/promo/profile";
export const BASE = process.env.BASE_URL || "http://localhost:3003";
const CACHE = "/tmp/promo/account.json";
/**
 * The migrated vault, kept verbatim.
 *
 * The vault this file mints is v1. The app migrates it to v3 on first unlock,
 * and that migration wraps a *newly generated* merchant key — so re-injecting
 * the v1 vault would mint a different key and orphan the encrypted merchant
 * store that is already in IndexedDB. Once the v3 vault exists it is cached
 * and restored byte for byte.
 */
const VAULT_CACHE = "/tmp/promo/vault.json";
const b64 = (b) => Buffer.from(b).toString("base64");

async function vaultFor(secret) {
  const kp = Sdk.Keypair.fromSecret(secret);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const mat = await crypto.subtle.importKey("raw", new TextEncoder().encode(PASSWORD), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, mat, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret));
  return JSON.stringify({
    version: 1,
    accounts: [{ id: "a1", label: "Everyday", publicKey: kp.publicKey(), createdAt: Date.now(), secret: { salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ct)) } }],
    activeAccountId: "a1",
  });
}

/** A funded testnet account, reused across runs once created. */
export async function account({ fresh = false } = {}) {
  mkdirSync(path.dirname(CACHE), { recursive: true });
  if (!fresh && existsSync(CACHE)) {
    const { secret } = JSON.parse(readFileSync(CACHE, "utf8"));
    const kp = Sdk.Keypair.fromSecret(secret);
    return { kp, secret, vault: await vaultFor(secret), reused: true };
  }
  const kp = Sdk.Keypair.random();
  const res = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}`);
  writeFileSync(CACHE, JSON.stringify({ secret: kp.secret(), publicKey: kp.publicKey() }, null, 2));
  return { kp, secret: kp.secret(), vault: await vaultFor(kp.secret()), reused: false };
}

/**
 * Open the app in the promo profile, unlocked and settled.
 *
 * The unlock has to wait for hydration before the field exists — checking
 * count() straight after goto() silently skips it and leaves the vault locked.
 */
export async function open(chromium, { video = null, viewport = { width: 1440, height: 900 }, scale = 1 } = {}) {
  const { vault } = await account();
  const stored = existsSync(VAULT_CACHE) ? readFileSync(VAULT_CACHE, "utf8") : null;
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    viewport,
    deviceScaleFactor: scale,
    ...(video ? { recordVideo: { dir: video, size: viewport } } : {}),
  });
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  await ctx.addInitScript(([v, cached]) => {
    // A cached vault is the migrated one and is restored as-is; without it,
    // seed the freshly minted vault and let the app migrate it once.
    if (cached) localStorage.setItem("polaris.vault.v1", cached);
    else if (!localStorage.getItem("polaris.vault.v1")) localStorage.setItem("polaris.vault.v1", v);
    localStorage.setItem("polaris.network.v1", "testnet");
  }, [vault, stored]);
  await p.goto(BASE, { waitUntil: "domcontentloaded" });

  // Unlock, then confirm it actually took. A single fill-and-click is not
  // enough on its own: if the click lands before hydration finishes the form
  // swallows it and the app sits on the lock screen until the caller times out.
  const merchant = p.getByRole("button", { name: /^Merchant$/ }).first();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const pw = p.locator('input[type="password"]').first();
    await pw.waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
    if (await pw.isVisible().catch(() => false)) {
      await pw.fill(PASSWORD);
      await p.getByRole("button", { name: /^Unlock Vault$/ }).click().catch(() => {});
    }
    try {
      await merchant.waitFor({ state: "visible", timeout: 20000 });
      await keepVault(p);
      return { ctx, p };
    } catch {
      if (attempt === 3) throw new Error("wallet did not unlock after 3 attempts");
      await p.reload({ waitUntil: "domcontentloaded" });
      await p.waitForTimeout(1500);
    }
  }
  return { ctx, p };
}

/** Persist the migrated vault so the merchant key survives the next run. */
export async function keepVault(p) {
  const v = await p.evaluate(() => localStorage.getItem("polaris.vault.v1"));
  if (!v) return;
  const isV3 = (() => { try { return JSON.parse(v).version === 3; } catch { return false; } })();
  if (isV3) writeFileSync(VAULT_CACHE, v);
}

/** Drop every cached artefact, so the next prepare starts clean. */
export function forget() {
  for (const f of [CACHE, VAULT_CACHE]) rmSync(f, { force: true });
}
