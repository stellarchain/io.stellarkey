"use client";

import { useState } from "react";
import { triggerHaptic } from "@/lib/haptics";
import { Spinner } from "../ui";
import { IconAlert, IconCheck, IconLock, IconRefresh } from "../icons";
import { IconClock } from "./icons";
import type { WakeLockState } from "@/hooks/useWakeLock";

type Tone = "warn" | "positive" | "indigo";

const TONE: Record<Tone, { ink: string; ring: string; wash: string }> = {
  warn: { ink: "#FF9F0A", ring: "ring-[#FF9F0A]/30", wash: "bg-[#FF9F0A]/[0.07]" },
  positive: { ink: "#30D158", ring: "ring-[#30D158]/30", wash: "bg-[#30D158]/[0.07]" },
  indigo: { ink: "#5E5CE6", ring: "ring-[#5E5CE6]/35", wash: "bg-[#5E5CE6]/[0.09]" },
};

function StateCard({
  tone,
  icon,
  title,
  children,
  className = "",
}: {
  tone: Tone;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const colours = TONE[tone];
  return (
    <div role="status" className={`panel ring-1 ring-inset ${colours.ring} ${className}`}>
      <div className={`${colours.wash} px-4 py-3.5`}>
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px]"
            style={{ backgroundColor: `${colours.ink}26`, color: colours.ink }}
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-tight text-white">{title}</p>
            <div className="mt-1 text-[12.5px] leading-relaxed text-neutral-400">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OfflineBanner({
  queuedCount,
  expiredCount,
  className = "",
}: {
  queuedCount: number;
  expiredCount: number;
  className?: string;
}) {
  return (
    <StateCard
      tone="warn"
      icon={<IconAlert size={17} />}
      title="Offline — confirmation is paused"
      className={className}
    >
      <p>
        Existing unexpired payment requests remain valid, but this till cannot verify new ledger
        payments or safely price a new crypto charge until the connection returns.
      </p>
      {(queuedCount > 0 || expiredCount > 0) && (
        <p className="mt-1 font-semibold text-[#FF9F0A]">
          {queuedCount} awaiting confirmation · {expiredCount} expired on this network
        </p>
      )}
      <p className="mt-1 flex items-center gap-1.5 text-neutral-500">
        <IconClock size={12} /> Reconciliation resumes automatically when this device is online.
      </p>
    </StateCard>
  );
}

export function VaultLockedNotice({ className = "" }: { className?: string }) {
  return (
    <StateCard
      tone="indigo"
      icon={<IconLock size={17} />}
      title="Vault locked — receiving is still safe"
      className={className}
    >
      <p>
        Incoming requests need only the public receiving address. Refunds, settlement sweeps, and
        every other outbound transaction stay unavailable until the wallet is unlocked.
      </p>
    </StateCard>
  );
}

export function HorizonOutageNotice({
  detail,
  onRetry,
  className = "",
}: {
  detail: string;
  onRetry: () => Promise<void>;
  className?: string;
}) {
  const [checking, setChecking] = useState(false);

  async function retry() {
    if (checking) return;
    triggerHaptic("selection");
    setChecking(true);
    try {
      await onRetry();
    } finally {
      setChecking(false);
    }
  }

  return (
    <StateCard
      tone="warn"
      icon={<IconAlert size={17} />}
      title="Payment watcher needs attention"
      className={className}
    >
      <p className="text-neutral-300">{detail}</p>
      <p className="mt-1">
        A submitted payment can still close on Stellar. This device will reconcile it after Horizon
        answers again; do not ask the customer to pay twice.
      </p>
      <button
        type="button"
        onClick={() => void retry()}
        disabled={checking}
        className="btn btn-secondary btn-sm mt-2.5"
      >
        {checking ? <Spinner size={13} /> : <IconRefresh size={13} />}
        {checking ? "Checking…" : "Check again"}
      </button>
    </StateCard>
  );
}

export function ConnectionRestoredNotice({
  queuedCount,
  className = "",
}: {
  queuedCount: number;
  className?: string;
}) {
  return (
    <StateCard
      tone="positive"
      icon={<IconCheck size={17} />}
      title="Back online — reconciliation resumed"
      className={className}
    >
      <p>
        {queuedCount > 0
          ? `${queuedCount} unexpired ${queuedCount === 1 ? "charge is" : "charges are"} being checked against the ledger.`
          : "There are no unexpired charges waiting for confirmation on this network."}
      </p>
    </StateCard>
  );
}

export function ForegroundMonitoringStatus({
  watching,
  wakeLockState,
  onWakeLockRetry,
}: {
  watching: boolean;
  wakeLockState: WakeLockState;
  onWakeLockRetry: () => void;
}) {
  const awake = wakeLockState === "active";
  const canRetry = wakeLockState === "error" || wakeLockState === "released";
  const label = !watching
    ? "Foreground monitoring paused"
    : awake
      ? "Foreground monitoring active"
      : wakeLockState === "requesting"
        ? "Starting foreground monitoring"
        : "Foreground monitoring · keep this app open";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Payment monitoring status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3.5 py-2.5 text-[11.5px] leading-relaxed text-neutral-400"
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${watching ? "bg-[#30D158]" : "bg-[#FF9F0A]"}`}
      />
      <span className="font-semibold text-neutral-200">{label}</span>
      <span className="min-w-[220px] flex-1">
        {awake
          ? "Screen awake protection is on. Closing or suspending the app pauses checks; reopening and unlocking reconciles missed payments."
          : "This browser cannot guarantee checks while closed or suspended. Reopening and unlocking reconciles missed payments."}
      </span>
      {canRetry && (
        <button
          type="button"
          onClick={onWakeLockRetry}
          className="min-h-11 rounded-lg px-2 font-semibold text-[#0A84FF]"
        >
          Retry screen lock
        </button>
      )}
    </div>
  );
}
