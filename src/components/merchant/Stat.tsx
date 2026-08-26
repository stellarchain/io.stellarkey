"use client";

import type { ReactNode } from "react";

/**
 * The merchant summary strip.
 *
 * Every merchant page opens with the same shape — a single `panel-inset` row of
 * figures, 61px tall, hairlines between the cells. It lived in five near-identical
 * copies before this, which is why Invoices grew taller cards and Insights grew a
 * 164px block: with no shared definition there was nothing to drift from.
 *
 * A cell is a label and a figure. Anything that needs a third line needs its own
 * panel further down the page instead.
 */

export type StatTone = "ink" | "money" | "warn" | "bad";

const TONE: Record<StatTone, string> = {
  ink: "text-white",
  money: "text-[#30D158]",
  warn: "text-[#FF9F0A]",
  bad: "text-[#FF453A]",
};

/**
 * Which edges carry a hairline. A strip that stays on one line only ever needs
 * "left"; the "top" forms exist for the one strip that wraps to two rows on a
 * phone, where the second row needs a rule above it that goes away once the
 * cells sit on a single line again.
 */
export type StatDivider = "left" | "top" | "left-top";

const DIVIDER: Record<StatDivider, string> = {
  left: "border-l border-white/[0.08]",
  top: "border-t border-white/[0.08] sm:border-t-0",
  "left-top": "border-l border-t border-white/[0.08] sm:border-t-0",
};

/** A change against the comparison period, shown beside the figure it qualifies. */
export interface StatDelta {
  label: string;
  /** Up is not automatically good, so the caller decides the tone. */
  tone: StatTone;
}

export function Stat({
  label,
  value,
  tone = "ink",
  delta,
  divider,
  children,
}: {
  label: string;
  value?: string;
  tone?: StatTone;
  delta?: StatDelta;
  /** Set on every cell after the first. */
  divider?: StatDivider;
  /** A cell that draws something instead of a figure, such as a sparkline. */
  children?: ReactNode;
}) {
  return (
    <div className={`min-w-0 px-3 py-2.5 ${divider ? DIVIDER[divider] : ""}`}>
      <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
        {label}
      </p>
      {children ?? (
        <p className="mt-0.5 flex items-baseline gap-1.5 truncate">
          <span className={`mono truncate text-[15.5px] font-semibold ${TONE[tone]}`}>{value}</span>
          {delta && (
            <span className={`mono shrink-0 text-[11px] font-semibold ${TONE[delta.tone]}`}>
              {delta.label}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * The strip itself. Pass `columns` when the cells want unequal widths — a
 * takings cell needs more room than an order count — or leave it off and give
 * the grid classes in `className` when the strip needs to wrap on a phone.
 */
export function StatStrip({
  columns,
  className = "",
  children,
}: {
  columns?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`panel-inset grid ${className}`}
      style={columns ? { gridTemplateColumns: columns } : undefined}
    >
      {children}
    </div>
  );
}
