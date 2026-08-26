"use client";

import { triggerHaptic } from "@/lib/haptics";
import { IconWallet } from "../icons";
import { IconStorefront } from "./icons";

export type ShellMode = "wallet" | "merchant";

const OPTIONS: { value: ShellMode; label: string }[] = [
  { value: "wallet", label: "Wallet" },
  { value: "merchant", label: "Merchant" },
];

/**
 * Wallet / Merchant, in the app's own segmented control. The sidebar shows one
 * mode's navigation at a time rather than stacking two lists, so this sits above
 * search: the mode is the higher-level choice, and search is scoped to it.
 */
export function ModeSwitcher({
  mode,
  onChange,
}: {
  mode: ShellMode;
  onChange: (next: ShellMode) => void;
}) {
  const index = mode === "merchant" ? 1 : 0;

  return (
    <div className="seg" role="group" aria-label="Wallet or Merchant mode">
      <span
        className="seg-thumb"
        aria-hidden
        style={{
          left: `calc(2px + ${index} * ((100% - 4px) / 2))`,
          width: "calc((100% - 4px) / 2)",
        }}
      />
      {OPTIONS.map((option) => {
        const active = option.value === mode;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (active) return;
              triggerHaptic("selection");
              onChange(option.value);
            }}
            className={`flex items-center justify-center gap-1.5 ${active ? "on" : ""}`}
          >
            {option.value === "merchant" ? (
              <IconStorefront size={14} className="shrink-0 text-[#30D158]" />
            ) : (
              <IconWallet size={14} className="shrink-0" />
            )}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
