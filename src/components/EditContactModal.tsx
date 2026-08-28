"use client";

import { useState } from "react";
import { useWalletContacts } from "@/hooks/useWallet";
import { useToast } from "./Toast";
import { validateContact, type Contact } from "@/lib/contacts";
import { triggerHaptic } from "@/lib/haptics";
import { Button, ErrorText, Field, Modal, ModalHeader } from "./ui";

export function EditContactModal({
  open,
  contact,
  onClose,
}: {
  open: boolean;
  /** null → create mode ("New Contact"), Contact → edit mode. */
  contact: Contact | null;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <EditContactInner key={contact?.address ?? "new"} contact={contact} onClose={onClose} />
  );
}

function EditContactInner({
  contact,
  onClose,
}: {
  contact: Contact | null;
  onClose: () => void;
}) {
  const { contacts, addContact, removeContact } = useWalletContacts();
  const { toast } = useToast();
  const [name, setName] = useState(contact?.name ?? "");
  const [address, setAddress] = useState(contact?.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isEdit = contact !== null;

  async function handleSave() {
    const trimmedName = name.trim();
    const trimmedAddr = address.trim();
    const err = validateContact(trimmedName, trimmedAddr);
    if (err) {
      setError(err);
      return;
    }
    const taken = contacts.some(
      (c) =>
        c.address.toLowerCase() === trimmedAddr.toLowerCase() &&
        c.address.toLowerCase() !== (contact?.address ?? "").toLowerCase(),
    );
    if (taken) {
      setError("That address is already saved.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addContact(
        { name: trimmedName, address: trimmedAddr, favorite: contact?.favorite },
        contact?.address,
      );
      triggerHaptic("success");
      toast(isEdit ? "Contact updated" : "Contact saved", "success");
      onClose();
    } catch (saveError) {
      triggerHaptic("error");
      setError(saveError instanceof Error ? saveError.message : "Contact could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!contact) return;
    setBusy(true);
    setError(null);
    try {
      await removeContact(contact.address);
      triggerHaptic("success");
      toast("Contact deleted", "info");
      onClose();
    } catch (deleteError) {
      triggerHaptic("error");
      setError(deleteError instanceof Error ? deleteError.message : "Contact could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        title={isEdit ? "Edit Contact" : "New Contact"}
        subtitle={
          isEdit
            ? "Update saved contact"
            : "Save a Stellar address for quick payments"
        }
        onClose={onClose}
      />
      <div className="space-y-4 p-4 sm:p-6">
        <Field label="Contact Name">
          <input
            className="input text-base sm:text-[14px]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alice"
            maxLength={24}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSave();
            }}
          />
        </Field>
        <Field label="Stellar Public Key">
          <input
            className="input mono text-base sm:text-[13px]"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="G..."
            spellCheck={false}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSave();
            }}
          />
        </Field>
        <ErrorText message={error ?? ""} />
        <div className="grid grid-cols-2 gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={busy}>
            {busy ? "Saving…" : isEdit ? "Save Changes" : "Save Contact"}
          </Button>
        </div>
        {isEdit && (
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={busy}
            className="w-full rounded-xl border border-[#FF453A]/25 bg-[#FF453A]/10 py-2.5 text-[13.5px] font-semibold text-[#FF453A] transition-colors hover:bg-[#FF453A]/15"
          >
            Delete Contact
          </button>
        )}
      </div>
    </Modal>
  );
}
