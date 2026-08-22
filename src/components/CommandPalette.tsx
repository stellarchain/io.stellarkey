"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { triggerHaptic } from "@/lib/haptics";
import { IconSearch } from "./icons";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
}) {
  if (!open) return null;
  return <PaletteInner onClose={onClose} actions={actions} />;
}

function PaletteInner({
  onClose,
  actions,
}: {
  onClose: () => void;
  actions: PaletteAction[];
}) {
  const [query, setQuery] = useState("");
  const [cursorRaw, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        (a.hint ?? "").toLowerCase().includes(q),
    );
  }, [actions, query]);
  const cursor = Math.max(0, Math.min(cursorRaw, filtered.length - 1));

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 p-4 pt-[15vh] backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          triggerHaptic("selection");
          onClose();
        }
      }}
    >
      <div className="fade-up w-full max-w-[540px] overflow-hidden rounded-[28px] border border-white/[0.12] bg-[#121214]/95 shadow-[0_25px_70px_-15px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
        <div className="flex items-center gap-3 border-b border-white/[0.08] px-5 py-4">
          <IconSearch size={18} className="text-neutral-400 shrink-0" />
          <input
            ref={inputRef}
            className="w-full bg-transparent text-[16px] font-medium text-white outline-none placeholder:text-neutral-500"
            placeholder="Type a command or search actions, accounts, contacts…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                triggerHaptic("selection");
                setCursor((c) => Math.min(c + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                triggerHaptic("selection");
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (filtered[cursor]) {
                  triggerHaptic("selection");
                  filtered[cursor].run();
                  onClose();
                }
              } else if (e.key === "Escape") {
                triggerHaptic("selection");
                onClose();
              }
            }}
          />
          <kbd className="mono rounded-lg border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[11px] font-semibold text-neutral-400">
            ESC
          </kbd>
        </div>
        <div className="max-h-[360px] overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-[13.5px] text-neutral-500">
              No matching commands found.
            </p>
          )}
          {filtered.map((a, i) => {
            const isAccount = a.id.startsWith("acc-");
            const isContact = a.id.startsWith("contact-");
            const badge = isAccount
              ? "Account"
              : isContact
                ? "Contact"
                : "Action";
            return (
              <button
                key={a.id}
                type="button"
                className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-[14px] transition-colors ${
                  i === cursor
                    ? "bg-[#0A84FF] text-white font-medium shadow-sm"
                    : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                }`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => {
                  triggerHaptic("selection");
                  a.run();
                  onClose();
                }}
              >
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider rounded-md px-1.5 py-0.5 shrink-0 ${
                      i === cursor
                        ? "bg-white/20 text-white"
                        : "bg-white/[0.06] text-neutral-400"
                    }`}
                  >
                    {badge}
                  </span>
                  <span className="truncate">{a.label}</span>
                </div>
                {a.hint && (
                  <span
                    className={`mono text-[12px] shrink-0 ${
                      i === cursor ? "text-white/80" : "text-neutral-400"
                    }`}
                  >
                    {a.hint}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
