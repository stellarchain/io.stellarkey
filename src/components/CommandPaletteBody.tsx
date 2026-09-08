"use client";

import { useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { IconSearch } from "./icons";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export interface CommandPaletteBodyProps {
  actions: PaletteAction[];
  /** The shell's initial-focus target; the search field attaches to it. */
  inputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
}

// Mounted fresh by the CommandPalette shell for each opening, so every
// opening starts from an empty search.
export function CommandPaletteBody({ actions, inputRef, onClose }: CommandPaletteBodyProps) {
  const [query, setQuery] = useState("");
  const [cursorRaw, setCursor] = useState(0);

  // This chunk may arrive after the shell's opening focus already settled on
  // the dialog itself; complete that intent without taking focus from a
  // control the user has since chosen.
  useLayoutEffect(() => {
    const input = inputRef.current;
    const panel = input?.closest<HTMLElement>("[data-modal-shell]");
    if (input && panel && document.activeElement === panel) input.focus({ preventScroll: true });
  }, [inputRef]);

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

  function run(action: PaletteAction) {
    action.run();
    onClose();
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b border-white/[0.08] px-5 py-4">
        <IconSearch size={18} className="text-neutral-400 shrink-0" />
        <input
          ref={inputRef}
          aria-label="Search commands, accounts and contacts"
          className="w-full bg-transparent text-[16px] font-medium text-white outline-none placeholder:text-neutral-500"
          placeholder="Type a command or search actions, accounts, contacts…"
          value={query}
          enterKeyHint="go"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const action = filtered[cursor];
              if (action) run(action);
            }
          }}
        />
        <kbd className="mono hidden rounded-lg border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[11px] font-semibold text-neutral-400 sm:block">
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
              className={`flex min-h-11 w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-[14px] transition-colors ${
                i === cursor
                  ? "bg-[#0A84FF] text-white font-medium shadow-sm"
                  : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
              }`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => run(a)}
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
    </>
  );
}
