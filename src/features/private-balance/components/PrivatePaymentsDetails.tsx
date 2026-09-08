'use client';

import { useState } from 'react';
import { IconChevronDown, IconRefresh, IconShield } from '@/components/icons';
import { Modal, ModalBody, ModalHeader } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { PrivacyDisclosure } from './PrivacyDisclosure';
import { HumanizedErrorNotice, PrivateBalanceStatus } from './PrivateBalanceStatus';
import { PrivateProtocolSettingsContent } from './PrivateProtocolSettings';
import { PrivateRecoveryContent } from './PrivateRecovery';
import { useReportToOwner } from './useReportToOwner';

export type PrivateSettingsStep = 'details' | 'recovery' | 'protocol';

export const PRIVATE_SETTINGS_STEP_HEADER: Record<PrivateSettingsStep, { title: string; subtitle: string }> = {
  details: { title: 'Private Payments details', subtitle: 'Status, recovery, and privacy' },
  recovery: { title: 'Recovery', subtitle: 'Restore access on this device' },
  protocol: { title: 'Advanced privacy', subtitle: 'Verification and data stored on this device' },
};

export const PRIVATE_SETTINGS_BUSY_REASON = 'Wait for the current check to finish before closing.';

function Chevron() {
  return <IconChevronDown size={15} className="shrink-0 -rotate-90 text-neutral-600" />;
}

function ManageRow({
  icon,
  tone,
  title,
  subtitle,
  trailing,
  disabled = false,
  divider = true,
  onClick,
}: {
  icon: React.ReactNode;
  tone: string;
  title: string;
  subtitle: string;
  trailing?: React.ReactNode;
  disabled?: boolean;
  divider?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`row-hover ${divider ? 'ios-sep ' : ''}flex min-h-16 w-full items-center gap-3.5 px-4 py-3 text-left disabled:opacity-60`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-white">{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-neutral-500">{subtitle}</span>
      </span>
      {trailing}
    </button>
  );
}

/**
 * The details step: current status, what stays public, and the manage rows
 * that lead to the Recovery and Advanced privacy steps of the same dialog.
 */
export function PrivatePaymentsDetailsContent({
  onNavigate,
  onBusyChange,
}: {
  onNavigate(step: Exclude<PrivateSettingsStep, 'details'>): void;
  onBusyChange?(busy: boolean): void;
}) {
  const { phase, refreshSync } = usePrivateBalanceRuntimeData();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const working = refreshing ||
    ['loading-artifacts', 'reading-meta', 'scanning-live'].includes(phase);
  useReportToOwner(onBusyChange, refreshing, false);

  // The refresh affordance lives here — the card stays silent when healthy.
  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await refreshSync();
    } catch (cause: unknown) {
      setRefreshError(cause ?? new Error('Private payments stopped safely.'));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <ModalBody gap={5}>
      <section aria-labelledby="private-details-status">
        <h3 id="private-details-status" className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
          Current status
        </h3>
        <PrivateBalanceStatus detailed />
      </section>

      <section aria-labelledby="private-details-privacy">
        <h3 id="private-details-privacy" className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
          What stays public
        </h3>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
          <PrivacyDisclosure />
        </div>
      </section>

      <section aria-labelledby="private-details-tools">
        <h3 id="private-details-tools" className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
          Manage
        </h3>
        <div className="list-group">
          <ManageRow
            icon={<IconRefresh size={17} className={working ? 'animate-spin' : ''} />}
            tone="bg-white/[0.06] text-neutral-200"
            title={working ? 'Updating…' : 'Refresh'}
            subtitle="Check for new private activity"
            disabled={working}
            divider={false}
            onClick={() => void refresh()}
          />
          <ManageRow
            icon={<IconRefresh size={17} />}
            tone="bg-[#30D158]/12 text-[#30D158]"
            title="Recovery"
            subtitle="Restore or rescan safely"
            trailing={<Chevron />}
            onClick={() => onNavigate('recovery')}
          />
          <ManageRow
            icon={<IconShield size={17} />}
            tone="bg-[#0A84FF]/12 text-[#0A84FF]"
            title="Advanced privacy"
            subtitle="Verification and data on this device"
            trailing={<Chevron />}
            onClick={() => onNavigate('protocol')}
          />
        </div>
        <div aria-live="polite" className="mt-2">
          {refreshError !== null ? <HumanizedErrorNotice cause={refreshError} /> : null}
        </div>
      </section>

      <p className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-neutral-500">
        <IconShield size={14} className="mt-0.5 shrink-0" />
        Proofs are created on this device; only the finished transaction reaches Stellar.
        StellarKey has no recovery server.
      </p>
    </ModalBody>
  );
}

/** One step of the Private Payments settings, rendered by whichever dialog hosts it. */
export function PrivateSettingsStepContent({
  step,
  onNavigate,
  onClose,
  onRemoved,
  onBusyChange,
  onDirtyChange,
}: {
  step: PrivateSettingsStep;
  onNavigate(step: PrivateSettingsStep): void;
  onClose(): void;
  onRemoved?(): void;
  onBusyChange?(busy: boolean): void;
  onDirtyChange?(dirty: boolean): void;
}) {
  if (step === 'recovery') return <PrivateRecoveryContent onBusyChange={onBusyChange} />;
  if (step === 'protocol') {
    return (
      <PrivateProtocolSettingsContent
        onClose={onClose}
        onRemoved={onRemoved}
        onBusyChange={onBusyChange}
        onDirtyChange={onDirtyChange}
      />
    );
  }
  return <PrivatePaymentsDetailsContent onNavigate={onNavigate} onBusyChange={onBusyChange} />;
}

function PrivateSettingsSteps({
  initialStep,
  onClose,
  onRemoved,
  onBusyChange,
  onDirtyChange,
}: {
  initialStep: PrivateSettingsStep;
  onClose(): void;
  onRemoved?(): void;
  onBusyChange(busy: boolean): void;
  onDirtyChange(dirty: boolean): void;
}) {
  const [step, setStep] = useState<PrivateSettingsStep>(initialStep);
  const header = PRIVATE_SETTINGS_STEP_HEADER[step];
  return (
    <>
      <ModalHeader
        title={header.title}
        subtitle={header.subtitle}
        onClose={onClose}
        onBack={step === 'details' ? undefined : () => setStep('details')}
      />
      <PrivateSettingsStepContent
        step={step}
        onNavigate={setStep}
        onClose={onClose}
        onRemoved={onRemoved}
        onBusyChange={onBusyChange}
        onDirtyChange={onDirtyChange}
      />
    </>
  );
}

/**
 * The standalone Private Payments dialog: details, recovery, and advanced
 * privacy are steps of one shell with a header back control, so moving
 * between them never replays an entrance animation.
 */
export function PrivatePaymentsDetails({
  open = true,
  initialStep = 'details',
  onClose,
  onRemoved,
}: {
  open?: boolean;
  initialStep?: PrivateSettingsStep;
  onClose(): void;
  onRemoved?(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  return (
    <Modal open={open} onClose={onClose} wide busy={busy} busyReason={PRIVATE_SETTINGS_BUSY_REASON} dirty={dirty}>
      {open ? (
        <PrivateSettingsSteps
          initialStep={initialStep}
          onClose={onClose}
          onRemoved={onRemoved}
          onBusyChange={setBusy}
          onDirtyChange={setDirty}
        />
      ) : null}
    </Modal>
  );
}
