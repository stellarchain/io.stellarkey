"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "./Toast";
import { isValidPublicAddress } from "@/lib/vault";
import type { Contact } from "@/lib/contacts";
import { triggerHaptic } from "@/lib/haptics";
import { Button, ErrorText, Field, Modal, ModalHeader } from "./ui";

export function EditContactModal({
  contact,
  onClose,
}: {
  contact: Contact | null;
  onClose: () => void;
}) {
  if (!contact) return null;
  return <EditContactInner key={contact.address} contact={contact} onClose={onClose} />;
}

function EditContactInner({
  contact,
  onClose,
}: {
  contact: Contact;
  onClose: () => void;
}) {
  const { addContact, removeContact } = useWallet();
  const { toast } = useToast();
  const [name, setName] = useState(contact.name);
  const [address, setAddress] = useState(contact.address);
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    const trimmedName = name.trim();
    const trimmedAddr = address.trim();
    if (!trimmedName) {
      setError("Please enter a contact name.");
      return;
    }
    if (!isValidPublicAddress(trimmedAddr)) {
      setError("Invalid Stellar public address (must start with G).");
      return;
    }
    // Update contact
    removeContact(contact.address);
    addContact({
      name: trimmedName,
      address: trimmedAddr,
      favorite: contact.favorite,
    });
    triggerHaptic("success");
    toast("Contact updated", "success");
    onClose();
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        title="Edit Contact"
        subtitle="Update saved address book entry"
        onClose={onClose}
      />
      <div className="p-6 space-y-4">
        <Field label="Contact Name">
          <input
            className="input text-[14px]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alice"
            maxLength={24}
            autoFocus
          />
        </Field>
        <Field label="Stellar Public Key">
          <input
            className="input mono text-[13px]"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="G..."
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
        <ErrorText message={error ?? ""} />
        <div className="flex gap-3 pt-1">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={handleSave}>
            Save Changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}
