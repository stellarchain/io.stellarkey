"use client";

import { useMemo, useState } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { useLiveNow } from "@/hooks/useLiveNow";
import type { FiatCurrency } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { defaultPermissionsFor } from "@/lib/merchant/permissions";
import { fmtMinor } from "@/lib/merchant/money";
import type {
  StaffMember,
  StaffPermissions,
  StaffRole,
  TerminalDevice,
} from "@/lib/merchant/types";
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

function fmtAgo(ts: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
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
  name: string;
  active: boolean;
  role: StaffRole;
  permissions: StaffPermissions;
}

export function StaffTerminalsPage({ onBack }: { onBack: () => void }) {
  const {
    settings,
    staff: members,
    activeStaff,
    terminal,
    orders,
    charges,
    switchStaff,
    addStaff,
    updateStaff,
    resetStaffPin,
  } = useMerchant();
  const { toast } = useToast();
  const currency = settings.currency;
  const now = useLiveNow();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [switchingTo, setSwitchingTo] = useState(activeStaff?.id ?? "");
  const [switchPin, setSwitchPin] = useState("");
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const takingsById = useMemo(() => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const byName = new Map<string, { takingsMinor: number; orderCount: number }>();
    for (const order of orders) {
      if (order.paidAt === null || order.paidAt < start.getTime()) continue;
      const entry = byName.get(order.staffName) ?? { takingsMinor: 0, orderCount: 0 };
      entry.takingsMinor += order.totals.totalMinor;
      entry.orderCount += 1;
      byName.set(order.staffName, entry);
    }
    return new Map(
      members.map((member) => [member.id, byName.get(member.name) ?? { takingsMinor: 0, orderCount: 0 }]),
    );
  }, [members, now, orders]);

  const editing = members.find((member) => member.id === editingId) ?? null;

  const deviceName = settings.terminalName.trim() || "This device";
  const queuedCharges = charges.filter((charge) => charge.status === "awaiting").length;

  async function handleSwitch() {
    if (!switchingTo || switching) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      await switchStaff(switchingTo, switchPin);
      setSwitchPin("");
      triggerHaptic("success");
      toast(`Till switched to ${members.find((member) => member.id === switchingTo)?.name ?? "staff"}`, "success");
    } catch (error) {
      triggerHaptic("error");
      setSwitchError(error instanceof Error ? error.message : "The till could not switch staff.");
    } finally {
      setSwitching(false);
    }
  }

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
            A PIN is stored only as a salted digest inside{" "}
            <strong className="text-white">encrypted merchant storage</strong>. After the wallet is
            unlocked, it authorises till actions such as opening a shift, discounting a ticket, or
            releasing a refund up to a ceiling.
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
          <section aria-labelledby="active-operator-title" className="panel p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="active-operator-title" className="text-[15px] font-semibold text-white">
                  Active operator
                </h2>
                <p className="mt-0.5 text-[12px] text-neutral-400">
                  Orders and approvals are attributed to this person.
                </p>
              </div>
              <span className="chip cursor-default">{activeStaff?.name ?? "None"}</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_140px_auto]">
              <Select
                ariaLabel="Staff member to switch to"
                value={switchingTo}
                options={members
                  .filter((member) => member.active)
                  .map((member) => ({ value: member.id, label: member.name, sublabel: ROLE_LABEL[member.role] }))}
                onChange={(value) => {
                  setSwitchingTo(value);
                  setSwitchPin("");
                  setSwitchError(null);
                }}
              />
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={switchPin}
                onChange={(event) => setSwitchPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleSwitch();
                }}
                aria-label="Staff PIN"
                placeholder="PIN"
                className="input mono text-base sm:text-[13.5px]"
              />
              <Button loading={switching} disabled={!/^\d{4,6}$/.test(switchPin)} onClick={() => void handleSwitch()}>
                Switch
              </Button>
            </div>
            {switchError && <p role="alert" className="mt-2 text-[12px] text-[#FF6961]">{switchError}</p>}
          </section>

          <section>
            <div className="flex items-baseline justify-between px-1 pb-2">
              <h2 className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
                Staff
              </h2>
              <button
                type="button"
                className="text-[12px] font-semibold text-[#0A84FF] hover:text-[#64D2FF] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={activeStaff?.role !== "owner" || switching}
                onClick={() => setAdding(true)}
              >
                Add staff
              </button>
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
        <ThisDevice
          device={{ ...terminal, name: deviceName }}
          queuedCharges={queuedCharges}
        />
      </div>

      <Modal open={editingId !== null} onClose={() => setEditingId(null)}>
        {editing && (
          <StaffEditor
            key={editing.id}
            member={editing}
            currency={currency}
            onCancel={() => setEditingId(null)}
            onSave={async (edit) => {
              try {
                await updateStaff(editing.id, edit);
                triggerHaptic("success");
                setEditingId(null);
                toast(`${edit.name.trim()}'s staff access was saved on this device.`, "success");
              } catch (error) {
                triggerHaptic("error");
                toast(error instanceof Error ? error.message : "Staff permissions could not be saved.", "error");
              }
            }}
            onResetPin={async (pin) => {
              await resetStaffPin(editing.id, pin);
              triggerHaptic("success");
              toast(`${editing.name}'s PIN was reset`, "success");
            }}
          />
        )}
      </Modal>

      <Modal open={adding} onClose={() => setAdding(false)}>
        <AddStaffForm
          onCancel={() => setAdding(false)}
          onAdd={async (input) => {
            await addStaff(input);
            setAdding(false);
            triggerHaptic("success");
            toast(`${input.name.trim()} was added to this till`, "success");
          }}
        />
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
          {!member.active && (
            <span className="rounded-full bg-white/[0.08] px-2 py-[3px] text-[11px] font-semibold leading-none text-neutral-400">
              Inactive
            </span>
          )}
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
  onResetPin: (pin: string) => Promise<void>;
}) {
  const now = useLiveNow();
  const [name, setName] = useState(member.name);
  const [active, setActive] = useState(member.active);
  const [role, setRole] = useState<StaffRole>(member.role);
  const [permissions, setPermissions] = useState<StaffPermissions>(member.permissions);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

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
              {member.pinSetAt === null ? "No PIN set" : `PIN set ${fmtAgo(member.pinSetAt, now)}`}
            </p>
          </div>
          <PinPill member={member} />
        </div>

        <div>
          <span className="field-label">Name</span>
          <input
            type="text"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            aria-label="Staff name"
            className="input text-base sm:text-[13.5px]"
          />
        </div>

        <div className="panel flex items-center gap-3.5 px-4 py-3.5">
          <span className="min-w-0 flex-1">
            <span className="block text-[15.5px] font-normal leading-tight text-white">
              Active on this till
            </span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-neutral-400">
              Inactive staff stay in historical records but cannot switch in or approve work.
            </span>
          </span>
          <Toggle
            checked={active}
            label="Active on this till"
            onChange={(next) => setActive(next ?? !active)}
          />
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
              A salted digest kept inside encrypted merchant storage. It authorises this till and
              nothing else: it cannot sign, and it cannot move money.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                aria-label={`New PIN for ${member.name}`}
                placeholder="New PIN"
                className="input mono text-base sm:text-[13.5px]"
              />
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={pinConfirm}
                onChange={(event) => setPinConfirm(event.target.value.replace(/\D/g, "").slice(0, 6))}
                aria-label={`Confirm new PIN for ${member.name}`}
                placeholder="Confirm PIN"
                className="input mono text-base sm:text-[13.5px]"
              />
            </div>
            {pinError && <p role="alert" className="text-[12px] text-[#FF6961]">{pinError}</p>}
            <Button
              variant="secondary"
              loading={pinBusy}
              disabled={!/^\d{4,6}$/.test(pin) || pin !== pinConfirm}
              onClick={() => {
                setPinBusy(true);
                setPinError(null);
                void onResetPin(pin)
                  .then(() => {
                    setPin("");
                    setPinConfirm("");
                  })
                  .catch((error: unknown) => {
                    setPinError(error instanceof Error ? error.message : "The PIN could not be reset.");
                  })
                  .finally(() => setPinBusy(false));
              }}
            >
              {member.pinDigest === null ? "Set PIN" : "Reset PIN"}
            </Button>
          </div>
        </section>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={!name.trim()}
            onClick={() => onSave({ name, active, role, permissions })}
          >
            Save
          </Button>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Add staff                                                           */
/* ------------------------------------------------------------------ */

function AddStaffForm({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (input: { name: string; role: StaffRole; pin: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<StaffRole>("server");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length > 0 && /^\d{4,6}$/.test(pin) && pin === confirm;

  return (
    <>
      <ModalHeader title="Add staff" subtitle="A local till role, never a wallet signer" onClose={busy ? undefined : onCancel} />
      <div className="space-y-4 p-4 sm:p-5">
        <div>
          <span className="field-label">Name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Staff name"
            className="input text-base sm:text-[13.5px]"
          />
        </div>
        <div>
          <span className="field-label">Role</span>
          <SegmentedControl<StaffRole>
            value={role}
            options={ROLE_OPTIONS}
            onChange={setRole}
          />
          <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">
            Starts with {Object.values(defaultPermissionsFor(role)).filter((value) => value === true).length} enabled till permissions. The owner can tune them after creation.
          </p>
        </div>
        <div>
          <span className="field-label">PIN</span>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-label="New staff PIN"
              placeholder="4 to 6 digits"
              className="input mono text-base sm:text-[13.5px]"
            />
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-label="Confirm new staff PIN"
              placeholder="Confirm PIN"
              className="input mono text-base sm:text-[13.5px]"
            />
          </div>
        </div>
        {error && <p role="alert" className="text-[12px] text-[#FF6961]">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button
            className="flex-1"
            loading={busy}
            disabled={!valid}
            onClick={() => {
              setBusy(true);
              setError(null);
              void onAdd({ name, role, pin })
                .catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : "Staff could not be added.");
                })
                .finally(() => setBusy(false));
            }}
          >
            Add staff
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
function ThisDevice({
  device,
  queuedCharges,
}: {
  device: TerminalDevice;
  queuedCharges: number;
}) {
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
              {device.name}
            </span>
            <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
              Merchant Mode v{device.appVersion} · renamed in Merchant settings
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
              Open charges still awaiting a matched payment
            </span>
          </span>
          <span
            className={`mono text-[14.5px] font-medium ${
              queuedCharges > 0 ? "text-[#FF9F0A]" : "text-neutral-400"
            }`}
          >
            {queuedCharges}
          </span>
        </div>
      </div>
      <p className="px-1 pt-2 text-[12px] leading-relaxed text-neutral-400">
        {queuedCharges > 0
          ? "These charges remain on this device until Horizon observes and matches a payment, or staff voids them."
          : "No charge is currently waiting for payment confirmation on this device."}
      </p>
    </section>
  );
}
