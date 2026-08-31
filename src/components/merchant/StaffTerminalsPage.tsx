"use client";

import { useMemo, useState } from "react";
import {
  useMerchantConfiguration,
  useMerchantRecords,
  useMerchantStaff,
} from "@/hooks/useMerchant";
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
  const { settings, updateSettings } = useMerchantConfiguration();
  const {
    staff: members,
    activeStaff,
    onShiftStaff,
    terminal,
    switchStaff,
    lockStaffSession,
    endStaffSession,
    addStaff,
    updateStaff,
    resetStaffPin,
  } = useMerchantStaff();
  const { orders, charges } = useMerchantRecords();
  const { toast } = useToast();
  const currency = settings.currency;
  const now = useLiveNow();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [operatorSheetOpen, setOperatorSheetOpen] = useState(false);
  const [operatorTargetId, setOperatorTargetId] = useState<string | null>(null);
  const [operatorPending, setOperatorPending] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [lockingOpen, setLockingOpen] = useState(false);

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
  const operatorTarget = members.find((member) => member.id === operatorTargetId) ?? null;
  const availableOperators = members.filter(
    (member) => member.active && !onShiftStaff.some((entry) => entry.id === member.id),
  );

  const deviceName = settings.terminalName.trim() || "This device";
  const queuedCharges = charges.filter((charge) => charge.status === "awaiting").length;

  async function handleLock() {
    try {
      await lockStaffSession();
      triggerHaptic("success");
      toast("Till locked; the on-shift roster is still ready", "info");
    } catch (error) {
      triggerHaptic("error");
      toast(error instanceof Error ? error.message : "The till could not lock.", "error");
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

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-2">
        {/* ---------------- staff ---------------- */}
        <div className="min-w-0 space-y-4">
          <section aria-labelledby="on-shift-title">
            <div className="flex items-baseline justify-between px-1 pb-2">
              <div className="flex items-baseline gap-2">
                <h2
                  id="on-shift-title"
                  className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400"
                >
                  On this shift
                </h2>
                <span className="text-[11px] text-neutral-500">{onShiftStaff.length}</span>
              </div>
              {onShiftStaff.length > 0 && (
                <button
                  type="button"
                  onClick={() => setRosterOpen(true)}
                  className="min-h-11 px-1 text-[12px] font-semibold text-[#0A84FF] active:opacity-60"
                >
                  Manage
                </button>
              )}
            </div>

            <div className="list-group overflow-hidden">
              <div className="flex min-h-[78px] items-center gap-3.5 px-4 py-3.5">
                {activeStaff ? (
                  <Avatar seed={activeStaff.name} size={46} />
                ) : (
                  <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-neutral-400">
                    <IconLock size={19} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    Current operator
                  </span>
                  <span className="mt-0.5 block truncate text-[16px] font-semibold text-white">
                    {activeStaff?.name ?? "Till locked"}
                  </span>
                  <span className="block truncate text-[12px] text-neutral-400">
                    {activeStaff
                      ? `${ROLE_LABEL[activeStaff.role]} · actions are attributed to them`
                      : "Choose an operator before the next till action"}
                  </span>
                </span>
                {activeStaff && (
                  <Button
                    variant="secondary"
                    className="min-h-11 shrink-0"
                    onClick={() => void handleLock()}
                  >
                    Lock
                  </Button>
                )}
              </div>

              <div className="ios-sep">
                <div
                  data-mobile-scroll="true"
                  className="scrollbar-none flex min-w-0 gap-2 overflow-x-auto px-3 py-3"
                >
                  {onShiftStaff.map((member) => {
                    const current = member.id === activeStaff?.id;
                    return (
                      <button
                        key={member.id}
                        type="button"
                        aria-pressed={current}
                        aria-label={current ? `${member.name}, current operator` : `Switch to ${member.name}`}
                        disabled={current}
                        onClick={() => {
                          triggerHaptic("selection");
                          setOperatorTargetId(member.id);
                          setOperatorSheetOpen(true);
                        }}
                        className={`flex min-h-[82px] min-w-[78px] max-w-[92px] flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 py-2.5 text-center transition-colors disabled:opacity-100 ${
                          current
                            ? "border-[#0A84FF]/45 bg-[#0A84FF]/15"
                            : "border-white/[0.08] bg-white/[0.04] active:bg-white/[0.1]"
                        }`}
                      >
                        <span data-mobile-overflow="true" className="relative inline-flex">
                          <Avatar seed={member.name} size={34} />
                          {current && (
                            <span
                              aria-hidden="true"
                              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#17171a] bg-[#30D158]"
                            />
                          )}
                        </span>
                        <span className="w-full truncate text-[11.5px] font-semibold text-white">
                          {member.name.split(" ")[0]}
                        </span>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection");
                      setOperatorTargetId(null);
                      setOperatorSheetOpen(true);
                    }}
                    className="flex min-h-[82px] min-w-[78px] max-w-[92px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/[0.14] bg-white/[0.025] px-2 py-2.5 text-center text-neutral-400 active:bg-white/[0.08]"
                  >
                    <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/[0.08] text-[22px] font-light text-[#0A84FF]">
                      +
                    </span>
                    <span className="text-[11.5px] font-semibold">Add operator</span>
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setLockingOpen(true)}
                className="row-hover ios-sep flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#5E5CE6] text-white">
                  <IconLock size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] text-white">Operator locking</span>
                  <span className="block truncate text-[11.5px] text-neutral-400">
                    {settings.operatorLockMode === "after_sale"
                      ? "After every sale"
                      : `After ${settings.operatorLockTimeoutMinutes} minutes inactive`}
                  </span>
                </span>
                <svg className="chevron" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m1.5 1.5 5 5.5-5 5.5" />
                </svg>
              </button>
            </div>
            <p className="px-1 pt-2 text-[12px] leading-relaxed text-neutral-400">
              Several people can stay on shift. One PIN-verified operator owns each action.
            </p>
          </section>

          <section>
            <div className="flex items-baseline justify-between px-1 pb-2">
              <h2 className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
                Staff
              </h2>
              <button
                type="button"
                className="text-[12px] font-semibold text-[#0A84FF] hover:text-[#64D2FF] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={activeStaff?.role !== "owner"}
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

      <Modal
        open={operatorSheetOpen}
        dismissable={!operatorPending}
        onClose={() => {
          if (!operatorPending) setOperatorSheetOpen(false);
        }}
      >
        {operatorTarget ? (
          <OperatorPinSheet
            key={operatorTarget.id}
            member={operatorTarget}
            alreadyOnShift={onShiftStaff.some((member) => member.id === operatorTarget.id)}
            onBack={availableOperators.length > 0 ? () => setOperatorTargetId(null) : undefined}
            onCancel={() => setOperatorSheetOpen(false)}
            onBusyChange={setOperatorPending}
            onSwitch={async (pin) => {
              await switchStaff(operatorTarget.id, pin);
              setOperatorSheetOpen(false);
              triggerHaptic("success");
              toast(`${operatorTarget.name} is now the current operator`, "success");
            }}
          />
        ) : (
          <OperatorPickerSheet
            members={availableOperators}
            onCancel={() => setOperatorSheetOpen(false)}
            onChoose={(memberId) => setOperatorTargetId(memberId)}
          />
        )}
      </Modal>

      <Modal open={rosterOpen} onClose={() => setRosterOpen(false)}>
        <OperatorRosterSheet
          members={onShiftStaff}
          activeStaff={activeStaff}
          onCancel={() => setRosterOpen(false)}
          onEnd={async (member) => {
            await endStaffSession(member.id);
            if (member.id === activeStaff?.id) setRosterOpen(false);
            triggerHaptic("success");
            toast(`${member.name} ended their operator session`, "info");
          }}
        />
      </Modal>

      <Modal open={lockingOpen} onClose={() => setLockingOpen(false)}>
        <OperatorLockSheet
          mode={settings.operatorLockMode}
          timeoutMinutes={settings.operatorLockTimeoutMinutes}
          onClose={() => setLockingOpen(false)}
          onChange={async (patch) => {
            try {
              await updateSettings(patch);
              triggerHaptic("selection");
            } catch (error) {
              triggerHaptic("error");
              toast(error instanceof Error ? error.message : "Operator locking could not be updated.", "error");
            }
          }}
        />
      </Modal>

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
/* Operator sessions                                                   */
/* ------------------------------------------------------------------ */

function OperatorPickerSheet({
  members,
  onCancel,
  onChoose,
}: {
  members: StaffMember[];
  onCancel: () => void;
  onChoose: (memberId: string) => void;
}) {
  return (
    <>
      <ModalHeader
        title="Add operator"
        subtitle="Join this device's on-shift roster"
        onClose={onCancel}
      />
      <div className="p-4 sm:p-5">
        {members.length > 0 ? (
          <div className="list-group">
            {members.map((member, index) => (
              <button
                key={member.id}
                type="button"
                autoFocus={index === 0}
                onClick={() => {
                  triggerHaptic("selection");
                  onChoose(member.id);
                }}
                className={`row-hover flex min-h-[64px] w-full items-center gap-3.5 px-4 py-3 text-left ${
                  index > 0 ? "ios-sep" : ""
                }`}
              >
                <Avatar seed={member.name} size={38} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-white">
                    {member.name}
                  </span>
                  <span className="block truncate text-[12px] text-neutral-400">
                    {ROLE_LABEL[member.role]} · personal PIN required
                  </span>
                </span>
                <svg className="chevron" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m1.5 1.5 5 5.5-5 5.5" />
                </svg>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center px-5 py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#30D158]/12 text-[#30D158]">
              <span className="text-xl">✓</span>
            </span>
            <p className="mt-3 text-[15px] font-semibold text-white">Everyone active is on shift</p>
            <p className="mt-1 max-w-[30ch] text-[12px] leading-relaxed text-neutral-400">
              Add another staff member below the roster before they can join this till.
            </p>
          </div>
        )}
        <Button variant="secondary" className="mt-4 min-h-11 w-full" onClick={onCancel}>
          Done
        </Button>
      </div>
    </>
  );
}

function OperatorPinSheet({
  member,
  alreadyOnShift,
  onBack,
  onCancel,
  onBusyChange,
  onSwitch,
}: {
  member: StaffMember;
  alreadyOnShift: boolean;
  onBack?: () => void;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
  onSwitch: (pin: string) => Promise<void>;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!/^\d{4,6}$/.test(pin) || busy) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      await onSwitch(pin);
    } catch (cause) {
      triggerHaptic("error");
      setPin("");
      setError(cause instanceof Error ? cause.message : "This operator could not be selected.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <>
      <ModalHeader
        title={member.name}
        subtitle={alreadyOnShift ? "Select current operator" : "Join shift and become current"}
        onClose={busy ? undefined : onCancel}
      />
      <form
        className="p-4 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col items-center py-2 text-center">
          <Avatar seed={member.name} size={58} />
          <p className="mt-3 text-[15px] font-semibold text-white">Enter {member.name.split(" ")[0]}&apos;s PIN</p>
          <p className="mt-1 text-[12px] text-neutral-400">
            Actions after this point are attributed to {member.name.split(" ")[0]}.
          </p>
        </div>

        <input
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={pin}
          onChange={(event) => {
            setPin(event.target.value.replace(/\D/g, "").slice(0, 6));
            setError(null);
          }}
          aria-label={`PIN for ${member.name}`}
          aria-invalid={Boolean(error)}
          placeholder="4 to 6 digits"
          className="input mono mt-4 text-center text-base tracking-[0.32em] sm:text-[15px]"
        />
        {error && <p role="alert" className="mt-2 text-center text-[12px] text-[#FF6961]">{error}</p>}

        {onBack && (
          <button
            type="button"
            disabled={busy}
            onClick={onBack}
            className="mt-3 min-h-11 w-full text-[12.5px] font-semibold text-[#0A84FF] active:opacity-60"
          >
            Choose someone else
          </button>
        )}
        <div className="mt-3 flex gap-2">
          <Button type="button" variant="secondary" className="min-h-11 flex-1" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" className="min-h-11 flex-1" loading={busy} disabled={!/^\d{4,6}$/.test(pin)}>
            {alreadyOnShift ? "Select" : "Join shift"}
          </Button>
        </div>
      </form>
    </>
  );
}

function OperatorRosterSheet({
  members,
  activeStaff,
  onCancel,
  onEnd,
}: {
  members: StaffMember[];
  activeStaff: StaffMember | null;
  onCancel: () => void;
  onEnd: (member: StaffMember) => Promise<void>;
}) {
  const [endingId, setEndingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <ModalHeader title="On this shift" subtitle={`${members.length} operator${members.length === 1 ? "" : "s"} on this device`} onClose={endingId ? undefined : onCancel} />
      <div className="space-y-3 p-4 sm:p-5">
        <div className="list-group">
          {members.map((member, index) => {
            const isCurrent = member.id === activeStaff?.id;
            const canEnd = isCurrent || activeStaff?.role === "owner";
            return (
              <div
                key={member.id}
                className={`flex min-h-[64px] items-center gap-3 px-4 py-3 ${index > 0 ? "ios-sep" : ""}`}
              >
                <Avatar seed={member.name} size={38} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-white">{member.name}</span>
                    {isCurrent && (
                      <span className="rounded-full bg-[#30D158]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#30D158]">
                        Current
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[12px] text-neutral-400">{ROLE_LABEL[member.role]}</span>
                </span>
                <button
                  type="button"
                  disabled={!canEnd || Boolean(endingId)}
                  onClick={() => {
                    setEndingId(member.id);
                    setError(null);
                    void onEnd(member)
                      .catch((cause: unknown) => {
                        triggerHaptic("error");
                        setError(cause instanceof Error ? cause.message : "The session could not end.");
                      })
                      .finally(() => setEndingId(null));
                  }}
                  className="min-h-11 shrink-0 px-2 text-[12.5px] font-semibold text-[#FF6961] disabled:opacity-35"
                >
                  {endingId === member.id ? "Ending…" : "End"}
                </button>
              </div>
            );
          })}
        </div>
        {error && <p role="alert" className="text-[12px] text-[#FF6961]">{error}</p>}
        <p className="px-1 text-[12px] leading-relaxed text-neutral-400">
          Operators can end their own session. The current owner can end another operator&apos;s session.
        </p>
        <Button variant="secondary" className="min-h-11 w-full" disabled={Boolean(endingId)} onClick={onCancel}>
          Done
        </Button>
      </div>
    </>
  );
}

function OperatorLockSheet({
  mode,
  timeoutMinutes,
  onClose,
  onChange,
}: {
  mode: "after_sale" | "after_timeout";
  timeoutMinutes: 1 | 5 | 15;
  onClose: () => void;
  onChange: (patch: {
    operatorLockMode?: "after_sale" | "after_timeout";
    operatorLockTimeoutMinutes?: 1 | 5 | 15;
  }) => Promise<void>;
}) {
  return (
    <>
      <ModalHeader title="Operator locking" subtitle="Keep attribution accurate on a shared till" onClose={onClose} />
      <div className="space-y-5 p-4 sm:p-5">
        <section>
          <h3 className="field-label">When to lock</h3>
          <SegmentedControl<"after_sale" | "after_timeout">
            ariaLabel="Operator lock timing"
            value={mode}
            options={[
              { value: "after_sale", label: "Every sale" },
              { value: "after_timeout", label: "Inactivity" },
            ]}
            onChange={(operatorLockMode) => void onChange({ operatorLockMode })}
          />
        </section>

        <div className="list-group">
          <div className="flex gap-3.5 px-4 py-3.5">
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${mode === "after_sale" ? "bg-[#30D158]" : "bg-neutral-600"}`} />
            <span>
              <span className="block text-[14.5px] font-medium text-white">Lock after every sale</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-neutral-400">
                Best for busy shared tills. The roster stays ready, but the next operator enters their PIN.
              </span>
            </span>
          </div>
          <div className="ios-sep flex gap-3.5 px-4 py-3.5">
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${mode === "after_timeout" ? "bg-[#30D158]" : "bg-neutral-600"}`} />
            <span>
              <span className="block text-[14.5px] font-medium text-white">After inactivity</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-neutral-400">
                Better for one operator serving a run of customers. Leaving the app locks immediately.
              </span>
            </span>
          </div>
        </div>

        {mode === "after_timeout" && (
          <section>
            <h3 className="field-label">Inactivity time</h3>
            <SegmentedControl<"1" | "5" | "15">
              ariaLabel="Operator inactivity timeout"
              value={String(timeoutMinutes) as "1" | "5" | "15"}
              options={[
                { value: "1", label: "1 min" },
                { value: "5", label: "5 min" },
                { value: "15", label: "15 min" },
              ]}
              onChange={(value) =>
                void onChange({ operatorLockTimeoutMinutes: Number(value) as 1 | 5 | 15 })
              }
            />
          </section>
        )}

        <p className="text-[12px] leading-relaxed text-neutral-400">
          This policy is stored only in encrypted merchant data on this device. It does not change wallet auto-lock.
        </p>
        <Button className="min-h-11 w-full" onClick={onClose}>Done</Button>
      </div>
    </>
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
            ariaLabel="Staff role"
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
            <p className="text-[12px] leading-relaxed text-neutral-500">
              Five failures pause attempts for 30 seconds in this open app window. Reloading or
              closing resets that client-side limit, so treat it as a local till deterrent rather
              than high-security authentication.
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
            ariaLabel="Staff role"
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
