'use client';

import { useState, type ReactNode } from 'react';
import {
  IconCheck,
  IconChevronDown,
  IconRefresh,
  IconTrash,
} from '@/components/icons';
import { Button, Field, Modal, ModalHeader, Notice } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { HumanizedErrorNotice } from './PrivateBalanceStatus';

function fingerprint(value: string | null): string {
  if (!value) return 'Not recorded';
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

function bytes(value: number | null): string {
  if (value === null) return 'Not measured';
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function SettingsRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="ios-sep flex min-h-12 items-center justify-between gap-4 px-4 py-3 text-[13px]">
      <dt className="shrink-0 text-neutral-400">{label}</dt>
      <dd
        title={value}
        className={`min-w-0 break-all text-right font-semibold text-neutral-100 ${mono ? 'font-mono text-[11px]' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

function DisclosureButton({
  icon,
  title,
  subtitle,
  expanded,
  controls,
  danger = false,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  expanded: boolean;
  controls: string;
  danger?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      className="row-hover flex min-h-16 w-full items-center gap-3.5 px-4 py-3 text-left"
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${danger ? 'bg-[#FF453A]/12 text-[#FF6961]' : 'bg-white/[0.06] text-neutral-300'}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[13.5px] font-semibold ${danger ? 'text-[#FF6961]' : 'text-white'}`}>{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-neutral-500">{subtitle}</span>
      </span>
      <IconChevronDown size={15} className={`shrink-0 text-neutral-600 transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
  );
}

export function PrivateProtocolSettings({
  onClose,
  onRemoved,
}: {
  onClose(): void;
  onRemoved?(): void;
}) {
  const {
    protocolVersion,
    deployment,
    asset,
    selectedRpc,
    checkpoint,
    encryptedStorageBytes,
    noteCount,
    runFullVerification,
    disableLocalData,
  } = usePrivateBalanceRuntimeData();
  const [working, setWorking] = useState<'verify' | 'remove' | null>(null);
  // The raw cause is kept whole so the display routes through the humanizer
  // (title + body, raw message behind collapsed Technical details).
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<string | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const [showRemoval, setShowRemoval] = useState(false);
  const [confirmation, setConfirmation] = useState('');

  const verify = async () => {
    setWorking('verify');
    setError(null);
    setResult(null);
    try {
      await runFullVerification();
      setResult('Private history verified.');
    } catch (cause: unknown) {
      setError(cause ?? new Error('Private history verification stopped safely.'));
    } finally {
      setWorking(null);
    }
  };

  const remove = async () => {
    setWorking('remove');
    setError(null);
    setResult(null);
    try {
      await disableLocalData(confirmation);
      onRemoved?.();
      onClose();
    } catch (cause: unknown) {
      setError(cause ?? new Error('Local private data was not removed.'));
      setWorking(null);
    }
  };

  const lastCheckpoint = checkpoint
    ? `Action ${checkpoint.lastActionIndex}`
    : 'Not available';

  return (
    <Modal open onClose={onClose} dismissable={!working} wide>
      <ModalHeader
        title="Advanced privacy"
        subtitle="Verification and data stored on this device"
        onClose={working ? undefined : onClose}
      />
      <div className="space-y-5 p-4 sm:p-6">
        <section aria-labelledby="private-maintenance-title">
          <h3 id="private-maintenance-title" className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Maintenance
          </h3>
          <div className="ios-group overflow-hidden">
            <button
              type="button"
              disabled={working !== null}
              onClick={() => void verify()}
              className="row-hover flex min-h-16 w-full items-center gap-3.5 px-4 py-3 text-left disabled:opacity-45"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0A84FF]/12 text-[#0A84FF]">
                <IconRefresh size={17} className={working === 'verify' ? 'animate-spin' : ''} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-white">Verify private history</span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-neutral-500">
                  Recheck your private history against the network from scratch.
                </span>
              </span>
              <span className="shrink-0 text-[12px] font-semibold text-[#0A84FF]">
                {working === 'verify' ? 'Checking' : 'Run'}
              </span>
            </button>
          </div>
        </section>

        <div aria-live="polite" className="space-y-2">
          {result ? (
            <p className="flex items-center gap-2 rounded-2xl bg-[#30D158]/9 px-3.5 py-3 text-[12px] font-medium text-[#30D158]">
              <IconCheck size={15} />
              {result}
            </p>
          ) : null}
          {error !== null ? <HumanizedErrorNotice cause={error} /> : null}
        </div>

        <section aria-labelledby="private-local-state-title">
          <h3 id="private-local-state-title" className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            On this device
          </h3>
          <dl className="ios-group overflow-hidden">
            <SettingsRow label="Encrypted local data" value={bytes(encryptedStorageBytes)} />
            <SettingsRow label="Network endpoint" value={selectedRpc ?? 'Not configured'} mono />
          </dl>
        </section>

        <section aria-label="Advanced controls" className="ios-group overflow-hidden">
          <DisclosureButton
            icon={<span className="font-mono text-[12px] font-bold">#</span>}
            title="Technical details"
            subtitle="Versions and cryptographic identifiers"
            expanded={showTechnical}
            controls="private-technical-details"
            onClick={() => setShowTechnical(value => !value)}
          />
          {showTechnical ? (
            <dl id="private-technical-details" className="border-t border-white/[0.07] bg-black/10">
              <SettingsRow label="Last checkpoint" value={lastCheckpoint} />
              <SettingsRow label="Unspent notes" value={noteCount.toLocaleString()} />
              <SettingsRow label="Protocol version" value={`V${protocolVersion}`} />
              <SettingsRow label="Artifact version" value={deployment.artifactVersion ?? 'Not recorded'} />
              <SettingsRow label="Realm" value={fingerprint(deployment.realmId)} mono />
              <SettingsRow label="Selected asset contract" value={fingerprint(asset?.contractId ?? null)} mono />
              <SettingsRow label="Manifest hash" value={fingerprint(deployment.manifestHash)} mono />
              <SettingsRow label="Circuit hash" value={fingerprint(deployment.circuitHash)} mono />
            </dl>
          ) : null}
        </section>

        <section className="ios-group overflow-hidden">
          <DisclosureButton
            icon={<IconTrash size={16} />}
            title="Remove private data from this device"
            subtitle="Does not withdraw funds"
            expanded={showRemoval}
            controls="private-data-removal"
            danger
            onClick={() => setShowRemoval(value => !value)}
          />
          {showRemoval ? (
            <div id="private-data-removal" className="space-y-3 border-t border-[#FF453A]/15 bg-[#FF453A]/[0.035] p-4">
              <p className="text-[12px] leading-relaxed text-neutral-400">
                This does not withdraw funds and does not delete ciphertext or activity stored on-chain. Seed-only recovery verifies the immutable record directly from Stellar.
              </p>
              {noteCount > 0 ? (
                <Notice tone="warn">
                  Your private balance is spendable from this device. Continue only after checking that recovery works.
                </Notice>
              ) : null}
              <Field label="Type REMOVE PRIVATE BALANCE to confirm">
                <input
                  className="input text-base sm:text-[14px]"
                  autoComplete="off"
                  value={confirmation}
                  onChange={event => setConfirmation(event.target.value)}
                />
              </Field>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={working !== null}
                  onClick={() => {
                    setShowRemoval(false);
                    setConfirmation('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  loading={working === 'remove'}
                  disabled={working !== null || confirmation !== 'REMOVE PRIVATE BALANCE'}
                  onClick={() => void remove()}
                >
                  Remove from this device
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </Modal>
  );
}
