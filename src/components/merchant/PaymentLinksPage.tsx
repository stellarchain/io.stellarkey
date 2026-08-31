"use client";

import { useMemo, useState } from "react";
import {
  useMerchantConfiguration,
  useMerchantRecords,
  useMerchantStaff,
  useMerchantStatus,
} from "@/hooks/useMerchant";
import { useLiveNow } from "@/hooks/useLiveNow";
import { triggerHaptic } from "@/lib/haptics";
import { counterCodeAvailability } from "@/lib/merchant/counter-codes";
import { fmtMinor } from "@/lib/merchant/money";
import type { FiatCurrency } from "@/lib/format";
import type { CounterCode, Minor } from "@/lib/merchant/types";
import { useToast } from "../Toast";
import { Button, Dropdown, Notice, SegmentedControl, Toggle } from "../ui";
import { IconCopy, IconPlus } from "../icons";
import { IconPrinter, IconQr, IconTag } from "./icons";
import { Stat, StatStrip } from "./Stat";
import { MerchantDisclosure } from "./Disclosure";
import {
  CODE_KIND_META,
  CodeEditorModal,
  CodeKindIcon,
} from "./LinkEditorModal";
import { CounterPosterModal } from "./CounterPosterModal";

type CodeFilter = "all" | "active" | "retired";

/** Said once, then reused by the chip and the disclosure beside it. */

/** Three dots, the app's own weight. Local: only the code rows need it. */
function IconMore({
  size = 16,
  className,
  label,
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </svg>
  );
}

const FILTERS: { label: string; value: CodeFilter }[] = [
  { label: "All", value: "all" },
  { label: "In use", value: "active" },
  { label: "Retired", value: "retired" },
];

/** Takings are summed inside a currency and never across one. */
function takingsByCurrency(codes: CounterCode[]): { currency: FiatCurrency; minor: Minor }[] {
  const totals = new Map<FiatCurrency, Minor>();
  for (const code of codes) {
    totals.set(code.currency, (totals.get(code.currency) ?? 0) + code.takingsMinor);
  }
  return [...totals.entries()].map(([currency, minor]) => ({ currency, minor }));
}

function ageLabel(createdAt: number, now: number): string {
  const days = Math.max(0, Math.round((now - createdAt) / 86_400_000));
  if (days === 0) return "Saved today";
  if (days === 1) return "Saved yesterday";
  if (days < 60) return `Saved ${days} days ago`;
  return `Saved ${Math.round(days / 30)} months ago`;
}

export function PaymentLinksPage() {
  const {
    counterCodes: codes,
    counterPayments,
    setCounterCodeActive,
  } = useMerchantRecords();
  const { settings } = useMerchantConfiguration();
  const { pollNow, watchError, watching } = useMerchantStatus();
  const { toast } = useToast();

  const [filter, setFilter] = useState<CodeFilter>("all");
  const now = useLiveNow();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CounterCode | null>(null);
  const [posterCode, setPosterCode] = useState<CounterCode | null>(null);

  const shown = useMemo(
    () =>
      codes.filter((code) => {
        const availability = counterCodeAvailability(code, now);
        return filter === "all"
          ? true
          : filter === "active"
            ? availability === "active"
            : availability !== "active";
      }),
    [filter, codes, now],
  );

  const totalPayments = codes.reduce((sum, code) => sum + code.payments, 0);
  const totals = takingsByCurrency(codes);
  const unpricedPayments = counterPayments.filter((payment) => payment.amountMinor === null);

  function openEditor(code: CounterCode | null) {
    triggerHaptic("selection");
    setEditing(code);
    setEditorOpen(true);
  }

  async function handleToggle(code: CounterCode, next: boolean) {
    try {
      await setCounterCodeActive(code.id, next);
      toast(
        next
          ? `${code.title} is back in reconciliation`
          : `${code.title} is retired. A printed card still resolves — take it off the counter.`,
        next ? "success" : "info",
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "The counter code could not be updated.", "error");
    }
  }

  return (
    <section className="fade-up w-full min-w-0 pb-[132px] md:pb-12">
      {/* Everything the codes have taken */}
      <StatStrip className="mb-3 grid-cols-2">
        <Stat label="Payments" value={totalPayments.toLocaleString("en-US")} />
        <Stat
          label="Takings"
          tone="money"
          divider="left"
          value={
            totals.length === 0
              ? fmtMinor(0, settings.currency)
              : totals.map((t) => fmtMinor(t.minor, t.currency)).join(" · ")
          }
        />
      </StatStrip>
      {unpricedPayments.length > 0 && (
        <div className="mb-3">
          <Notice tone="warn">
            {unpricedPayments.length} counter-code {unpricedPayments.length === 1 ? "payment has" : "payments have"} no verified shop-currency price. The ledger payment is retained for review and excluded from takings.
          </Notice>
        </div>
      )}
      {watchError && (
        <div className="mb-3">
          <Notice tone="warn">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{watchError} Counter-code reconciliation will retry automatically.</span>
              <Button variant="secondary" disabled={!watching} onClick={() => void pollNow()}>
                Retry now
              </Button>
            </div>
          </Notice>
        </div>
      )}

      <div className="mb-3 flex items-center gap-2.5">
        <div className="min-w-0 flex-1 sm:max-w-[288px]">
          <SegmentedControl<CodeFilter> ariaLabel="Filter codes" value={filter} options={FILTERS} onChange={setFilter} />
        </div>
        <button
          type="button"
          onClick={() => openEditor(null)}
          className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-[0_8px_20px_-6px_rgba(10,132,255,0.55)] transition-all hover:bg-[#2492ff] active:scale-90"
          title="New code"
          aria-label="New code"
        >
          <IconPlus size={17} />
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center rounded-[20px] border border-white/[0.08] bg-white/[0.02] px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#0A84FF]/12 text-[#0A84FF]">
            <IconQr size={24} />
          </span>
          <p className="mt-4 text-[17px] font-semibold text-white">
            {codes.length === 0 ? "No codes yet" : "Nothing under this filter"}
          </p>
          <p className="mt-1 max-w-[360px] text-[13px] leading-relaxed text-neutral-400">
            {codes.length === 0
              ? "A printed square that asks for money against this shop's own account — a tip jar, a price tag, a fund."
              : `No code is ${filter === "active" ? "in use" : "retired"} right now.`}
          </p>
          <div className="mt-5">
            <Button
              variant="secondary"
              onClick={() => (codes.length === 0 ? openEditor(null) : setFilter("all"))}
            >
              {codes.length === 0 ? "New code" : "Show all codes"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="list-group">
          {shown.map((code, i) => (
            <CodeRow
              key={code.id}
              code={code}
              sep={i > 0}
              now={now}
              onToggle={(next) => handleToggle(code, next)}
              onEdit={() => openEditor(code)}
              onPoster={() => {
                triggerHaptic("selection");
                setPosterCode(code);
              }}
            />
          ))}
        </div>
      )}

      {editorOpen && (
        <CodeEditorModal
          code={editing}
          onClose={() => {
            setEditorOpen(false);
            setEditing(null);
          }}
        />
      )}

      <CounterPosterModal code={posterCode} onClose={() => setPosterCode(null)} />
      {/* The explanation lives under the codes: the figures lead, and the
          mechanism is one tap away for whoever wants it. */}
      <div className="mt-6 border-t border-white/[0.08] pt-4">
        <MerchantDisclosure label="How counter codes work">
          <p>
            A counter code is a SEP-7 request the shop saves once and prints. The paper carries the
            whole thing — the shop&rsquo;s own account, the asset and the memo — so any Stellar
            wallet reads it straight off the card, with nothing in between and nothing held.
          </p>
          <p>
            Payments and takings are what Horizon totals for that code&rsquo;s memo. The ledger is
            the only thing counting, and it counts what arrived rather than who looked.
          </p>
          <p>
            <span className="font-semibold text-white">Retiring is filing, not revoking.</span> A
            card already on a table keeps resolving, because nothing sits between the payer and the
            ledger. Take the paper down.
          </p>
        </MerchantDisclosure>
      </div>

    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */


function CodeRow({
  code,
  sep,
  now,
  onToggle,
  onEdit,
  onPoster,
}: {
  code: CounterCode;
  sep: boolean;
  now: number;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  onPoster: () => void;
}) {
  const { counterCodePayUriFor } = useMerchantRecords();
  const { settings } = useMerchantConfiguration();
  const { staff: staffRoster } = useMerchantStaff();
  const { toast } = useToast();
  const meta = CODE_KIND_META[code.kind];
  const staff = staffRoster.find((member) => member.id === code.staffId) ?? null;
  const availability = counterCodeAvailability(code, now);

  /* The row copies what a wallet reads, for the first asset it accepts. The
     poster is where one code is chosen per asset and printed. */
  const asset = code.acceptedAssets[0] ?? null;
  const uri = asset ? counterCodePayUriFor(code, asset) : null;
  const canShare =
    availability === "active" && code.destination === settings.receivingPublicKey && uri !== null;

  const amountLine =
    code.kind === "fixed" && code.amountMinor !== null
      ? fmtMinor(code.amountMinor, code.currency)
      : code.suggestedMinor.length > 0
        ? code.suggestedMinor.map((minor) => fmtMinor(minor, code.currency)).join(" / ")
        : "Any amount";

  /* One line, in order of what a shopkeeper scans for. What does not fit on a
     phone is still there on a wide row, and all of it is in the editor. */
  const secondary = [
    meta.label.toLowerCase() === code.title.trim().toLowerCase() ? null : meta.label,
    amountLine,
    staff?.name,
    code.acceptedAssets.map((option) => option.code).join("/"),
    code.memoPrefix,
    `${code.payments} payments`,
    availability === "expired" ? "expired" : availability === "paused" ? "retired" : null,
    code.destination !== settings.receivingPublicKey ? "receiving account changed" : null,
    ageLabel(code.createdAt, now).toLowerCase(),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  async function copyRequest() {
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
      triggerHaptic("selection");
      toast(`${code.title} request copied`);
    } catch {
      toast("Could not reach the clipboard");
    }
  }

  return (
    <div
      className={`row-hover flex w-full items-center gap-3.5 px-4 py-3.5 text-left ${
        sep ? "ios-sep" : ""
      }`}
    >
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: `color-mix(in srgb, ${meta.hue} 18%, transparent)`,
          color: meta.hue,
        }}
      >
        <CodeKindIcon kind={code.kind} size={15} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15.5px] font-normal leading-tight text-white">
          {code.title}
        </span>
        <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
          {secondary}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-2">
        <span className="mono text-[14.5px] font-medium text-neutral-400">
          {fmtMinor(code.takingsMinor, code.currency)}
        </span>

        {/* The switch is the state: in use or filed away. */}
        <Toggle
          checked={availability === "active"}
          disabled={availability === "expired"}
          label={`${code.title} in use`}
          onChange={(value) => onToggle(value ?? !code.active)}
        />

        {/* Copying, editing and the poster are second-order: one menu, not three
            buttons repeated down every row. */}
        <Dropdown
          trigger={(open, triggerProps) => (
            <button
              {...triggerProps}
              aria-label={`More actions for ${code.title}`}
              className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-colors before:absolute before:-inset-1.5 before:content-[''] ${
                open
                  ? "bg-white/[0.10] text-white"
                  : "text-neutral-400 hover:bg-white/[0.08] hover:text-white"
              }`}
            >
              <IconMore size={16} />
            </button>
          )}
        >
          {(close) => (
            <div className="p-1">
              {canShare && (
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item !rounded-xl"
                  onClick={() => {
                    close();
                    void copyRequest();
                  }}
                >
                  <IconCopy size={15} />
                  Copy request
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="menu-item !rounded-xl"
                onClick={() => {
                  close();
                  onEdit();
                }}
              >
                <IconTag size={15} />
                Edit code
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu-item !rounded-xl"
                onClick={() => {
                  close();
                  onPoster();
                }}
              >
                <IconPrinter size={15} />
                Counter poster
              </button>
            </div>
          )}
        </Dropdown>
      </span>
    </div>
  );
}
