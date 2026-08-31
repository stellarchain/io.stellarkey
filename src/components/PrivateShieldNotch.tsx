"use client";

import { STELLAR_MARK_PATH } from "./icons";

/**
 * Marks a payment row as private: a small filled shield carrying the Stellar
 * glyph in white, docked onto the corner of the row's leading direction
 * circle. The ground ring matches the panel behind the row so the notch reads
 * as attached rather than stacked.
 */
export function PrivateShieldNotch({
  ground = 17,
  shield = 13,
}: {
  ground?: number;
  shield?: number;
}) {
  return (
    <>
      <span
        className="group/private-notch absolute -bottom-1 -right-1 z-20 flex items-center justify-center rounded-full"
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
          className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 hidden whitespace-nowrap rounded-lg border border-white/10 bg-[#2c2c2e] px-2 py-1 text-[10px] font-semibold text-neutral-100 shadow-lg group-hover/private-notch:block"
        >
          Private payment
        </span>
      </span>
      <span className="sr-only">Private payment</span>
    </>
  );
}
