"use client";

import { useRef, useState } from "react";
import { useWalletContacts } from "@/hooks/useWallet";
import { useToast } from "./Toast";
import { validateContact, type Contact } from "@/lib/contacts";
import { triggerHaptic } from "@/lib/haptics";
import {
  Button,
  ConfirmModal,
  ErrorText,
  Field,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "./ui";

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
  const { contacts, addContact, removeContact } = useWalletContacts();
  const { toast } = useToast();
  const [name, setName] = useState(contact?.name ?? "");
  const [address, setAddress] = useState(contact?.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  const nameRef = useRef<HTMLInputElement>(null);
  const isEdit = contact !== null;

  // Each opening edits the contact it was opened for; the last form never lingers.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName(contact?.name ?? "");
      setAddress(contact?.address ?? "");
      setError(null);
      setConfirmDelete(false);
    }
  }

  const dirty = name !== (contact?.name ?? "") || address !== (contact?.address ?? "");

  async function handleSave() {
    if (busy) return;
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
      toast(isEdit ? "Contact updated" : "Contact saved", "success", { silent: true });
      onClose();
    } catch (saveError) {
      triggerHaptic("error");
      setError(saveError instanceof Error ? saveError.message : "Contact could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!contact || busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeContact(contact.address);
      triggerHaptic("success");
      toast("Contact deleted", "info", { silent: true });
      setConfirmDelete(false);
      onClose();
    } catch (deleteError) {
      triggerHaptic("error");
      setConfirmDelete(false);
      setError(deleteError instanceof Error ? deleteError.message : "Contact could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      busyReason="Wait for the contact to finish saving before closing."
      dirty={dirty}
      initialFocus={nameRef}
    >
      <ModalHeader
        title={isEdit ? "Edit Contact" : "New Contact"}
        subtitle={isEdit ? "Update saved contact" : "Save a Stellar address for quick payments"}
        onClose={onClose}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <ModalBody>
          <Field label="Contact Name">
            <input
              ref={nameRef}
              className="input text-base sm:text-[14px]"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alice"
              maxLength={24}
              enterKeyHint="next"
              autoCorrect="off"
              disabled={busy}
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
              autoCapitalize="none"
              autoCorrect="off"
              enterKeyHint="done"
              disabled={busy}
            />
          </Field>
          <ErrorText message={error ?? ""} />
          <ModalFooter
            secondary={
              <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
            }
            primary={
              <Button type="submit" loading={busy} loadingLabel="Saving contact">
                {isEdit ? "Save Changes" : "Save Contact"}
              </Button>
            }
          />
          {isEdit && (
            <Button
              type="button"
              variant="danger"
              className="w-full"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              Delete contact
            </Button>
          )}
        </ModalBody>
      </form>
      {contact && (
        <ConfirmModal
          open={confirmDelete}
          title="Delete contact?"
          message={`${contact.name} will be removed from your address book.`}
          confirmLabel="Delete Contact"
          destructive
          busy={busy}
          onConfirm={() => void handleDelete()}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
