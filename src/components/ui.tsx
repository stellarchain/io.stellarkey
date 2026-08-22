"use client";

import { useEffect, useRef, useState } from "react";
import { triggerHaptic } from "@/lib/haptics";
import { IconCheck, IconClose, IconCopy } from "./icons";

export function Spinner({ className }: { className?: string }) {
  return <span className={`spinner ${className ?? ""}`} aria-hidden />;
}

type ButtonVariant = "primary" | "ghost" | "danger" | "secondary";

export function Button({
  children,
  onClick,
  variant = "primary",
  loading = false,
  disabled = false,
  type = "button",
  className,
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  className?: string;
}) {
  const variantClass =
    variant === "ghost"
      ? "btn-ghost"
      : variant === "danger"
        ? "btn-danger"
        : variant === "secondary"
          ? "btn-secondary"
          : "btn-primary";

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={(e) => {
        triggerHaptic(variant === "danger" ? "warning" : "light");
        if (onClick) onClick(e);
      }}
      className={`btn ${variantClass} ${className ?? ""}`}
    >
      {loading ? <Spinner className="text-current" /> : children}
    </button>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-left">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold tracking-tight text-neutral-300">
          {label}
        </span>
        {hint && <span className="text-[11px] text-neutral-500">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-[11px] font-medium text-[#FF453A]">{error}</p>}
    </label>
  );
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
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && dismissable) {
        triggerHaptic("selection");
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, dismissable]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === backdropRef.current && dismissable) {
          triggerHaptic("selection");
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-md sm:items-center sm:p-4"
    >
      <div
        className={`fade-up relative max-h-[92vh] w-full overflow-y-auto rounded-t-[28px] border-t border-white/[0.12] bg-[#121214]/95 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] backdrop-blur-2xl sm:rounded-[28px] sm:border sm:border-white/[0.12] ${
          wide ? "max-w-xl" : "max-w-md"
        }`}
      >
        {/* iOS sheet grab bar */}
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden">
          <div className="h-1 w-9 rounded-full bg-white/25" />
        </div>
        {children}
      </div>
    </div>
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
  return (
    <div className="relative flex items-center justify-between border-b border-white/[0.08] px-6 py-4">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight text-white">{title}</h2>
        {subtitle && <p className="text-[12px] text-neutral-400">{subtitle}</p>}
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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <div
        onClick={() => {
          triggerHaptic("selection");
          setOpen((v) => !v);
        }}
      >
        {trigger(open)}
      </div>
      {open && (
        <div
          className={`fade-in absolute z-40 mt-2 min-w-[220px] overflow-hidden rounded-2xl border border-white/[0.12] bg-[#1a1a1e]/95 p-1.5 shadow-2xl backdrop-blur-2xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children(() => setOpen(false))}
        </div>
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

export function ErrorText({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[#FF453A]/30 bg-[#FF453A]/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-[#FF453A]">
      <span className="font-semibold shrink-0">!</span>
      <span>{message}</span>
    </div>
  );
}

export function Avatar({ seed, size = 32 }: { seed: string; size?: number }) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue1 = hash % 360;
  const hue2 = (hue1 + 55) % 360;

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white shadow-inner"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue1}, 85%, 55%), hsl(${hue2}, 85%, 45%))`,
        fontSize: Math.max(10, Math.floor(size * 0.38)),
      }}
    >
      {seed.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => {
        triggerHaptic("selection");
        onChange();
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        on ? "bg-[#30D158]" : "bg-white/20"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
