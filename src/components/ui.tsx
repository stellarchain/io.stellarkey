"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { triggerHaptic } from "@/lib/haptics";
import { IconCheck, IconChevronDown, IconClose, IconCopy } from "./icons";

/** Shared panel chrome for modal surfaces (Modal, CommandPalette). */
export const MODAL_PANEL_CLASS =
  "rounded-[28px] border border-white/[0.12] bg-[#121214]/95 shadow-[0_25px_70px_-15px_rgba(0,0,0,0.9)] backdrop-blur-2xl";

/** Shared chrome for floating popover surfaces (Select, Dropdown). */
const POPOVER_PANEL_CLASS =
  "menu-pop fixed z-[70] overflow-y-auto overscroll-contain rounded-2xl border border-white/[0.12] bg-[#1e1e22]/95 p-1.5 shadow-[0_24px_60px_-18px_rgba(0,0,0,0.9)] backdrop-blur-2xl";

const ModalLabelContext = React.createContext<{
  titleId: string;
  descriptionId: string;
} | null>(null);

/* Reference-counted body scroll lock so nested overlays don't fight. */
let scrollLockCount = 0;
function lockBodyScroll() {
  scrollLockCount += 1;
  if (scrollLockCount === 1) document.body.style.overflow = "hidden";
}
function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) document.body.style.overflow = "";
}

export function Modal({
  open,
  onClose,
  children,
  wide = false,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  dismissable?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const labelBaseId = React.useId();
  const titleId = `${labelBaseId}-title`;
  const descriptionId = `${labelBaseId}-description`;

  // Stay mounted briefly after `open` flips false so the exit animation plays.
  // (State adjusted during render per https://react.dev/learn/you-might-not-need-an-effect)
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
    }
  }

  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, 180);
    return () => window.clearTimeout(t);
  }, [closing]);

  // Scroll lock + focus restore for as long as the dialog is in the tree.
  useEffect(() => {
    if (!mounted) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    lockBodyScroll();
    window.requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      (first ?? panelRef.current)?.focus({ preventScroll: true });
    });
    return () => {
      unlockBodyScroll();
      restoreFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [mounted]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && dismissable) {
        triggerHaptic("selection");
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusable = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.offsetParent !== null);
        if (focusable.length === 0) {
          e.preventDefault();
          panelRef.current.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, dismissable]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onMouseDown={(e) => {
        if (e.target === backdropRef.current && dismissable) {
          triggerHaptic("selection");
          onClose();
        }
      }}
      className={`modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md${closing ? " closing" : ""}`}
    >
      <ModalLabelContext.Provider value={{ titleId, descriptionId }}>
        <div
          ref={panelRef}
          tabIndex={-1}
          className={`modal-dialog relative max-h-[90dvh] w-full overflow-y-auto scrollbar-none overscroll-contain ${MODAL_PANEL_CLASS} ${
            wide ? "max-w-xl" : "max-w-md"
          }${closing ? " closing" : ""}`}
        >
          {children}
        </div>
      </ModalLabelContext.Provider>
    </div>,
    document.body,
  );
}

export function ModalHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose?: () => void;
}) {
  const labels = React.useContext(ModalLabelContext);
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.08] bg-[#121214]/80 px-6 py-4 backdrop-blur-xl">
      <div>
        <h2 id={labels?.titleId} className="text-[17px] font-bold tracking-tight text-white">{title}</h2>
        {subtitle ? (
          <p id={labels?.descriptionId} className="text-[12px] text-neutral-400 mt-0.5">{subtitle}</p>
        ) : (
          <span id={labels?.descriptionId} className="sr-only">Dialog</span>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={() => {
            triggerHaptic("selection");
            onClose();
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-neutral-400 transition-colors hover:bg-white/15 hover:text-white"
          aria-label="Close"
        >
          <IconClose size={14} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Popover engine — shared portal positioning for Select and Dropdown. */
/* ------------------------------------------------------------------ */

interface PopoverPos {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  openUp: boolean;
}

function usePopover({
  open,
  onClose,
  anchorRef,
  align = "left",
  matchAnchorWidth = true,
  minWidth = 200,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  align?: "left" | "right";
  matchAnchorWidth?: boolean;
  minWidth?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PopoverPos | null>(null);

  // Position against the anchor; flip above when space below runs out.
  useEffect(() => {
    if (!open) return;
    function update() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const gap = 6;
      const margin = 8;
      const spaceBelow = window.innerHeight - r.bottom - gap - margin;
      const spaceAbove = r.top - gap - margin;
      const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
      const width = Math.min(320, Math.max(r.width, matchAnchorWidth ? 0 : minWidth, minWidth));
      const desiredLeft = align === "right" ? r.right - width : r.left;
      const left = Math.min(
        Math.max(margin, desiredLeft),
        Math.max(margin, window.innerWidth - width - margin),
      );
      setPos({
        top: openUp ? undefined : r.bottom + gap,
        bottom: openUp ? window.innerHeight - r.top + gap : undefined,
        left,
        width,
        maxHeight: Math.max(120, Math.min(300, openUp ? spaceAbove : spaceBelow)),
        openUp,
      });
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef, align, matchAnchorWidth, minWidth]);

  // Outside-click and Escape dismissal. Escape uses capture + stopPropagation
  // so closing a popover never closes a parent modal underneath it.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose, anchorRef]);

  return { panelRef, pos };
}

function popoverStyle(pos: PopoverPos): React.CSSProperties {
  return {
    top: pos.top,
    bottom: pos.bottom,
    left: pos.left,
    width: pos.width,
    maxHeight: pos.maxHeight,
    "--pop-origin": pos.openUp ? "bottom" : "top",
    "--pop-shift": pos.openUp ? "4px" : "-4px",
  } as React.CSSProperties;
}

export interface SelectOption {
  value: string;
  label: string;
  /** Right-aligned meta text in the panel row (balance, unit name…). */
  sublabel?: string;
  /** Override for the closed trigger text (defaults to label + sublabel). */
  triggerLabel?: string;
  disabled?: boolean;
}

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled = false,
  size = "md",
  className = "",
  ariaLabel,
  panelMinWidth,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  size?: "md" | "sm";
  className?: string;
  ariaLabel?: string;
  panelMinWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const close = useCallback(() => setOpen(false), []);
  const { panelRef, pos } = usePopover({
    open,
    onClose: close,
    anchorRef,
    matchAnchorWidth: size === "md",
    minWidth: panelMinWidth ?? 180,
  });

  function openMenu() {
    if (disabled) return;
    triggerHaptic("selection");
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function closeMenu(refocus = false) {
    setOpen(false);
    if (refocus) anchorRef.current?.focus({ preventScroll: true });
  }

  function choose(opt: SelectOption) {
    if (opt.disabled) return;
    triggerHaptic("selection");
    onChange(opt.value);
    closeMenu(true);
  }

  // Keyboard navigation + typeahead while the listbox is open.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((i) => {
          let next = i;
          for (let n = 0; n < options.length; n++) {
            next = (next + dir + options.length) % options.length;
            if (!options[next]?.disabled) break;
          }
          return next;
        });
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        const opt = options[activeIndex];
        if (opt) choose(opt);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeMenu(true);
      } else if (e.key === "Tab") {
        setOpen(false);
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const buf = typeahead.current;
        const now = Date.now();
        buf.text = (now - buf.at < 600 ? buf.text : "") + e.key.toLowerCase();
        buf.at = now;
        const idx = options.findIndex(
          (o) => !o.disabled && o.label.toLowerCase().startsWith(buf.text),
        );
        if (idx >= 0) setActiveIndex(idx);
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  });

  // Keep the active option in view while navigating.
  useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, panelRef]);

  const triggerProps: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    ref: React.RefObject<HTMLButtonElement | null>;
  } = {
    ref: anchorRef,
    type: "button",
    disabled,
    "aria-haspopup": "listbox",
    "aria-expanded": open,
    "aria-label": ariaLabel,
    onClick: () => (open ? closeMenu() : openMenu()),
    onKeyDown: (e) => {
      if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        openMenu();
      }
    },
  };

  return (
    <>
      {size === "md" ? (
        <button
          {...triggerProps}
          className={`input flex cursor-pointer items-center justify-between gap-2 !pr-3.5 text-left text-[14px] ${
            open ? "shadow-[0_0_0_3.5px_rgba(10,132,255,0.35)]" : ""
          } ${className}`}
        >
          <span className="min-w-0 flex-1 truncate">
            {selected ? (
              selected.triggerLabel ?? (
                <>
                  {selected.label}
                  {selected.sublabel && (
                    <span className="text-neutral-500"> · {selected.sublabel}</span>
                  )}
                </>
              )
            ) : (
              <span className="text-[rgba(235,235,245,0.38)]">{placeholder}</span>
            )}
          </span>
          <IconChevronDown
            size={16}
            className={`shrink-0 text-neutral-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
      ) : (
        <button
          {...triggerProps}
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.08] py-1.5 pl-3 pr-2 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.14] ${className}`}
        >
          <span className="max-w-[160px] truncate">
            {selected ? (selected.triggerLabel ?? selected.label) : placeholder}
          </span>
          <IconChevronDown
            size={13}
            className={`shrink-0 text-neutral-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
      )}
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label={ariaLabel}
            className={POPOVER_PANEL_CLASS}
            style={popoverStyle(pos)}
          >
            {options.length === 0 && (
              <p className="px-3 py-6 text-center text-[12.5px] text-neutral-500">
                Nothing to choose from
              </p>
            )}
            {options.map((opt, i) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value || `option-${i}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-index={i}
                  disabled={opt.disabled}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => choose(opt)}
                  className={`mb-0.5 flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] transition-colors duration-100 last:mb-0 ${
                    i === activeIndex
                      ? "bg-white/[0.08] text-white"
                      : "text-neutral-300"
                  } ${opt.disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{opt.label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {opt.sublabel && (
                      <span className="mono whitespace-nowrap text-[11.5px] text-neutral-500">
                        {opt.sublabel}
                      </span>
                    )}
                    {isSelected && (
                      <IconCheck size={14} className="shrink-0 text-[#0A84FF]" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

export function Dropdown({
  trigger,
  children,
  align = "right",
}: {
  trigger: (open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const { panelRef, pos } = usePopover({
    open,
    onClose: close,
    anchorRef,
    align,
    matchAnchorWidth: false,
    minWidth: 220,
  });

  return (
    <div ref={anchorRef} className="inline-block text-left">
      <div
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          triggerHaptic("selection");
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            triggerHaptic("selection");
            setOpen((o) => !o);
          }
        }}
      >
        {trigger(open)}
      </div>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            className={POPOVER_PANEL_CLASS}
            style={popoverStyle(pos)}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function CopyButton({
  value,
  label,
  className,
  iconSize = 13,
}: {
  value: string;
  label?: string;
  className?: string;
  iconSize?: number;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      triggerHaptic("selection");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={className ?? "chip"}
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <>
          <IconCheck size={iconSize} className="text-[#30D158]" />
          <span>Copied</span>
        </>
      ) : (
        <>
          <IconCopy size={iconSize} />
          {label && <span>{label}</span>}
        </>
      )}
    </button>
  );
}

/**
 * Trezor-style hash/address display (mirrors hardware-wallet conventions):
 * values render in monospace split into 4-character verification chunks.
 * Default mode keeps everything on one line via a middle ellipsis
 * (head … tail, chunked); `full` shows every chunk, wrapping only at
 * chunk boundaries — never mid-group. Click anywhere to copy the full
 * value; the complete string is also exposed via the hover tooltip.
 */
export function HashValue({
  value,
  head = 8,
  tail = 8,
  full = false,
  className = "",
}: {
  value: string;
  head?: number;
  tail?: number;
  full?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const truncate = !full && value.length > head + tail + 4;
  const chunkable = !/\s/.test(value);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      triggerHaptic("selection");
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  const chunks = (s: string, prefix: string) =>
    (s.match(/.{1,4}/g) ?? [s]).map((c, i) => <span key={`${prefix}${i}`}>{c}</span>);

  if (!chunkable) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void copy();
        }}
        title={`${value}\nClick to copy`}
        className={`mono inline-block max-w-full cursor-pointer text-left transition-colors ${
          copied ? "!text-[#30D158]" : ""
        } ${className}`}
      >
        {value}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void copy();
      }}
      title={`${value}\nClick to copy`}
      className={`mono inline-flex max-w-full cursor-pointer items-baseline gap-x-[0.45em] gap-y-0.5 text-left transition-colors ${
        truncate ? "flex-nowrap whitespace-nowrap" : "flex-wrap"
      } ${copied ? "!text-[#30D158]" : ""} ${className}`}
    >
      {truncate ? (
        <>
          {chunks(value.slice(0, head), "h")}
          <span className={copied ? "font-bold" : "text-neutral-500"}>
            {copied ? "✓" : "…"}
          </span>
          {chunks(value.slice(-tail), "t")}
        </>
      ) : (
        chunks(value, "f")
      )}
    </button>
  );
}

export function NetworkBadge({ network }: { network: "testnet" | "mainnet" }) {
  const isTest = network === "testnet";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
        isTest
          ? "bg-[#FF9F0A]/15 text-[#FF9F0A] border border-[#FF9F0A]/30"
          : "bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isTest ? "bg-[#FF9F0A]" : "bg-[#30D158]"
        }`}
      />
      {isTest ? "Testnet" : "Mainnet"}
    </span>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { label: string; value: T }[];
  onChange: (val: T) => void;
}) {
  return (
    <div className="flex items-center rounded-xl bg-white/[0.08] p-1 backdrop-blur-md">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              if (!active) {
                triggerHaptic("selection");
                onChange(opt.value);
              }
            }}
            className={`relative flex-1 rounded-[9px] py-1 text-center text-[12px] font-medium transition-all ${
              active
                ? "bg-white/[0.18] text-white shadow-sm font-semibold"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="spinner inline-block align-middle"
      style={{ width: size, height: size }}
    />
  );
}

export function Button({
  children,
  className = "",
  variant = "primary",
  loading = false,
  disabled = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
}) {
  const vClass =
    variant === "primary"
      ? "btn-primary"
      : variant === "danger"
        ? "bg-[#FF453A] text-white hover:bg-[#FF3B30] shadow-sm"
        : variant === "secondary"
          ? "bg-white/[0.08] text-white hover:bg-white/[0.14] border border-white/10"
          : "btn-ghost";

  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`btn ${vClass} ${className}`}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const generatedId = React.useId();
  const errorId = `${generatedId}-error`;
  const controlId = React.isValidElement<{ id?: string }>(children)
    ? children.props.id ?? generatedId
    : generatedId;
  const control = React.isValidElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }>(children)
    ? React.cloneElement(children, {
        id: controlId,
        ...(error ? { "aria-describedby": errorId, "aria-invalid": true } : {}),
      })
    : children;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={controlId} className="field-label !pb-0">{label}</label>
        {hint && <span className="text-[11px] text-neutral-400">{hint}</span>}
      </div>
      {control}
      {error && <p id={errorId} role="alert" className="text-[11.5px] text-[#FF453A]">{error}</p>}
    </div>
  );
}

export function ErrorText({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl border border-[#FF453A]/30 bg-[#FF453A]/10 p-3 text-[12px] text-[#FF453A] leading-relaxed">
      {message}
    </div>
  );
}

export function Notice({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "warn" | "pos";
}) {
  const styles =
    tone === "pos"
      ? "border-[#30D158]/30 bg-[#30D158]/10 text-neutral-200"
      : tone === "warn"
        ? "border-[#FF9F0A]/30 bg-[#FF9F0A]/10 text-neutral-200"
        : "border-white/10 bg-white/[0.04] text-neutral-300";

  return (
    <div className={`rounded-2xl border p-4 text-[13px] leading-relaxed ${styles}`}>
      {children}
    </div>
  );
}

export function Toggle({
  checked,
  on,
  onChange,
  disabled = false,
  label,
}: {
  checked?: boolean;
  on?: boolean;
  onChange: (c?: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const isChecked = checked ?? on ?? false;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      disabled={disabled}
      onClick={() => {
        triggerHaptic("selection");
        onChange(!isChecked);
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        isChecked ? "bg-[#30D158]" : "bg-neutral-700"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span className="sr-only">{label ?? "Toggle"}</span>
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
          isChecked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function Avatar({
  seed,
  size = 32,
  label,
}: {
  seed: string;
  size?: number;
  /** Overrides the displayed initial (defaults to first char of seed). */
  label?: string;
}) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue1 = hash % 360;
  const hue2 = (hash + 120) % 360;

  return (
    <div
      className="shrink-0 rounded-full flex items-center justify-center font-bold text-white shadow-inner"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue1}, 70%, 50%), hsl(${hue2}, 70%, 40%))`,
        fontSize: size * 0.4,
      }}
    >
      {label ?? seed.slice(0, 1)}
    </div>
  );
}

export function QrScannerBox({
  onScan,
  onClose,
}: {
  onScan: (val: string) => void;
  onClose?: () => void;
}) {
  const [inputVal, setInputVal] = useState("");

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
      <div className="flex items-center justify-between text-[12px] font-semibold text-white">
        <span>Enter QR Payload</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scanner"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-neutral-400 transition-colors hover:bg-white/15 hover:text-white"
        >
          <IconClose size={11} />
        </button>
      </div>
      <div className="h-40 rounded-xl bg-black/50 border border-dashed border-white/20 flex flex-col items-center justify-center p-4 text-center">
        <p className="text-[12px] text-neutral-400">
          Paste the address or SEP-7 payload read by your device&apos;s QR scanner.
        </p>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Paste scanned address or URI..."
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          className="input mono text-[12px] flex-1 !h-8"
        />
        <Button
          variant="secondary"
          className="!h-8 !px-3 text-[12px]"
          onClick={() => {
            if (inputVal.trim()) {
              triggerHaptic("success");
              onScan(inputVal.trim());
            }
          }}
        >
          Submit
        </Button>
      </div>
    </div>
  );
}
