"use client";

import { isValidPublicAddress } from "./vault";

const KEY = "polaris.contacts.v1";

export interface Contact {
  name: string;
  address: string;
  favorite?: boolean;
}

function normalizeContact(value: unknown): Contact | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Contact>;
  if (typeof candidate.name !== "string" || typeof candidate.address !== "string") return null;
  const name = candidate.name.trim();
  const address = candidate.address.trim();
  if (!name || !isValidPublicAddress(address)) return null;
  return { name, address, favorite: candidate.favorite === true };
}

export function loadContacts(): Contact[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.map(normalizeContact).filter((contact): contact is Contact => contact !== null)
      : [];
  } catch {
    return [];
  }
}

function persist(contacts: Contact[]): void {
  window.localStorage.setItem(KEY, JSON.stringify(contacts));
}

export function saveContact(contact: Contact): Contact[] {
  const normalized = normalizeContact(contact);
  if (!normalized) throw new Error("Contact has an invalid name or Stellar address.");
  const contacts = loadContacts().filter(
    (c) => c.address !== normalized.address,
  );
  const next = [...contacts, normalized].sort((a, b) => {
    if (a.favorite && !b.favorite) return -1;
    if (!a.favorite && b.favorite) return 1;
    return a.name.localeCompare(b.name);
  });
  persist(next);
  return next;
}

export function toggleFavoriteContact(address: string): Contact[] {
  const normalizedAddress = address.trim();
  const contacts = loadContacts();
  const next = contacts.map((c) =>
    c.address === normalizedAddress
      ? { ...c, favorite: !c.favorite }
      : c,
  ).sort((a, b) => {
    if (a.favorite && !b.favorite) return -1;
    if (!a.favorite && b.favorite) return 1;
    return a.name.localeCompare(b.name);
  });
  persist(next);
  return next;
}

export function deleteContact(address: string): Contact[] {
  const normalizedAddress = address.trim();
  const next = loadContacts().filter(
    (c) => c.address !== normalizedAddress,
  );
  persist(next);
  return next;
}

export function validateContact(name: string, address: string): string | null {
  if (!name.trim()) return "Give the contact a name.";
  if (name.trim().length > 24) return "Name must be 24 characters or fewer.";
  if (!isValidPublicAddress(address)) return "Not a valid Stellar address.";
  return null;
}
