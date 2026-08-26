"use client";

/**
 * The two quiet primitives Merchant Mode uses to keep its screens calm without
 * losing a word of what it owes the reader.
 *
 * `MerchantDisclosure` is a collapsed region: mechanism, protocol detail and
 * honesty disclosures live inside it rather than permanently across the middle
 * of a screen a barista uses at a counter. Nothing is deleted — it is one tap
 * away, announced properly, and closed by default.
 *
 * the sentence survives as the chip's tooltip and inside the disclosure beside
 * it, but it stops occupying a full-width amber alert on every screen at once.
 *
 * Neither writes, fetches or stores anything.
 */

import { useId, useState, type ReactNode } from "react";
import { triggerHaptic } from "@/lib/haptics";
import { IconChevronDown } from "../icons";

/**
 * A real `<button>` toggling a real region — `aria-expanded` on the trigger,
 * `aria-controls` pointing at the panel, and the panel labelled back by the
 * trigger. Collapsed content is not rendered, so it is out of the reading order
 * as well as out of the way.
 *
 * The chevron's rotation is a CSS transition, which the app's global
 * `prefers-reduced-motion` rule already flattens; `motion-reduce:transition-none`
 * says so locally too, so the primitive is correct on its own.
 */
export function MerchantDisclosure({
  label = "How this works",
  children,
  className = "",
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const triggerId = `${uid}-trigger`;
  const regionId = `${uid}-region`;

  return (
    <div className={`min-w-0 ${className}`}>
      <button
        type="button"
        id={triggerId}
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => {
          triggerHaptic("selection");
          setOpen((was) => !was);
        }}
        className="-mx-1 flex min-h-[44px] items-center gap-1.5 rounded-lg px-1 text-left text-[12.5px] font-medium text-neutral-400 transition-colors hover:text-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A84FF]"
      >
        <span className="min-w-0 truncate">{label}</span>
        <IconChevronDown
          size={13}
          className={`chevron shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      <div id={regionId} role="region" aria-labelledby={triggerId} hidden={!open}>
        {open && (
          <div className="space-y-2 pb-1 text-[12.5px] leading-relaxed text-neutral-400">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The standing "these figures are fixtures" condition, as a chip rather than an
 * alert. Neutral on purpose: amber is for what needs doing, and this only needs
 * knowing. The full sentence rides along in `title` and is repeated in whatever
 * disclosure sits beside it.
 */
