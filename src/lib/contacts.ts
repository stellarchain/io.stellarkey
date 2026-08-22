"use client";

import { isValidPublicAddress } from "./vault";

const KEY = "polaris.contacts.v1";

export interface Contact {
  name: string;
  address: string;
}

export function loadContacts(): Contact[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Contact[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(contacts: Contact[]): void {
  window.localStorage.setItem(KEY, JSON.stringify(contacts));
}

export function saveContact(contact: Contact): Contact[] {
  const contacts = loadContacts().filter(
    (c) => c.address.toLowerCase() !== contact.address.toLowerCase(),
  );
  const next = [...contacts, contact].sort((a, b) => a.name.localeCompare(b.name));
  persist(next);
  return next;
}

export function deleteContact(address: string): Contact[] {
  const next = loadContacts().filter((c) => c.address !== address);
  persist(next);
  return next;
}

export function validateContact(name: string, address: string): string | null {
  if (!name.trim()) return "Give the contact a name.";
  if (name.trim().length > 24) return "Name must be 24 characters or fewer.";
  if (!isValidPublicAddress(address)) return "Not a valid Stellar address.";
  return null;
}
