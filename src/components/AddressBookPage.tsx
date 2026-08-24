"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "./Toast";
import type { Contact } from "@/lib/contacts";
import { triggerHaptic } from "@/lib/haptics";
import { Avatar, Button, HashValue } from "./ui";
import { EditContactModal } from "./EditContactModal";
import { IconBook, IconPlus, IconSearch, IconSend } from "./icons";

export function AddressBookPage({
  onSendTo,
}: {
  onSendTo: (contact: Contact) => void;
}) {
  const { contacts, addContact, toggleContactFavorite } = useWallet();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? contacts.filter(
          (c) =>
            c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q),
        )
      : contacts;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts, query]);

  const favorites = useMemo(() => filtered.filter((c) => c.favorite), [filtered]);

  // iOS Contacts-style alphabetical sections
  const sections = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of filtered) {
      const first = (c.name.trim()[0] ?? "#").toUpperCase();
      const letter = /[A-Z]/.test(first) ? first : "#";
      const bucket = map.get(letter);
      if (bucket) bucket.push(c);
      else map.set(letter, [c]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  function openEditor(contact: Contact | null) {
    triggerHaptic("selection");
    setEditing(contact);
    setEditorOpen(true);
  }

  function handleExport() {
    if (contacts.length === 0) return;
    triggerHaptic("selection");
    const json = JSON.stringify(contacts, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wallet-contacts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    triggerHaptic("success");
    toast("Contacts exported to JSON", "success");
  }

  async function handleImport(file: File) {
    try {
      const text = await file.text();
      const list = JSON.parse(text) as Contact[];
      if (!Array.isArray(list)) throw new Error("Invalid contacts file format.");
      let imported = 0;
      for (const c of list) {
        if (
          c.name &&
          c.address &&
          !contacts.some((existing) => existing.address === c.address)
        ) {
          addContact(c);
          imported++;
        }
      }
      triggerHaptic("success");
      toast(`Imported ${imported} new contact${imported === 1 ? "" : "s"}`, "success");
    } catch {
      triggerHaptic("error");
      toast("Failed to parse contacts JSON", "error");
    }
  }

  return (
    <section className="fade-up mx-auto w-full max-w-[720px] pt-2">
      {/* Header: search + add (app chrome already carries the view title) */}
      <div className="flex items-center gap-2.5 pb-5">
        {contacts.length > 0 && (
          <div className="search-field flex-1">
            <IconSearch size={14} className="shrink-0 text-neutral-400" />
            <input
              placeholder="Search name or address…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-base text-white outline-none placeholder:text-neutral-500 sm:text-[13.5px]"
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => openEditor(null)}
          className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-[0_8px_20px_-6px_rgba(10,132,255,0.55)] transition-all hover:bg-[#2492ff] active:scale-90"
          title="Add Contact"
          aria-label="Add Contact"
        >
          <IconPlus size={17} />
        </button>
      </div>

      {contacts.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center rounded-[28px] border border-white/[0.08] bg-white/[0.02] px-6 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#0A84FF]/25 bg-[#0A84FF]/10 text-[#0A84FF]">
            <IconBook size={26} />
          </span>
          <p className="display-h mt-4 text-[18px] font-semibold text-white">No Contacts Yet</p>
          <p className="mt-1 max-w-[320px] text-[13px] leading-relaxed text-neutral-400">
            Save Stellar addresses to send payments in two taps — no more pasting long keys.
          </p>
          <Button className="mt-6" onClick={() => openEditor(null)}>
            Add Your First Contact
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="px-2 py-10 text-center text-[13px] text-neutral-500">
          No contacts match “{query.trim()}”.
        </p>
      ) : (
        <>
          {/* Favorites rail (iOS Phone-style pinned section) */}
          {favorites.length > 0 && (
            <div>
              <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#FFD60A]">
                ★ Favorites
              </p>
              <div className="list-group">
                {favorites.map((c, i) => (
                  <ContactRow
                    key={c.address}
                    contact={c}
                    sep={i > 0}
                    onSend={() => onSendTo(c)}
                    onToggleFavorite={() => toggleContactFavorite(c.address)}
                    onOpen={() => openEditor(c)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Alphabetical sections */}
          {sections.map(([letter, list]) => (
            <div key={letter} className="pt-5 first:pt-0">
              <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                {letter}
              </p>
              <div className="list-group">
                {list.map((c, i) => (
                  <ContactRow
                    key={c.address}
                    contact={c}
                    sep={i > 0}
                    onSend={() => onSendTo(c)}
                    onToggleFavorite={() => toggleContactFavorite(c.address)}
                    onOpen={() => openEditor(c)}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {/* Import / Export */}
      <div className="mt-6 flex items-center justify-center gap-4 text-[12px] font-medium text-neutral-500">
        {contacts.length > 0 && (
          <>
            <button
              type="button"
              className="transition-colors hover:text-[#0A84FF]"
              onClick={handleExport}
            >
              Export JSON
            </button>
            <span className="h-3 w-px bg-white/10" />
          </>
        )}
        <label className="cursor-pointer transition-colors hover:text-[#0A84FF]">
          Import JSON
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <EditContactModal
        open={editorOpen}
        contact={editing}
        onClose={() => setEditorOpen(false)}
      />
    </section>
  );
}

function ContactRow({
  contact,
  sep,
  onSend,
  onToggleFavorite,
  onOpen,
}: {
  contact: Contact;
  sep: boolean;
  onSend: () => void;
  onToggleFavorite: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group flex w-full cursor-pointer items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-white/[0.04] active:bg-white/[0.07] ${
        sep ? "ios-sep" : ""
      }`}
    >
      <div className="relative shrink-0">
        <Avatar
          seed={contact.address}
          size={38}
          label={contact.name.trim()[0]?.toUpperCase()}
        />
        {contact.favorite && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#FFD60A] text-[9px] font-bold text-black shadow ring-2 ring-black/60">
            ★
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold leading-tight text-white">
          {contact.name}
        </p>
        <HashValue
          value={contact.address}
          head={6}
          tail={6}
          className="mt-0.5 text-[12px] text-neutral-500 transition-colors group-hover:text-neutral-300"
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            triggerHaptic("selection");
            onSend();
          }}
          className="flex items-center gap-1 rounded-full border border-[#0A84FF]/30 bg-[#0A84FF]/12 px-3 py-1 text-[11.5px] font-semibold text-[#0A84FF] transition-all hover:bg-[#0A84FF]/20 active:scale-95 md:opacity-0 md:group-hover:opacity-100"
          title={`Send to ${contact.name}`}
        >
          <IconSend size={11} />
          Send
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            triggerHaptic("selection");
            onToggleFavorite();
          }}
          className={`flex h-7 w-7 items-center justify-center rounded-full text-[13px] transition-all active:scale-90 ${
            contact.favorite
              ? "text-[#FFD60A]"
              : "text-neutral-600 hover:text-[#FFD60A] md:opacity-0 md:group-hover:opacity-100"
          }`}
          title={contact.favorite ? "Remove from Favorites" : "Pin as Favorite"}
          aria-label="Toggle Favorite"
        >
          {contact.favorite ? "★" : "☆"}
        </button>
        <svg
          width="7"
          height="12"
          viewBox="0 0 8 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="ml-0.5 text-neutral-600 transition-colors group-hover:text-neutral-400"
        >
          <path d="m1.5 1.5 5 5.5-5 5.5" />
        </svg>
      </div>
    </div>
  );
}
