'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Notice, Toggle } from '@/components/ui';
import type { PrivateOutgoingHistoryMode } from '../runtime/outgoing-history';
import { HumanizedErrorNotice } from './PrivateBalanceStatus';

type OutgoingHistorySettingsProps = {
  scope: string;
  mode: PrivateOutgoingHistoryMode;
  disabled: boolean;
  onChange(mode: PrivateOutgoingHistoryMode, consent: { acknowledgeRecoveryLoss?: boolean }): Promise<void>;
};

export function PrivateOutgoingHistorySettings(props: OutgoingHistorySettingsProps) {
  // Only this local preference panel resets on account/deployment change. The
  // containing modal shell, focus ownership and scroll lock remain mounted.
  return <OutgoingHistoryPreference key={props.scope} {...props} />;
}

function OutgoingHistoryPreference({ mode, disabled, onChange }: OutgoingHistorySettingsProps) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const requestRef = useRef<object | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef(false);

  useEffect(() => () => { requestRef.current = null; }, []);
  useEffect(() => {
    if (saving || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    sectionRef.current?.querySelector<HTMLButtonElement>('[role="switch"]')?.focus({ preventScroll: true });
  }, [saving, confirming, mode]);

  const save = async (next: PrivateOutgoingHistoryMode) => {
    if (disabled || requestRef.current !== null) return;
    const request = {};
    requestRef.current = request;
    setSaving(true);
    setError(null);
    try {
      await onChange(next, { acknowledgeRecoveryLoss: next === 'minimized' });
      if (requestRef.current !== request) return;
      setConfirming(false);
    } catch (cause: unknown) {
      if (requestRef.current !== request) return;
      setError(cause ?? new Error('Outgoing recovery preference was not saved.'));
    } finally {
      if (requestRef.current === request) {
        // Success removes the consent control; failure re-enables it. In both
        // cases recover lost focus without stealing it from another control.
        restoreFocusRef.current = document.activeElement === document.body
          || !!sectionRef.current?.contains(document.activeElement);
        requestRef.current = null;
        setSaving(false);
      }
    }
  };

  return (
    <section ref={sectionRef} aria-labelledby="private-outgoing-history-title" className="space-y-3">
      <h3 id="private-outgoing-history-title" className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
        Outgoing recovery
      </h3>
      <div className="ios-group flex min-h-16 items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-white">Recover outgoing payment details</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-400">
            Include encrypted records that let your recovery phrase restore future sent recipient and memo details.
          </p>
        </div>
        <Toggle
          label="Recover outgoing payment details"
          checked={mode === 'recoverable'}
          disabled={disabled || saving}
          onChange={checked => {
            setError(null);
            if (checked) void save('recoverable');
            else setConfirming(true);
          }}
        />
      </div>
      <p className="px-1 text-[12px] leading-relaxed text-neutral-400">
        Applies to new actions for this account and deployment. It does not erase older records or backups.
        A seed-only restore resets this local setting to recovery enabled. Recipients still know their own payments.
      </p>
      {confirming ? (
        <div className="space-y-3">
          <Notice tone="warn">
            Future sent recipient and memo details will not be recoverable from this wallet’s outgoing records.
            Balances, spent notes, and incoming payments still recover. Payment preparation and pending safety
            records still need details until resolved and may remain pending indefinitely. These payments will not add recent recipients on this device.
          </Notice>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={disabled || saving} onClick={() => {
              // Return focus before removing the consent action that owns it.
              sectionRef.current?.querySelector<HTMLButtonElement>('[role="switch"]')?.focus({ preventScroll: true });
              setConfirming(false);
            }}>
              Keep recovery enabled
            </Button>
            <Button type="button" disabled={disabled || saving} loading={saving} onClick={() => void save('minimized')}>
              Omit future outgoing details
            </Button>
          </div>
        </div>
      ) : mode === 'minimized' ? (
        <Notice>Future outgoing details are omitted. Balances, spent notes, and incoming payments still recover.</Notice>
      ) : null}
      <div aria-live="polite">
        {saving ? <p className="text-[12px] text-neutral-400">Saving preference…</p> : null}
        {error !== null ? <HumanizedErrorNotice cause={error} /> : null}
      </div>
    </section>
  );
}
