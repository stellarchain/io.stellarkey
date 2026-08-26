"use client";

/**
 * MOCK — the Settings sub-page for who may work the till on this device.
 *
 * What is mocked: the roster (`MOCK_STAFF`), the refund queue
 * (`MOCK_REFUND_REQUESTS`, via `RefundRequestsPanel`) and today's per-member
 * takings (derived from `MOCK_SHIFT` by `shiftStaffLines`). Editing a role, a
 * permission, a refund ceiling and resetting a PIN all move local state and
 * raise a toast; the fixtures are never mutated and nothing is written.
 *
 * Staff are roles held on this device, not accounts: nobody signs in from
 * anywhere, a member exists because this app says so, and the whole matrix is
 * read out of local storage while the till runs. One install is one till — the
 * roster, the order sequence and the unconfirmed queue all belong to it alone.
 *
 * What a real implementation replaces: the fixtures become the merchant store's
 * own staff records, Save writes the permission matrix through it, and "Reset
 * PIN" salts and digests a new PIN *outside* the vault (it must be checkable
 * while the vault is locked, and it can never sign). Nothing here writes, signs,
 * or reaches Horizon.
 */

import { useMemo, useState } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import type { FiatCurrency } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { MOCK_NOW, MOCK_STAFF, MOCK_TERMINAL } from "@/lib/merchant/mock";
import { fmtMinor } from "@/lib/merchant/money";
import type { StaffMember, StaffPermissions, StaffRole } from "@/lib/merchant/types";
import { useToast } from "../Toast";
import {
  Avatar,
  Button,
  IOSBackButton,
  Modal,
  ModalHeader,
  SegmentedControl,
  Select,
  Toggle,
} from "../ui";
import { IconAlert, IconLock } from "../icons";
import { IconClock, IconTerminal } from "./icons";
import { MerchantDisclosure } from "./Disclosure";
import { RefundRequestsPanel } from "./RefundRequestsPanel";
import { shiftStaffLines } from "./ShiftSheet";

/** Said once, then reused by the chip and the disclosure beside it. */

const ROLE_LABEL: Record<StaffRole, string> = {
  owner: "Owner",
  manager: "Manager",
  server: "Server",
  accountant: "Accountant",
};

const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "manager", label: "Manager" },
  { value: "server", label: "Server" },
  { value: "accountant", label: "Books" },
];

/** Every permission except the ceiling, which is an amount rather than a switch. */
type SwitchPermission = Exclude<keyof StaffPermissions, "refundCeilingMinor">;

const PERMISSION_ROWS: { key: SwitchPermission; label: string; sub: string }[] = [
  { key: "takePayment", label: "Take payment", sub: "Ring up a ticket and raise a charge against it." },
  { key: "applyDiscount", label: "Apply a discount", sub: "Take money off a ticket, with a reason." },
  { key: "comp", label: "Comp an item", sub: "Give an item away — a remake, a mistake, a regular." },
  { key: "void", label: "Void a line", sub: "Pull a line off a ticket before it is paid." },
  { key: "openDrawer", label: "Open the drawer", sub: "Kick the cash drawer without a sale." },
  { key: "seeReports", label: "See reports", sub: "Read the shift, the X-report and the day's takings." },
  { key: "exportRecords", label: "Export records", sub: "Take orders and tax figures off the device." },
];

const CEILING_PRESETS: number[] = [0, 1000, 2000, 5000, 10000];

/**
 * The device this app is running on, and the only one there is. The name is a
 * real setting — the shop types it in Merchant settings — while the build number
 * and the unconfirmed queue come from the fixture; a wired screen reads the
 * build it was compiled from and counts the charges the local store has not yet
 * seen close.
 */
const DEVICE = MOCK_TERMINAL;

/** Fixtures are UTC instants, and MOCK_NOW is the shop's clock. */
function fmtAgo(ts: number): string {
  const seconds = Math.max(0, Math.round((MOCK_NOW - ts) / 1000));
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function ceilingLabel(ceiling: number | null, currency: FiatCurrency): string {
  if (ceiling === null) return "Refunds any amount";
  if (ceiling === 0) return "Cannot refund";
  return `Refunds to ${fmtMinor(ceiling, currency)}`;
}

interface StaffEdit {
  role: StaffRole;
  permissions: StaffPermissions;
}

export function StaffTerminalsPage({ onBack }: { onBack: () => void }) {
  const { settings } = useMerchant();
  const { toast } = useToast();
  const currency = settings.currency;

  const [edits, setEdits] = useState<Record<string, StaffEdit>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  // Retained so the sheet keeps its contents while it animates out.
  const [lastEditingId, setLastEditingId] = useState<string | null>(null);

  const takingsById = useMemo(
    () => new Map(shiftStaffLines().map((line) => [line.id, line])),
    [],
  );

  const members: StaffMember[] = MOCK_STAFF.map((member) =>
    edits[member.id] ? { ...member, ...edits[member.id] } : member,
  );
  if (editingId !== null && editingId !== lastEditingId) setLastEditingId(editingId);
  const editing = members.find((member) => member.id === (editingId ?? lastEditingId)) ?? null;

  const deviceName = settings.terminalName.trim() || "This device";

  return (
    <div className="fade-up w-full min-w-0 pb-[132px] md:pb-12">
      <div className="flex items-center justify-between pb-1 pt-2">
        <IOSBackButton label="Back to Merchant settings" onClick={onBack} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          Merchant
        </span>
        <span className="w-11" aria-hidden />
      </div>

      <h1 className="display-h text-[28px] font-bold text-white">Staff &amp; this device</h1>
      <p className="mt-1.5 max-w-[60ch] text-[13px] leading-relaxed text-neutral-400">
        Staff are roles on this device, not accounts. Switching staff attributes the orders rung up
        next and gates what the till will allow — locally, in this app, and nowhere else.
      </p>

      <div className="mb-5 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <MerchantDisclosure label="What a PIN is, and what it is not">
          <p>
            A PIN is stored as a salted digest, kept{" "}
            <strong className="text-white">outside the vault</strong> — it has to be checkable while
            the vault is locked, which is exactly when the till is busiest. It authorises the till:
            opening a shift, discounting a ticket, releasing a refund up to a ceiling.
          </p>
          <p>
            It can <strong className="text-white">never sign a transaction</strong>. Money leaving
            this shop — a refund included, because a refund is an ordinary outbound payment — needs
            the vault unlocked, and no PIN substitutes for it.
          </p>
        </MerchantDisclosure>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* ---------------- staff ---------------- */}
        <div className="space-y-4">
          <section>
            <div className="flex items-baseline justify-between px-1 pb-2">
              <h2 className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
                Staff
              </h2>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                Takings today
              </span>
            </div>
            <div className="list-group">
              {members.map((member, i) => (
                <StaffRow
                  key={member.id}
                  member={member}
                  currency={currency}
                  takingsMinor={takingsById.get(member.id)?.takingsMinor ?? 0}
                  orderCount={takingsById.get(member.id)?.orderCount ?? 0}
                  sep={i > 0}
                  onOpen={() => {
                    triggerHaptic("selection");
                    setEditingId(member.id);
                  }}
                />
              ))}
            </div>
          </section>

          <RefundRequestsPanel />
        </div>

        {/* ---------------- this device ---------------- */}
        <ThisDevice name={deviceName} />
      </div>

      <Modal open={editingId !== null} onClose={() => setEditingId(null)}>
        {editing && (
          <StaffEditor
            key={editing.id}
            member={editing}
            currency={currency}
            onCancel={() => setEditingId(null)}
            onSave={(edit) => {
              triggerHaptic("success");
              setEdits((prev) => ({ ...prev, [editing.id]: edit }));
              setEditingId(null);
              toast(`${editing.name}'s permissions would be saved on this device.`, "success");
            }}
            onResetPin={() => {
              triggerHaptic("medium");
              toast(
                editing.pinDigest
                  ? `A new PIN for ${editing.name} would be salted, digested and stored outside the vault.`
                  : `A first PIN for ${editing.name} would be salted, digested and stored outside the vault.`,
              );
            }}
          />
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Staff                                                               */
/* ------------------------------------------------------------------ */

function PinPill({ member }: { member: StaffMember }) {
  const set = member.pinDigest !== null;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-semibold leading-none ${
        set ? "bg-white/[0.08] text-neutral-300" : "bg-[#FF9F0A]/15 text-[#FF9F0A]"
      }`}
    >
      {set ? <IconLock size={10} /> : <IconAlert size={10} />}
      {set ? "PIN set" : "No PIN"}
    </span>
  );
}

function StaffRow({
  member,
  currency,
  takingsMinor,
  orderCount,
  sep,
  onOpen,
}: {
  member: StaffMember;
  currency: FiatCurrency;
  takingsMinor: number;
  orderCount: number;
  sep: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Edit ${member.name}`}
      className={`row-hover flex w-full items-center gap-3.5 px-4 py-3.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0A84FF] ${
        sep ? "ios-sep" : ""
      }`}
    >
      <Avatar seed={member.name} size={34} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15.5px] font-normal leading-tight text-white">
            {member.name}
          </span>
          <PinPill member={member} />
        </span>
        <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
          {ROLE_LABEL[member.role]} ·{" "}
          {ceilingLabel(member.permissions.refundCeilingMinor, currency)}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="mono text-[14.5px] font-medium leading-tight text-white">
          {fmtMinor(takingsMinor, currency)}
        </span>
        <span className="text-[11px] leading-tight text-neutral-500">
          {orderCount === 0 ? "No sales" : `${orderCount} orders`}
        </span>
      </span>
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
    </button>
  );
}

function StaffEditor({
  member,
  currency,
  onCancel,
  onSave,
  onResetPin,
}: {
  member: StaffMember;
  currency: FiatCurrency;
  onCancel: () => void;
  onSave: (edit: StaffEdit) => void;
  onResetPin: () => void;
}) {
  const [role, setRole] = useState<StaffRole>(member.role);
  const [permissions, setPermissions] = useState<StaffPermissions>(member.permissions);

  const ceilingOptions = useMemo(() => {
    const presets = CEILING_PRESETS.includes(permissions.refundCeilingMinor ?? -1)
      ? CEILING_PRESETS
      : [...CEILING_PRESETS, permissions.refundCeilingMinor ?? 0].sort((a, b) => a - b);
    return [
      ...presets.map((value) => ({
        value: String(value),
        label: value === 0 ? "Cannot refund" : `Up to ${fmtMinor(value, currency)}`,
      })),
      { value: "none", label: "No ceiling" },
    ];
  }, [currency, permissions.refundCeilingMinor]);

  const ceilingValue =
    permissions.refundCeilingMinor === null ? "none" : String(permissions.refundCeilingMinor);

  return (
    <>
      <ModalHeader
        title={member.name}
        subtitle={`${ROLE_LABEL[member.role]} · till access, not vault access`}
        onClose={onCancel}
      />

      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <Avatar seed={member.name} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15.5px] font-semibold text-white">{member.name}</p>
            <p className="mt-0.5 text-[12px] text-neutral-400">
              {member.pinSetAt === null ? "No PIN set" : `PIN set ${fmtAgo(member.pinSetAt)}`}
            </p>
          </div>
          <PinPill member={member} />
        </div>

        <div>
          <span className="field-label">Role</span>
          <SegmentedControl<StaffRole>
            value={role}
            options={ROLE_OPTIONS}
            onChange={(next) => setRole(next)}
          />
          <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">
            A role is only a starting point. What applies is the matrix below, so a role change
            never quietly grants or removes anything.
          </p>
        </div>

        <section>
          <h3 className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            On the till
          </h3>
          <div className="list-group">
            {PERMISSION_ROWS.map((row, i) => (
              <div
                key={row.key}
                className={`flex items-center gap-3.5 px-4 py-3.5 ${
                  i === 0 ? "" : "border-t border-white/[0.08]"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15.5px] font-normal leading-tight text-white">
                    {row.label}
                  </span>
                  <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
                    {row.sub}
                  </span>
                </span>
                <Toggle
                  checked={permissions[row.key]}
                  label={row.label}
                  onChange={(next) =>
                    setPermissions((prev) => ({ ...prev, [row.key]: next ?? !prev[row.key] }))
                  }
                />
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Refund ceiling
          </h3>
          <div className="panel p-4">
            <Select
              ariaLabel={`Refund ceiling for ${member.name}`}
              value={ceilingValue}
              options={ceilingOptions}
              onChange={(next) =>
                setPermissions((prev) => ({
                  ...prev,
                  refundCeilingMinor: next === "none" ? null : Number(next),
                }))
              }
            />
            <p className="mt-2.5 text-[12px] leading-relaxed text-neutral-400">
              {permissions.refundCeilingMinor === null
                ? `${member.name.split(" ")[0]} can release a refund of any size — once the vault is unlocked to sign it.`
                : permissions.refundCeilingMinor === 0
                  ? `${member.name.split(" ")[0]} cannot release a refund at all. Every one becomes a request.`
                  : `Up to ${fmtMinor(permissions.refundCeilingMinor, currency)}, ${member.name.split(" ")[0]} releases it. Above that the till raises a refund request for someone who can — the refund is never silently refused.`}
            </p>
          </div>
        </section>

        <section>
          <h3 className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            PIN
          </h3>
          <div className="panel space-y-3 p-4">
            <p className="text-[12.5px] leading-relaxed text-neutral-400">
              A salted digest kept outside the vault. It authorises this till and nothing else: it
              cannot sign, and it cannot move money.
            </p>
            <Button variant="secondary" onClick={onResetPin}>
              {member.pinDigest === null ? "Set a PIN" : "Reset PIN"}
            </Button>
          </div>
        </section>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={() => onSave({ role, permissions })}>
            Save
          </Button>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* This device                                                         */
/* ------------------------------------------------------------------ */

/**
 * One device, named, on its own. There is no list because there is nothing to
 * list against: order numbers come from this app's own counter, charges queue in
 * this app's own storage, and a second till would need a channel between them
 * that a self-custody wallet with no server does not have.
 */
function ThisDevice({ name }: { name: string }) {
  const queued = DEVICE.queuedCharges;
  return (
    <section aria-labelledby="device-title">
      <h2
        id="device-title"
        className="px-1 pb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400"
      >
        This device
      </h2>

      <div className="list-group">
        <div className="flex w-full items-center gap-3.5 px-4 py-3.5">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#5E5CE6] text-white shadow-sm"
          >
            <IconTerminal size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15.5px] font-normal leading-tight text-white">
              {name}
            </span>
            <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
              Merchant Mode v{DEVICE.appVersion} · renamed in Merchant settings
            </span>
          </span>
        </div>

        <div className="flex w-full items-center gap-3.5 px-4 py-3.5 ios-sep">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#FF9F0A] text-white shadow-sm"
          >
            <IconClock size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15.5px] font-normal leading-tight text-white">
              Waiting to confirm
            </span>
            <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
              Charges taken while this device is offline
            </span>
          </span>
          <span
            className={`mono text-[14.5px] font-medium ${
              queued > 0 ? "text-[#FF9F0A]" : "text-neutral-400"
            }`}
          >
            {queued}
          </span>
        </div>
      </div>
      <p className="px-1 pt-2 text-[12px] leading-relaxed text-neutral-400">
        {queued > 0
          ? "Charges taken while this device was offline sit in this app’s storage and confirm themselves as soon as Horizon answers again."
          : "Anything taken while this device is offline waits in this app’s storage and confirms itself as soon as Horizon answers again."}
      </p>
    </section>
  );
}
