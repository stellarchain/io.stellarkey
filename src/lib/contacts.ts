"use client";

import {
  isValidPublicAddress,
  loadPrivateContactRecords,
  savePrivateContactRecords,
} from "./vault";

export interface Contact {
  name: string;
  address: string;
  favorite?: boolean;
}

const UNSAFE_CONTACT_NAME = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;

function normalizeContactName(value: string): string | null {
  const name = value.trim().normalize("NFC");
  if (!name || [...name].length > 24 || UNSAFE_CONTACT_NAME.test(name)) return null;
  return name;
}

function normalizeContact(value: unknown): Contact | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Contact>;
  if (typeof candidate.name !== "string" || typeof candidate.address !== "string") return null;
  const name = normalizeContactName(candidate.name);
  const address = candidate.address.trim();
  if (!name || !isValidPublicAddress(address)) return null;
  return { name, address, favorite: candidate.favorite === true };
}

export async function loadContacts(): Promise<Contact[]> {
  const records = await loadPrivateContactRecords();
  return records
    .map(normalizeContact)
    .filter((contact): contact is Contact => contact !== null);
}

function sortContacts(contacts: Contact[]): Contact[] {
  return contacts.sort((a, b) => {
    if (a.favorite && !b.favorite) return -1;
    if (!a.favorite && b.favorite) return 1;
    return a.name.localeCompare(b.name);
  });
}

let contactMutationQueue: Promise<void> = Promise.resolve();

function mutateContacts(update: (contacts: Contact[]) => Contact[]): Promise<Contact[]> {
  const mutation = contactMutationQueue.then(async () => {
    const next = update(await loadContacts());
    await savePrivateContactRecords(next);
    return next;
  });
  contactMutationQueue = mutation.then(() => undefined, () => undefined);
  return mutation;
}

export function saveContact(contact: Contact, previousAddress?: string): Promise<Contact[]> {
  const normalized = normalizeContact(contact);
  if (!normalized) return Promise.reject(new Error("Contact has an invalid name or Stellar address."));
  const replacedAddress = previousAddress?.trim();
  return mutateContacts((contacts) => {
    const retained = contacts.filter(
      (candidate) => candidate.address !== normalized.address && candidate.address !== replacedAddress,
    );
    return sortContacts([...retained, normalized]);
  });
}

export function toggleFavoriteContact(address: string): Promise<Contact[]> {
  const normalizedAddress = address.trim();
  return mutateContacts((contacts) => sortContacts(contacts.map((contact) =>
    contact.address === normalizedAddress
      ? { ...contact, favorite: !contact.favorite }
      : contact
  )));
}

export function deleteContact(address: string): Promise<Contact[]> {
  const normalizedAddress = address.trim();
  return mutateContacts((contacts) => contacts.filter(
    (contact) => contact.address !== normalizedAddress,
  ));
}

export function validateContact(name: string, address: string): string | null {
  if (!name.trim()) return "Give the contact a name.";
  if ([...name.trim().normalize("NFC")].length > 24) return "Name must be 24 characters or fewer.";
  if (UNSAFE_CONTACT_NAME.test(name)) return "Name contains an unsupported invisible or directional character.";
  if (!isValidPublicAddress(address)) return "Not a valid Stellar address.";
  return null;
}
