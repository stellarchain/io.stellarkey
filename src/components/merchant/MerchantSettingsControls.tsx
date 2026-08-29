"use client";

import { useState, type ReactNode } from "react";
import { triggerHaptic } from "@/lib/haptics";

export function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsCaption({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "warn";
}) {
  return (
    <p
      className={`px-1 text-[12px] leading-relaxed ${
        tone === "warn" ? "text-[#FF9F0A]" : "text-neutral-400"
      }`}
    >
      {children}
    </p>
  );
}

function Chevron() {
  return (
    <svg
      className="chevron shrink-0"
      width="8"
      height="14"
      viewBox="0 0 8 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m1.5 1.5 5 5.5-5 5.5" />
    </svg>
  );
}

export function SettingsRow({
  icon,
  tint,
  label,
  sub,
  value,
  chevron,
  danger,
  first = false,
  opensDialog = false,
  onClick,
  children,
}: {
  icon: ReactNode;
  tint?: string;
  label: ReactNode;
  sub?: string;
  value?: ReactNode;
  chevron?: boolean;
  danger?: boolean;
  first?: boolean;
  opensDialog?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const content = (
    <>
      {tint ? (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
          style={{ background: tint }}
        >
          {icon}
        </span>
      ) : (
        icon
      )}
      <span className="min-w-0 flex-1">
        {typeof label === "string" ? (
          <span
            className={`block truncate text-[15.5px] font-normal leading-tight ${
              danger ? "text-[#FF6961]" : "text-white"
            }`}
          >
            {label}
          </span>
        ) : (
          label
        )}
        {sub && (
          <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
            {sub}
          </span>
        )}
      </span>
      {value !== undefined && (
        <span className="max-w-[42%] shrink-0 truncate text-right text-[14.5px] font-medium text-neutral-400">
          {value}
        </span>
      )}
      {children}
      {chevron && <Chevron />}
    </>
  );
  const className = `${onClick ? "row-hover " : ""}flex min-h-14 w-full items-center gap-3.5 px-4 py-3.5 text-left ${
    first ? "" : "ios-sep"
  }`;

  if (onClick) {
    return (
      <button
        type="button"
        aria-haspopup={opensDialog ? "dialog" : undefined}
        onClick={() => {
          triggerHaptic("selection");
          onClick();
        }}
        className={className}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

export function DraftInput({
  value,
  onCommit,
  ariaLabel,
  placeholder,
  className = "",
  inputMode,
  multiline = false,
  inline = false,
  align = "right",
}: {
  value: string;
  onCommit: (next: string) => string;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  inputMode?: "text" | "decimal" | "numeric";
  multiline?: boolean;
  inline?: boolean;
  align?: "left" | "right";
}) {
  const [draft, setDraft] = useState(value);

  function commit() {
    setDraft(onCommit(draft));
  }

  if (multiline) {
    return (
      <textarea
        rows={3}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        className={`input resize-none text-base sm:text-[13.5px] ${className}`}
      />
    );
  }

  return (
    <input
      type="text"
      aria-label={ariaLabel}
      placeholder={placeholder}
      inputMode={inputMode}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={
        inline
          ? `w-full min-w-0 rounded-lg bg-transparent py-1.5 text-base leading-tight text-white outline-none placeholder:text-neutral-500 focus:bg-white/[0.06] sm:text-[15.5px] ${
              align === "right" ? "text-right" : ""
            } ${className}`
          : `input text-base sm:text-[13.5px] ${className}`
      }
    />
  );
}

export function TextRow({
  icon,
  tint,
  label,
  sub,
  suffix,
  first = false,
  ...input
}: {
  icon: ReactNode;
  tint: string;
  label: string;
  sub?: string;
  suffix?: string;
  first?: boolean;
} & Omit<React.ComponentProps<typeof DraftInput>, "ariaLabel" | "multiline" | "inline">) {
  return (
    <SettingsRow icon={icon} tint={tint} label={label} sub={sub} first={first}>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-1">
        <DraftInput ariaLabel={label} inline {...input} />
        {suffix && <span className="shrink-0 text-[15.5px] text-neutral-400">{suffix}</span>}
      </span>
    </SettingsRow>
  );
}

export function ChoiceRow({
  label,
  sub,
  icon,
  tint,
  first = false,
  children,
}: {
  label: string;
  sub?: string;
  icon: ReactNode;
  tint: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`px-4 py-3.5 sm:flex sm:items-center sm:gap-4 ${
        first ? "" : "border-t border-white/[0.08]"
      }`}
    >
      <span
        className="mb-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-sm sm:mb-0"
        style={{ background: tint }}
      >
        {icon}
      </span>
      <span className="min-w-0 sm:flex-1">
        <span className="field-label sm:pb-0 sm:text-[15.5px] sm:font-normal sm:leading-tight sm:text-white">
          {label}
        </span>
        {sub && (
          <span className="mono block truncate pb-1.5 text-[12px] leading-tight text-neutral-400 sm:pb-0">
            {sub}
          </span>
        )}
      </span>
      <div className="min-w-0 sm:w-[320px] sm:shrink-0">{children}</div>
    </div>
  );
}

export function NoteRow({ children }: { children: ReactNode }) {
  return (
    <p className="border-t border-white/[0.08] px-4 py-3 text-[12px] leading-relaxed text-neutral-400">
      {children}
    </p>
  );
}

export function SheetBody({
  sheet,
  children,
}: {
  sheet: string;
  children: ReactNode;
}) {
  return (
    <div data-merchant-settings-sheet={sheet} className="space-y-5 p-4 sm:p-6">
      {children}
    </div>
  );
}
