"use client";

import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { BIP39_WORDLIST } from "./bip39-wordlist";
import { requireWebCrypto } from "./web-crypto";

const te = new TextEncoder();

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const d = await requireWebCrypto().subtle.digest(
    "SHA-256",
    bytes as unknown as ArrayBuffer,
  );
  return new Uint8Array(d);
}

async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const provider = requireWebCrypto();
  const k = await provider.subtle.importKey(
    "raw",
    key as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await provider.subtle.sign("HMAC", k, data as unknown as ArrayBuffer);
  return new Uint8Array(sig);
}

function bytesToBits(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(2).padStart(8, "0");
  return s;
}

export async function generateMnemonic(words = 12): Promise<string> {
  const entropyBytes = words === 24 ? 32 : 16;
  const entropy = requireWebCrypto().getRandomValues(new Uint8Array(entropyBytes));
  return entropyToMnemonic(entropy);
}

export async function entropyToMnemonic(entropy: Uint8Array): Promise<string> {
  const hash = await sha256(entropy);
  const checksumBits = (entropy.length * 8) / 32;
  const bits = bytesToBits(entropy) + bytesToBits(hash).slice(0, checksumBits);
  const chunks = bits.match(/.{11}/g) ?? [];
  return chunks.map((c) => BIP39_WORDLIST[parseInt(c, 2)]).join(" ");
}

export async function validateMnemonic(mnemonic: string): Promise<boolean> {
  const words = normalizeMnemonic(mnemonic).split(" ");
  if (words.length !== 12 && words.length !== 24) return false;
  for (const w of words) {
    if (!BIP39_WORDLIST.includes(w)) return false;
  }
  let bits = "";
  for (const w of words) {
    bits += BIP39_WORDLIST.indexOf(w).toString(2).padStart(11, "0");
  }
  const checksumBits = words.length === 12 ? 4 : 8;
  const entropyBits = bits.length - checksumBits;
  const entropyBytes = new Uint8Array(entropyBits / 8);
  for (let i = 0; i < entropyBits / 8; i++) {
    entropyBytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  const recomputed = await entropyToMnemonic(entropyBytes);
  return normalizeMnemonic(recomputed) === normalizeMnemonic(mnemonic);
}

export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().split(/\s+/).join(" ");
}

export async function mnemonicToSeed(
  mnemonic: string,
  passphrase = "",
): Promise<Uint8Array> {
  const provider = requireWebCrypto();
  const baseKey = await provider.subtle.importKey(
    "raw",
    te.encode(normalizeMnemonic(mnemonic)) as unknown as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await provider.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: te.encode(`mnemonic${passphrase}`) as unknown as ArrayBuffer,
      iterations: 2048,
      hash: "SHA-512",
    },
    baseKey,
    512,
  );
  return new Uint8Array(bits);
}

function ser32Hardened(index: number): Uint8Array {
  const n = index + 0x80000000;
  return new Uint8Array([
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ]);
}

export async function slip10Ed25519Derive(
  seed: Uint8Array,
  path: string,
): Promise<Uint8Array> {
  const I = await hmacSha512(te.encode("ed25519 seed"), seed);
  let k = I.slice(0, 32);
  let c = I.slice(32, 64);

  const segments = path
    .split("/")
    .filter((p) => p !== "m")
    .map((p) => (p.endsWith("'") || p.endsWith("h") ? parseInt(p.slice(0, -1), 10) : -1));

  for (const idx of segments) {
    if (idx < 0) throw new Error("SLIP-0010 ed25519 only supports hardened derivation");
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0;
    data.set(k, 1);
    data.set(ser32Hardened(idx), 33);
    const Ik = await hmacSha512(c, data);
    k = Ik.slice(0, 32);
    c = Ik.slice(32, 64);
  }
  return k;
}

export const STELLAR_COIN_TYPE = 148;

export function stellarAccountPath(accountIndex: number): string {
  return `m/44'/${STELLAR_COIN_TYPE}'/${accountIndex}'`;
}

export async function keypairFromMnemonicIndex(
  mnemonic: string,
  accountIndex: number,
): Promise<Keypair> {
  const seed = await mnemonicToSeed(mnemonic);
  const raw = await slip10Ed25519Derive(seed, stellarAccountPath(accountIndex));
  const secret = StrKey.encodeEd25519SecretSeed(raw);
  return Keypair.fromSecret(secret);
}
