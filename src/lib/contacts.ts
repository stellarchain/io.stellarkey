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

function normalizeContact(value: unknown): Contact | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Contact>;
  if (typeof candidate.name !== "string" || typeof candidate.address !== "string") return null;
  const name = candidate.name.trim();
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
  if (name.trim().length > 24) return "Name must be 24 characters or fewer.";
  if (!isValidPublicAddress(address)) return "Not a valid Stellar address.";
  return null;
}
