"use client";

import { STELLAR_MARK_PATH } from "./icons";

/**
 * Marks a payment or asset as private: a small filled shield carrying the
 * Stellar glyph in white, docked onto the corner of its leading icon. The
 * ground ring matches the panel behind it so the notch reads as attached.
 * The visible label appears on hover and whenever the control that carries
 * the notch has keyboard focus; the sr-only copy names it for everyone else.
 */
export function PrivateShieldNotch({
  ground = 17,
  shield = 13,
  label = "Private payment",
}: {
  ground?: number;
  shield?: number;
  label?: string;
}) {
  return (
    <>
      <span
        className="group/private-notch absolute bottom-0 right-0 z-20 flex items-center justify-center rounded-full"
        style={{ width: ground, height: ground, background: "var(--color-panel, #1c1c1e)" }}
      >
        <svg aria-hidden="true" width={shield} height={shield} viewBox="0 0 24 24">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="#0A84FF" />
          <path
            transform="translate(6.24 4.98) scale(0.48)"
            d={STELLAR_MARK_PATH}
            fill="#ffffff"
          />
        </svg>
        <span
          role="tooltip"
          aria-hidden="true"
          className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 hidden whitespace-nowrap rounded-lg border border-white/10 bg-[#2c2c2e] px-2 py-1 text-[10px] font-semibold text-neutral-100 shadow-lg group-hover/private-notch:block group-focus-within/private-notch:block [:is(button,a):focus-visible_&]:block"
        >
          {label}
        </span>
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}
