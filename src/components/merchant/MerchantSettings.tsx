"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { useWallet } from "@/hooks/useWallet";
import { triggerHaptic } from "@/lib/haptics";
import { formatTrezorAddress } from "@/lib/address-display";
import { fmtAmount, FIAT_SYMBOLS, type FiatCurrency } from "@/lib/format";
import { sameAsset } from "@/lib/merchant/charge";
import { minorToDecimal, toMinor } from "@/lib/merchant/money";
import type {
  SettlementSwapIntent,
  SettlementSweepIntent,
} from "@/lib/merchant/settlement";
import type { AcceptedAsset, TaxMode, TipMode } from "@/lib/merchant/types";
import { BASE_RESERVE_XLM } from "@/lib/stellar";
import type { SettingsSub } from "../SettingsPage";
import { Avatar, Notice, SegmentedControl, Select, Toggle } from "../ui";
import { useToast } from "../Toast";
import {
  IconArrowUpRight,
  IconChevronDown,
  IconFileText,
  IconShield,
  IconSwap,
  IconUsers,
  IconWallet,
} from "../icons";
import {
  IconClock,
  IconPercent,
  IconPrinter,
  IconReceipt,
  IconStorefront,
  IconTerminal,
  IconXCircle,
} from "./icons";
import { MerchantDisclosure } from "./Disclosure";
import { ReceiptSheet } from "./ReceiptSheet";

const CURRENCIES: FiatCurrency[] = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"];

/** The four bands a shop actually chooses between; anything wider is a bad fill. */
const SLIPPAGE_OPTIONS = [
  { value: "10", label: "0.10 %" },
  { value: "25", label: "0.25 %" },
  { value: "50", label: "0.50 %" },
  { value: "100", label: "1.00 %" },
];

/** Local time on this device: the hour the till asks, never one it acts on. */
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));

const EXPIRY_OPTIONS = [
  { seconds: 300, label: "5 minutes" },
  { seconds: 600, label: "10 minutes" },
  { seconds: 900, label: "15 minutes" },
  { seconds: 1800, label: "30 minutes" },
];

/* ---------------- row primitives ----------------
   Everything below is the wallet's own settings row, copied from
   `SettingsPage`'s `RowButton`: one line, an optional mono sub-line, and the
   control on the right. Nothing on this screen is taller than that unless it is
   a field that genuinely stacks. */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The sentence the app prints under a group rather than inside a row. */
function Caption({ children, tone }: { children: ReactNode; tone?: "warn" }) {
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
      className="chevron"
      width="8"
      height="14"
      viewBox="0 0 8 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m1.5 1.5 5 5.5-5 5.5" />
    </svg>
  );
}

/**
 * The canonical row, copied from `SettingsPage`'s `RowButton`. `onClick` makes
 * it a button; without one it is a plain row carrying its control. `ios-sep` is
 * inset for the 28px leading icon every row here has.
 */
function Row({
  icon,
  tint,
  label,
  sub,
  value,
  chevron,
  danger,
  first = false,
  onClick,
  children,
}: {
  icon: ReactNode;
  tint?: string;
  /** A string title, or the control that stands in for one. */
  label: ReactNode;
  sub?: string;
  value?: string;
  chevron?: boolean;
  danger?: boolean;
  first?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={
        onClick
          ? () => {
              triggerHaptic("selection");
              onClick();
            }
          : undefined
      }
      className={`${onClick ? "row-hover " : ""}flex w-full items-center gap-3.5 px-4 py-3.5 text-left ${
        first ? "" : "ios-sep"
      }`}
    >
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
              danger ? "text-[#FF453A]" : "text-white"
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
      {value && <span className="text-[14.5px] font-medium text-neutral-400">{value}</span>}
      {children}
      {chevron && <Chevron />}
    </Tag>
  );
}

/** A row whose control is a field: label left, the value editable on the right. */
function TextRow({
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
    <Row icon={icon} tint={tint} label={label} sub={sub} first={first}>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-1">
        <DraftInput ariaLabel={label} inline {...input} />
        {suffix && <span className="shrink-0 text-[15.5px] text-neutral-400">{suffix}</span>}
      </span>
    </Row>
  );
}

/**
 * A row whose control is too wide to sit beside its label on a phone. It stacks
 * there and sits side by side from `sm` up, where the label reads as an ordinary
 * row title. No leading icon, so the separator is full width.
 */
function ChoiceRow({
  label,
  sub,
  icon,
  tint,
  first = false,
  children,
}: {
  label: string;
  sub?: string;
  /** Every row in these groups is icon-led; a bare one reads as unfinished. */
  icon?: ReactNode;
  tint?: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`px-4 py-3.5 sm:flex sm:items-center sm:gap-4 ${
        first ? "" : "border-t border-white/[0.08]"
      }`}
    >
      {icon && (
        <span
          className="mb-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-sm sm:mb-0"
          style={{ background: tint }}
        >
          {icon}
        </span>
      )}
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

/** A footnote that belongs to the rows above it and stays inside their group. */
function NoteRow({ children }: { children: ReactNode }) {
  return (
    <p className="border-t border-white/[0.08] px-4 py-3 text-[12px] leading-relaxed text-neutral-400">
      {children}
    </p>
  );
}

/**
 * The quiet foot of a section: the knobs a shop touches once, if ever. It is a
 * real disclosure — a button owning a region it names — so nothing is removed,
 * it is simply not shouted on a screen someone is setting up for the first time.
 * Collapsed content stays mounted behind `hidden`, so a half-typed value in it
 * survives a collapse.
 */
function Advanced({ label = "Advanced", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => {
          triggerHaptic("selection");
          setOpen((previous) => !previous);
        }}
        className="row-hover flex w-full items-center gap-2 border-t border-white/[0.08] px-4 py-3 text-left"
      >
        <span className="flex-1 text-[13.5px] font-medium text-neutral-400">{label}</span>
        <IconChevronDown
          size={14}
          className={`chevron transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div id={regionId} hidden={!open}>
        {children}
      </div>
    </>
  );
}

/**
 * A text control that keeps the half-typed value locally and writes through on
 * blur. `onCommit` returns the canonical string to show, so a rejected entry
 * snaps back to what is actually stored.
 */
function DraftInput({
  value,
  onCommit,
  ariaLabel,
  placeholder,
  className = "",
  inputMode,
  multiline = false,
  inline = false,
  align = "right",
  id,
}: {
  value: string;
  onCommit: (next: string) => string;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  inputMode?: "text" | "decimal" | "numeric";
  multiline?: boolean;
  /** Sits on the right of a row rather than under a label. */
  inline?: boolean;
  align?: "left" | "right";
  id?: string;
}) {
  const [draft, setDraft] = useState(value);

  function commit() {
    setDraft(onCommit(draft));
  }

  if (multiline) {
    return (
      <textarea
        id={id}
        rows={2}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className={`input resize-none text-base sm:text-[13.5px] ${className}`}
      />
    );
  }

  return (
    <input
      id={id}
      type="text"
      aria-label={ariaLabel}
      placeholder={placeholder}
      inputMode={inputMode}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
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

/* ---------------- the page ---------------- */

export function MerchantSettings({
  onDisabled,
  onNavigate,
  onOpenSwap,
  onOpenSend,
}: {
  onDisabled: () => void;
  /** Absent when this screen is shown outside the Settings stack; rows go inert. */
  onNavigate?: (sub: SettingsSub) => void;
  /** The wallet's DEX Swap — where a conversion is actually made and signed. */
  onOpenSwap?: (intent: SettlementSwapIntent) => void;
  /** The wallet's Send — where a sweep is actually made and signed. */
  onOpenSend?: (intent: SettlementSweepIntent) => void;
}) {
  const {
    settings,
    updateSettings,
    setEnabled,
    orders,
    charges,
    staff,
    terminal,
    peripherals,
    settlementRule,
    settlementHandoffs,
    updateSettlementRule,
    storageHealth,
    requestPersistentStorage,
  } = useMerchant();
  const { accounts, balances } = useWallet();
  const { toast } = useToast();

  const [receiptPreviewOpen, setReceiptPreviewOpen] = useState(false);
  const receiptPreviewOrder = orders.find((order) => order.status === "paid") ?? null;
  const receiptPreviewHash = receiptPreviewOrder
    ? charges.find((charge) => charge.orderId === receiptPreviewOrder.id)?.payment?.transactionHash ?? null
    : null;

  const symbol = FIAT_SYMBOLS[settings.currency] ?? "";

  const accountOptions = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.publicKey,
        label: account.label,
        sublabel: formatTrezorAddress(account.publicKey),
      })),
    [accounts],
  );

  /** XLM, plus every credit asset this wallet actually holds a trustline for. */
  const assetChoices = useMemo(() => {
    const list: AcceptedAsset[] = [{ code: "XLM", issuer: null }];
    for (const balance of balances ?? []) {
      if (balance.isNative || balance.issuer === null) continue;
      const asset: AcceptedAsset = { code: balance.code, issuer: balance.issuer };
      if (list.some((existing) => sameAsset(existing, asset))) continue;
      list.push(asset);
    }
    for (const accepted of settings.acceptedAssets) {
      if (!list.some((existing) => sameAsset(existing, accepted))) list.push(accepted);
    }
    return list;
  }, [balances, settings.acceptedAssets]);

  const receivingAccount = accounts.find(
    (account) => account.publicKey === settings.receivingPublicKey,
  );

  /* Every credit trustline is one subentry, and each one raises the reserve this
     account can never spend. Counted off the balances the wallet has already
     loaded — nothing is fetched for it. */
  const subentries = (balances ?? []).filter(
    (balance) => !balance.isNative && balance.issuer !== null,
  ).length;
  const reserveXlm = BASE_RESERVE_XLM * (2 + subentries);
  const askAt = `${String(settlementRule.sweepPromptHour ?? 21).padStart(2, "0")}:00`;
  const treasury = settlementRule.sweepDestination ?? "";

  function changeSettlementRule(patch: Parameters<typeof updateSettlementRule>[0]): void {
    void updateSettlementRule(patch).catch((error: unknown) => {
      toast(
        error instanceof Error ? error.message : "Settlement settings could not be saved.",
        "error",
      );
    });
  }

  const staffCount = staff.filter((member) => member.active).length;
  const availablePeripherals = peripherals.filter((item) => item.connected).length;

  function toggleAsset(asset: AcceptedAsset, on: boolean) {
    updateSettings({
      acceptedAssets: on
        ? [...settings.acceptedAssets, asset]
        : settings.acceptedAssets.filter((existing) => !sameAsset(existing, asset)),
    });
  }

  /** "1.50, 2.00" → minor units, or null when any part is not an amount. */
  function parseMinorList(raw: string): number[] | null {
    const parts = raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length === 0) return null;
    try {
      const minors = parts.map((part) => toMinor(part));
      return minors.some((minor) => minor <= 0) ? null : minors;
    } catch {
      return null;
    }
  }

  async function handleTurnOff() {
    triggerHaptic("warning");
    try {
      await setEnabled(false);
      toast("Merchant Mode turned off", "success");
      onDisabled();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Merchant Mode could not be changed.", "error");
    }
  }

  async function handlePersistentStorage() {
    const granted = await requestPersistentStorage();
    toast(
      granted
        ? "This browser granted persistent offline storage."
        : "Storage remains best effort. Keep an encrypted wallet backup current.",
      granted ? "success" : "info",
    );
  }

  return (
    <div className="pb-2">
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
        <div data-merchant-settings-column="payments" className="space-y-6">
      {/* ---------- SHOP ---------- */}
      <Section title="Shop">
        <div className="list-group">
          <TextRow
            first
            icon={<IconStorefront size={16} />}
            tint="#30D158"
            label="Shop name"
            value={settings.profile.name}
            placeholder="Rua Coffee"
            onCommit={(next) => {
              const name = next.trim();
              updateSettings({ profile: { ...settings.profile, name } });
              return name;
            }}
          />
          <TextRow
            icon={<IconReceipt size={16} />}
            tint="#64D2FF"
            label="Tax ID"
            value={settings.profile.taxId}
            placeholder="PT123456789"
            className="mono"
            onCommit={(next) => {
              const taxId = next.trim();
              updateSettings({ profile: { ...settings.profile, taxId } });
              return taxId;
            }}
          />
          <ChoiceRow
            icon={<IconStorefront size={16} />}
            tint="#30D158"
            label="Address"
            sub="One line each"
          >
            <DraftInput
              ariaLabel="Address"
              multiline
              value={settings.profile.addressLines.join("\n")}
              placeholder={"12 Rua da Prata\n1100-052 Lisboa"}
              onCommit={(next) => {
                const addressLines = next
                  .split("\n")
                  .map((line) => line.trim())
                  .filter((line) => line.length > 0);
                updateSettings({ profile: { ...settings.profile, addressLines } });
                return addressLines.join("\n");
              }}
            />
          </ChoiceRow>

          <Advanced>
            <TextRow
              icon={<IconReceipt size={16} />}
              tint="#5E5CE6"
              label="Receipt footer"
              value={settings.profile.receiptFooter}
              placeholder="Thank you — see you again"
              onCommit={(next) => {
                const receiptFooter = next.trim();
                updateSettings({ profile: { ...settings.profile, receiptFooter } });
                return receiptFooter;
              }}
            />
            <Row
              icon={<IconReceipt size={16} />}
              tint="#5E5CE6"
              label="Latest receipt"
              sub={receiptPreviewOrder ? `Preview order ${receiptPreviewOrder.number}` : "Complete a sale to preview it"}
              chevron={receiptPreviewOrder !== null}
              onClick={receiptPreviewOrder ? () => setReceiptPreviewOpen(true) : undefined}
            />
          </Advanced>
        </div>
        <Caption>
          The name, address and tax ID print on every receipt, and the name is carried in every
          charge reference.
        </Caption>
      </Section>

      {/* ---------- MONEY ---------- */}
      <Section title="Money">
        {!settings.receivingPublicKey && (
          <Notice tone="warn">
            Charges are paused until you choose the account that receives payments.
          </Notice>
        )}
        <div className="list-group">
          <Row
            first
            icon={<IconWallet size={16} />}
            tint="#30D158"
            label="Receiving account"
            sub={
              receivingAccount
                ? formatTrezorAddress(receivingAccount.publicKey)
                : "Paid straight to your own account"
            }
          >
            <Select
              size="sm"
              className="shrink-0"
              value={settings.receivingPublicKey ?? ""}
              options={accountOptions}
              placeholder="Choose"
              ariaLabel="Receiving account"
              onChange={(publicKey) => updateSettings({ receivingPublicKey: publicKey })}
            />
          </Row>

          <Row
            icon={<span className="mono text-[12px] font-bold">{symbol}</span>}
            tint="#64D2FF"
            label="Display currency"
            sub="The books are kept in this currency"
          >
            <Select
              size="sm"
              className="shrink-0"
              value={settings.currency}
              options={CURRENCIES.map((code) => ({
                value: code,
                label: code,
                sublabel: FIAT_SYMBOLS[code],
              }))}
              ariaLabel="Display currency"
              onChange={(next) => {
                const currency = CURRENCIES.find((code) => code === next);
                if (currency) updateSettings({ currency });
              }}
            />
          </Row>

          {/* Three knobs a shop sets once, if ever. Nothing here is removed — the
              wording that explains each one travels with it. */}
          <Advanced>
            <Row
              icon={<IconClock size={16} />}
              tint="#FF9F0A"
              label="Charge expires after"
              sub="The held quote cannot move mid-sale"
            >
              <Select
                size="sm"
                className="shrink-0"
                value={String(settings.chargeExpirySeconds)}
                options={EXPIRY_OPTIONS.map((option) => ({
                  value: String(option.seconds),
                  label: option.label,
                }))}
                ariaLabel="Charge expiry"
                onChange={(next) => {
                  const chargeExpirySeconds = Number.parseInt(next, 10);
                  if (Number.isFinite(chargeExpirySeconds)) updateSettings({ chargeExpirySeconds });
                }}
              />
            </Row>

            <TextRow
              icon={<IconPercent size={16} />}
              tint="#BF5AF2"
              label="Amount tolerance"
              sub="Only on a payment that arrives with no memo"
              suffix="%"
              value={(settings.toleranceBps / 100).toFixed(2)}
              inputMode="decimal"
              className="mono"
              onCommit={(next) => {
                const percent = Number.parseFloat(next.replace(",", "."));
                if (!Number.isFinite(percent) || percent < 0 || percent > 20) {
                  toast("A tolerance between 0 and 20 percent is required.", "error");
                  return (settings.toleranceBps / 100).toFixed(2);
                }
                const toleranceBps = Math.round(percent * 100);
                updateSettings({ toleranceBps });
                return (toleranceBps / 100).toFixed(2);
              }}
            />

            <Row
              icon={<IconClock size={16} />}
              tint="#FF9F0A"
              label="Hold auto-lock during a charge"
              sub="The till stays awake until the charge closes"
            >
              <Toggle
                on={settings.holdAutoLockDuringCharge}
                label="Hold auto-lock while a charge is open"
                onChange={() =>
                  updateSettings({ holdAutoLockDuringCharge: !settings.holdAutoLockDuringCharge })
                }
              />
            </Row>

            <NoteRow>
              Tolerance is used only to settle a single remaining candidate; an exact match is tried
              first. The idle timer resets on pointer and key events alone, so without the hold a
              customer-facing screen locks mid-charge and stops the payment watcher.
            </NoteRow>
          </Advanced>
        </div>
      </Section>

      {/* ---------- ACCEPTED ASSETS ---------- */}
      <Section title="Accepted assets">
        <div className="list-group">
          {assetChoices.map((asset, index) => {
            const on = settings.acceptedAssets.some((accepted) => sameAsset(accepted, asset));
            return (
              <Row
                key={`${asset.code}:${asset.issuer ?? "native"}`}
                first={index === 0}
                icon={
                  <Avatar
                    seed={`${asset.code}:${asset.issuer ?? "native"}`}
                    size={28}
                    label={asset.code.slice(0, 1)}
                  />
                }
                label={asset.code}
                sub={asset.issuer === null ? "Native" : formatTrezorAddress(asset.issuer)}
              >
                <Toggle
                  on={on}
                  label={`Accept ${asset.code}`}
                  onChange={() => toggleAsset(asset, !on)}
                />
              </Row>
            );
          })}
        </div>
        {settings.acceptedAssets.length === 0 ? (
          <Caption tone="warn">A charge needs at least one accepted asset.</Caption>
        ) : (
          <Caption>Assets are quoted into the display currency when a charge is raised.</Caption>
        )}
      </Section>

      {/* ---------- SETTLEMENT ----------
          What used to be a Payouts page. Held balances are Home's job, a
          conversion is DEX Swap's, a sweep is Send's and the ledger is
          Activity's — all four already exist in this wallet. The only part that
          was ever merchant-specific is the rule, and a rule is a setting. */}
      <Section title="Settlement">
        <div className="list-group">
          <Row
            first
            icon={<IconSwap size={16} />}
            tint="#5E5CE6"
            label="Convert takings"
            sub={`Into ${settings.settlementAsset.code} at settlement`}
          >
            <Toggle
              on={settlementRule.autoConvert}
              label="Convert takings at settlement"
              onChange={() =>
                changeSettlementRule({ autoConvert: !settlementRule.autoConvert })
              }
            />
          </Row>

          <Row
            icon={<IconPercent size={16} />}
            tint="#BF5AF2"
            label="Maximum slippage"
            sub="Or the swap fails whole"
          >
            <Select
              size="sm"
              className="shrink-0"
              value={String(settlementRule.maxSlippageBps)}
              options={SLIPPAGE_OPTIONS}
              ariaLabel="Maximum slippage"
              onChange={(next) => {
                const bps = Number.parseInt(next, 10);
                if (Number.isFinite(bps)) changeSettlementRule({ maxSlippageBps: bps });
              }}
            />
          </Row>

          <TextRow
            icon={<IconArrowUpRight size={16} />}
            tint="#0A84FF"
            label="Sweep above"
            sub={`Asked above this, in ${symbol}`}
            value={minorToDecimal(settlementRule.sweepAboveMinor ?? 0)}
            inputMode="decimal"
            className="mono"
            onCommit={(next) => {
              const parsed = parseMinorList(next);
              if (!parsed || parsed.length !== 1) {
                toast("Give a single amount, such as 500.00.", "error");
                return minorToDecimal(settlementRule.sweepAboveMinor ?? 0);
              }
              changeSettlementRule({
                sweepAboveMinor: parsed[0],
                sweepPromptHour: settlementRule.sweepPromptHour ?? 21,
              });
              return minorToDecimal(parsed[0]);
            }}
          />

          <TextRow
            icon={<IconWallet size={16} />}
            tint="#30D158"
            label="Retained float"
            sub={`Never swept, in ${symbol}`}
            value={minorToDecimal(settlementRule.retainedFloatMinor)}
            inputMode="decimal"
            className="mono"
            onCommit={(next) => {
              const parsed = parseMinorList(next);
              if (!parsed || parsed.length !== 1) {
                toast("Give a single amount, such as 200.00.", "error");
                return minorToDecimal(settlementRule.retainedFloatMinor);
              }
              changeSettlementRule({ retainedFloatMinor: parsed[0] });
              return minorToDecimal(parsed[0]);
            }}
          />

          <ChoiceRow
            icon={<IconShield size={16} />}
            tint="#5E5CE6"
            label="Treasury"
            sub={formatTrezorAddress(treasury)}
          >
            <DraftInput
              ariaLabel="Treasury account"
              className="mono"
              placeholder="G…"
              value={treasury}
              onCommit={(next) => {
                const address = next.trim().toUpperCase();
                changeSettlementRule({
                  sweepDestination: address || null,
                  sweepPromptHour: address ? settlementRule.sweepPromptHour ?? 21 : null,
                });
                return address;
              }}
            />
          </ChoiceRow>

          <Row
            icon={<IconClock size={16} />}
            tint="#FF9F0A"
            label="Ask at"
            sub="Local time on this device"
          >
            <Select
              size="sm"
              className="shrink-0"
              value={String(settlementRule.sweepPromptHour ?? 21)}
              options={HOUR_OPTIONS}
              ariaLabel="Hour the till offers the sweep"
              onChange={(next) => {
                const hour = Number.parseInt(next, 10);
                if (Number.isFinite(hour)) changeSettlementRule({ sweepPromptHour: hour });
              }}
            />
          </Row>
        </div>
        <Caption>
          Nothing moves on its own. A conversion is a swap and a sweep is a payment, and both need
          the vault — so at {askAt} the till asks, and someone signs.
        </Caption>

        {/* The two jobs, pointed at the screens that already do them rather than
            rebuilt behind a second set of controls. */}
        <div className="list-group">
          {settlementHandoffs.swaps.map((intent, index) => (
            <Row
              key={intent.contextId}
              first={index === 0}
              icon={<IconSwap size={16} />}
              tint="#5E5CE6"
              label={`Convert ${intent.sourceAsset.code} in DEX Swap`}
              sub={`${fmtAmount(intent.amount)} ${intent.sourceAsset.code} → ${intent.destinationAsset.code}`}
              chevron={Boolean(onOpenSwap)}
              onClick={onOpenSwap ? () => onOpenSwap(intent) : undefined}
            />
          ))}
          {settlementHandoffs.swaps.length === 0 && (
            <Row
              first
              icon={<IconSwap size={16} />}
              tint="#5E5CE6"
              label="No conversion due"
              sub={
                settlementRule.autoConvert
                  ? "No priced accepted balance is ready"
                  : "Automatic conversion prompts are off"
              }
            />
          )}
          <Row
            icon={<IconArrowUpRight size={16} />}
            tint="#0A84FF"
            label={settlementHandoffs.sweep ? "Review treasury sweep in Send" : "No sweep due"}
            sub={
              settlementHandoffs.sweep
                ? `${fmtAmount(settlementHandoffs.sweep.amount)} ${settlementHandoffs.sweep.asset.code} to ${formatTrezorAddress(settlementHandoffs.sweep.destination)}`
                : treasury
                  ? `Nothing ready for ${formatTrezorAddress(treasury)}`
                  : "Add a treasury address to enable sweep prompts"
            }
            chevron={Boolean(onOpenSend && settlementHandoffs.sweep)}
            onClick={
              onOpenSend && settlementHandoffs.sweep
                ? () => onOpenSend(settlementHandoffs.sweep as SettlementSweepIntent)
                : undefined
            }
          />
        </div>
        {settlementHandoffs.blocked.length > 0 && (
          <Caption tone="warn">{settlementHandoffs.blocked[0]}</Caption>
        )}

        {/* The arithmetic behind the float: at the foot, under a hairline, and
            closed until someone wants it. */}
        <div className="border-t border-white/[0.08] px-1 pt-1">
          <MerchantDisclosure label="Why a sweep never goes to zero">
            <p>Three things have to stay behind, and the float is what covers them.</p>
            <ul className="space-y-1.5">
              <li>
                <span className="font-semibold text-neutral-200">Reserve</span> —{" "}
                <span className="mono text-neutral-300">base_reserve × (2 + subentries)</span>, so{" "}
                <span className="mono">
                  {fmtAmount(BASE_RESERVE_XLM)} × (2 + {subentries}) = {fmtAmount(reserveXlm)} XLM
                </span>{" "}
                on this account. Held by the protocol and unspendable.
              </li>
              <li>
                <span className="font-semibold text-neutral-200">Fee headroom</span> — every
                conversion, sweep and refund is itself a transaction. An account swept flat cannot
                pay the fee to move again.
              </li>
              <li>
                <span className="font-semibold text-neutral-200">Refund headroom</span> — a refund is
                an ordinary outbound payment, made at the counter in front of the customer. It cannot
                wait for money to come back from the treasury.
              </li>
            </ul>
            <p>
              The hour is local to this device, so a till that was shut asks the next time it opens,
              and it only asks once the account holds more than the threshold.
            </p>
          </MerchantDisclosure>
        </div>
      </Section>

        </div>
        <div data-merchant-settings-column="operations" className="space-y-6">

      {/* ---------- TAX ---------- */}
      <Section title="Tax">
        <div className="list-group">
          <ChoiceRow first icon={<IconPercent size={16} />} tint="#FF9F0A" label="Tax mode">
            <SegmentedControl<TaxMode>
              value={settings.taxMode}
              options={[
                { label: "Included in price", value: "inclusive" },
                { label: "Added at checkout", value: "added" },
              ]}
              onChange={(taxMode) => updateSettings({ taxMode })}
            />
          </ChoiceRow>

          <Row
            icon={<IconFileText size={16} />}
            tint="#BF5AF2"
            label="Tax records"
            sub="Filing periods, exports and adjustments"
            chevron={Boolean(onNavigate)}
            onClick={onNavigate && (() => onNavigate("tax"))}
          />

          <Advanced>
            <Row
              icon={<IconPercent size={16} />}
              tint="#BF5AF2"
              label="Keypad amounts use"
              sub="An amount with no catalogue line behind it"
            >
              <Select
                size="sm"
                className="shrink-0"
                value={settings.defaultTaxRateId}
                options={settings.taxRates.map((rate) => ({
                  value: rate.id,
                  label: rate.label,
                  sublabel: `${rate.percent} %`,
                }))}
                ariaLabel="Rate applied to keypad amounts"
                onChange={(defaultTaxRateId) => updateSettings({ defaultTaxRateId })}
              />
            </Row>
          </Advanced>
        </div>
        <Caption>
          {settings.taxMode === "inclusive"
            ? "Catalogue prices already contain tax; the ticket shows what is inside them."
            : "Catalogue prices are net; tax is added to the ticket at checkout."}
        </Caption>
      </Section>

      {/* ---------- TAX RATES ---------- */}
      <Section title="Rates">
        <div className="list-group">
          {settings.taxRates.map((rate, index) => (
            <Row
              key={rate.id}
              first={index === 0}
              icon={<IconPercent size={16} />}
              tint="#BF5AF2"
              label={
                <DraftInput
                  inline
                  align="left"
                  ariaLabel={`Name of the ${rate.label} rate`}
                  value={rate.label}
                  onCommit={(next) => {
                    const label = next.trim();
                    if (!label) return rate.label;
                    updateSettings({
                      taxRates: settings.taxRates.map((existing) =>
                        existing.id === rate.id ? { ...existing, label } : existing,
                      ),
                    });
                    return label;
                  }}
                />
              }
            >
              <span className="flex w-[92px] shrink-0 items-center gap-1">
                <DraftInput
                  inline
                  ariaLabel={`Percent of the ${rate.label} rate`}
                  inputMode="decimal"
                  value={String(rate.percent)}
                  className="mono"
                  onCommit={(next) => {
                    const percent = Number.parseFloat(next.replace(",", "."));
                    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
                      toast("A tax rate must be between 0 and 100 percent.", "error");
                      return String(rate.percent);
                    }
                    updateSettings({
                      taxRates: settings.taxRates.map((existing) =>
                        existing.id === rate.id ? { ...existing, percent } : existing,
                      ),
                    });
                    return String(percent);
                  }}
                />
                <span className="shrink-0 text-[15.5px] text-neutral-400">%</span>
              </span>
            </Row>
          ))}
        </div>
        <Caption>
          A rate is named on each catalogue item; keypad amounts take the keypad default.
        </Caption>
      </Section>

      {/* ---------- TIPS ---------- */}
      <Section title="Tips">
        <div className="list-group">
          <ChoiceRow first icon={<IconReceipt size={16} />} tint="#BF5AF2" label="Tip prompt">
            <SegmentedControl<TipMode>
              value={settings.tips.mode}
              options={[
                { label: "Off", value: "off" },
                { label: "Percentage", value: "percent" },
                { label: "Fixed", value: "fixed" },
              ]}
              onChange={(mode) => updateSettings({ tips: { ...settings.tips, mode } })}
            />
          </ChoiceRow>

          {settings.tips.mode === "percent" && (
            <TextRow
              icon={<IconPercent size={16} />}
              tint="#BF5AF2"
              label="Percentage presets"
              sub="Comma separated"
              value={settings.tips.percents.join(", ")}
              inputMode="decimal"
              className="mono"
              onCommit={(next) => {
                const percents = next
                  .split(",")
                  .map((part) => Number.parseFloat(part.trim().replace(",", ".")))
                  .filter((value) => Number.isFinite(value) && value > 0 && value <= 100);
                if (percents.length === 0) {
                  toast("Give at least one percentage between 0 and 100.", "error");
                  return settings.tips.percents.join(", ");
                }
                updateSettings({ tips: { ...settings.tips, percents } });
                return percents.join(", ");
              }}
            />
          )}

          {settings.tips.mode !== "off" && (
            <TextRow
              icon={<IconWallet size={16} />}
              tint="#30D158"
              label="Fixed presets"
              sub={`Offered on small tickets, in ${symbol}`}
              value={settings.tips.fixedMinor.map(minorToDecimal).join(", ")}
              inputMode="decimal"
              className="mono"
              onCommit={(next) => {
                const fixedMinor = parseMinorList(next);
                if (!fixedMinor) {
                  toast("Give at least one amount, such as 0.50, 1.00.", "error");
                  return settings.tips.fixedMinor.map(minorToDecimal).join(", ");
                }
                updateSettings({ tips: { ...settings.tips, fixedMinor } });
                return fixedMinor.map(minorToDecimal).join(", ");
              }}
            />
          )}

          {settings.tips.mode !== "off" && (
            <Advanced>
              {settings.tips.mode === "percent" && (
                <TextRow
                  icon={<IconWallet size={16} />}
                  tint="#30D158"
                  label="Show fixed presets below"
                  sub={`A ticket smaller than this, in ${symbol}`}
                  value={minorToDecimal(settings.tips.thresholdMinor)}
                  inputMode="decimal"
                  className="mono"
                  onCommit={(next) => {
                    const parsed = parseMinorList(next);
                    if (!parsed || parsed.length !== 1) {
                      toast("Give a single amount, such as 10.00.", "error");
                      return minorToDecimal(settings.tips.thresholdMinor);
                    }
                    updateSettings({ tips: { ...settings.tips, thresholdMinor: parsed[0] } });
                    return minorToDecimal(parsed[0]);
                  }}
                />
              )}

              <Row
                icon={<IconPercent size={16} />}
                tint="#BF5AF2"
                label="Calculate on the net"
                sub="Taken on the tax-exclusive figure"
              >
                <Toggle
                  on={settings.tips.onNet}
                  label="Calculate tips on the net"
                  onChange={() =>
                    updateSettings({ tips: { ...settings.tips, onNet: !settings.tips.onNet } })
                  }
                />
              </Row>
            </Advanced>
          )}
        </div>
      </Section>

      {/* ---------- TERMINAL ---------- */}
      <Section title="Terminal">
        <div className="list-group">
          <TextRow
            first
            icon={<IconTerminal size={16} />}
            tint="#5E5CE6"
            label="This device"
            sub="Attributed to every order it rings up"
            value={settings.terminalName}
            placeholder="Front counter"
            onCommit={(next) => {
              const nextName = next.trim() || "This device";
              updateSettings({ terminalName: nextName });
              return nextName;
            }}
          />

          <Row
            icon={<IconUsers size={16} />}
            tint="#5E5CE6"
            label="Staff & terminals"
            sub={`${staffCount} ${staffCount === 1 ? "person" : "people"} · ${terminal.name}`}
            chevron={Boolean(onNavigate)}
            onClick={onNavigate && (() => onNavigate("staff"))}
          />

          <Row
            icon={<IconPrinter size={16} />}
            tint="#64D2FF"
            label="Peripherals"
            sub={`${availablePeripherals} browser capabilities available · print, scanner, display`}
            chevron={Boolean(onNavigate)}
            onClick={onNavigate && (() => onNavigate("peripherals"))}
          />
          <Row
            icon={<IconShield size={16} />}
            tint="#30D158"
            label="Offline storage"
            sub={storageHealth?.usageRatio !== null && storageHealth?.usageRatio !== undefined
              ? `${Math.round(storageHealth.usageRatio * 100)}% of this browser's available storage used`
              : "Encrypted records stay on this device"}
            value={storageHealth?.persistence === "persistent" ? "Persistent" : "Best effort"}
            chevron={storageHealth?.persistence === "best-effort"}
            onClick={storageHealth?.persistence === "best-effort" ? handlePersistentStorage : undefined}
          />
        </div>
      </Section>

      {/* ---------- TURN OFF ---------- */}
      <section className="space-y-2 pt-2">
        <div className="list-group">
          <Row
            first
            danger
            icon={<IconXCircle size={16} />}
            tint="#FF453A"
            label="Turn off Merchant Mode"
            onClick={handleTurnOff}
          />
        </div>
        <Caption>
          Orders, catalogue and settings stay on this device and the receiving account is untouched
          — the counter just stops appearing in the wallet.
        </Caption>
      </section>

        </div>
      </div>

      <p className="flex items-start gap-2 px-1 text-[12px] leading-relaxed text-neutral-500">
        <IconStorefront size={14} className="mt-[2px] shrink-0 text-[#30D158]" />
        <span>
          Merchant Mode is non-custodial. A charge is a request paid straight to your own account;
          nothing is escrowed, nothing is pulled, and a refund is an ordinary outbound payment.
        </span>
      </p>

      {receiptPreviewOpen && receiptPreviewOrder && (
        <ReceiptSheet
          open
          onClose={() => setReceiptPreviewOpen(false)}
          order={receiptPreviewOrder}
          transactionHash={receiptPreviewHash}
        />
      )}
    </div>
  );
}
