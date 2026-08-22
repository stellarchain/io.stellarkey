"use client";

import React, { useEffect, useRef, useState } from "react";
import { triggerHaptic } from "@/lib/haptics";
import { IconCheck, IconClose, IconCopy } from "./icons";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
    >
      <div
        className={`fade-up relative max-h-[90dvh] w-full overflow-y-auto scrollbar-none overscroll-contain rounded-[28px] border border-white/[0.12] bg-[#121214]/95 shadow-[0_25px_70px_-15px_rgba(0,0,0,0.9)] backdrop-blur-2xl ${
          wide ? "max-w-xl" : "max-w-md"
        }`}
      >
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
        <h2 className="text-[17px] font-bold tracking-tight text-white">{title}</h2>
        {subtitle && <p className="text-[12px] text-neutral-400 mt-0.5">{subtitle}</p>}
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
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <div
        role="button"
        tabIndex={0}
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
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="field-label !pb-0">{label}</label>
        {hint && <span className="text-[11px] text-neutral-400">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-[11.5px] text-[#FF453A]">{error}</p>}
    </div>
  );
}

export function ErrorText({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-[#FF453A]/30 bg-[#FF453A]/10 p-3 text-[12px] text-[#FF453A] leading-relaxed">
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

export function Avatar({ seed, size = 32 }: { seed: string; size?: number }) {
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
      {seed.slice(0, 1)}
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
        <span>Scan QR Code</span>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-400 hover:text-white"
        >
          ✕
        </button>
      </div>
      <div className="h-40 rounded-xl bg-black/50 border border-dashed border-white/20 flex flex-col items-center justify-center p-4 text-center">
        <p className="text-[12px] text-neutral-400">
          Point camera at QR code or paste payload below
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
