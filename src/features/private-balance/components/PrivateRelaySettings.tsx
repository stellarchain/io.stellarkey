'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button, Field, Notice, Toggle } from '@/components/ui';
import { IconChevronDown, IconShield } from '@/components/icons';
import { usePrivateBalanceRuntime } from '@/hooks/usePrivateBalanceRuntime';
import {
  loadPrivateRelayPreferences,
  savePrivateRelayPreferences,
  PRIVATE_RELAY_PREFERENCES_EVENT,
  type PrivateRelayPreferences,
} from '../relay/preferences';
import { validatePrivateRelayUrls } from '../relay/transport';
import { parsePrivateAmount } from '../runtime/coin-selection';
import { formatPrivateBalanceXlm } from '../runtime/selectors';

function feeForInput(feeAtomic: string): string {
  return formatPrivateBalanceXlm(BigInt(feeAtomic)).replace(/(?:\.0+|(\.\d*?)0+)$/u, '$1');
}

function RelayToggleRow({
  title,
  description,
  checked,
  label,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  label: string;
  onChange(checked: boolean): void;
}) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-white">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{description}</p>
      </div>
      <Toggle checked={checked} onChange={value => onChange(Boolean(value))} label={label} />
    </div>
  );
}

export function PrivateRelaySettings({
  helperOnly = false,
  onSaved,
}: {
  helperOnly?: boolean;
  onSaved?(): void;
} = {}) {
  const { requested, requestRuntime } = usePrivateBalanceRuntime();
  const [draft, setDraft] = useState<PrivateRelayPreferences>(loadPrivateRelayPreferences);
  const [saved, setSaved] = useState(draft);
  const [feeAmount, setFeeAmount] = useState(() => feeForInput(draft.feeAtomic));
  const [feedback, setFeedback] = useState<
    { state: 'idle' | 'saved' | 'started' | 'stopped' } |
    { state: 'error'; field: 'fee' | 'connections' | 'storage'; message: string }
  >({ state: 'idle' });
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const edited = useRef(new Set<'useRelay' | 'helpRelay' | 'feeAtomic' | number>());
  const id = useId();
  const error = feedback.state === 'error' ? feedback : null;
  const dirty = feeAmount !== feeForInput(saved.feeAtomic) ||
    draft.relayUrls.join('\n') !== saved.relayUrls.join('\n');

  useEffect(() => {
    // Keep participation current without discarding unfinished fee/URL edits.
    const refresh = () => {
      const next = loadPrivateRelayPreferences();
      if (!next.helpRelay && document.activeElement?.id === `${id}-stop-paused`) {
        document.getElementById(`${id}-participation`)?.focus();
      }
      setSaved(next);
      setDraft(current => ({
        ...next,
        useRelay: edited.current.has('useRelay') ? current.useRelay : next.useRelay,
        helpRelay: edited.current.has('helpRelay') ? current.helpRelay : next.helpRelay,
        relayUrls: next.relayUrls.map((url, index) => edited.current.has(index) ? current.relayUrls[index] ?? url : url),
      }));
      if (!edited.current.has('feeAtomic')) setFeeAmount(feeForInput(next.feeAtomic));
      setFeedback(current => current.state === 'error' ? current : { state: 'idle' });
    };
    window.addEventListener(PRIVATE_RELAY_PREFERENCES_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(PRIVATE_RELAY_PREFERENCES_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [id]);

  const update = (key: 'useRelay' | 'helpRelay', value: boolean) => {
    edited.current.add(key);
    setDraft(current => ({ ...current, [key]: value }));
    setFeedback({ state: 'idle' });
  };

  const updateRelay = (index: number, value: string) => {
    edited.current.add(index);
    setDraft(current => ({ ...current, relayUrls: current.relayUrls.map((url, slot) => slot === index ? value : url) }));
    setFeedback({ state: 'idle' });
  };

  const save = (helpRelay?: boolean) => {
    const latest = loadPrivateRelayPreferences();
    let feeAtomic: string;
    try {
      feeAtomic = edited.current.has('feeAtomic') ? parsePrivateAmount(feeAmount, 7).toString() : latest.feeAtomic;
      if (!/^[1-9][0-9]{0,20}$/u.test(feeAtomic)) throw new Error('Invalid fee');
    } catch {
      setFeedback({ state: 'error', field: 'fee', message: 'Enter a fee greater than 0 within the supported range, with up to 7 decimal places.' });
      return;
    }
    let relayUrls: string[];
    try {
      relayUrls = validatePrivateRelayUrls(latest.relayUrls.map((url, index) => edited.current.has(index) ? draft.relayUrls[index] ?? url : url));
    } catch {
      setConnectionsOpen(true);
      setFeedback({ state: 'error', field: 'connections', message: 'Use two different public relay addresses, each starting with wss://.' });
      return;
    }
    try {
      const next = savePrivateRelayPreferences({
        relayUrls, feeAtomic,
        useRelay: !helperOnly && edited.current.has('useRelay') ? draft.useRelay : latest.useRelay,
        helpRelay: helpRelay ?? (!helperOnly && edited.current.has('helpRelay') ? draft.helpRelay : latest.helpRelay),
      });
      const startRequested = next.helpRelay && (helpRelay === true ||
        (!helperOnly && edited.current.has('helpRelay')));
      edited.current.clear();
      setSaved(next);
      setDraft(next);
      setFeeAmount(feeForInput(next.feeAtomic));
      setFeedback({ state: helpRelay === true ? 'started' : 'saved' });
      // A persisted preference does not mount the private runtime. Only this
      // successful, explicit action supplies intent for the current scope.
      if (startRequested) requestRuntime();
      onSaved?.();
    } catch {
      setFeedback({ state: 'error', field: 'storage', message: 'Could not save relay settings. Check that browser storage is available and try again.' });
    }
  };

  const resume = () => {
    // Resume uses saved policy, independently of unfinished fee/URL edits.
    // Re-read so a stop from another tab cannot be undone by a stale control.
    const latest = loadPrivateRelayPreferences();
    setSaved(latest);
    if (!latest.helpRelay) return;
    requestRuntime();
    setFeedback({ state: 'started' });
  };

  const stop = () => {
    try {
      // Stopping must not depend on the validity of unfinished settings.
      const next = savePrivateRelayPreferences({ ...loadPrivateRelayPreferences(), helpRelay: false });
      setSaved(next);
      setFeedback({ state: 'stopped' });
    } catch {
      setFeedback({ state: 'error', field: 'storage', message: 'Could not save the stop request. Lock your wallet to end this helper session, then check browser storage.' });
    }
  };

  const relayFields = <div className="space-y-3">
    {[0, 1].map(index => <Field key={index} label={`Public relay ${index + 1}`}>
      <input className="input font-mono text-base sm:text-[13px]" inputMode="url" autoCapitalize="none"
        autoCorrect="off" spellCheck={false} value={draft.relayUrls[index] ?? ''}
        aria-invalid={error?.field === 'connections' || undefined}
        aria-describedby={error?.field === 'connections' ? `${id}-error` : undefined}
        onChange={event => updateRelay(index, event.target.value)} />
    </Field>)}
  </div>;
  const message = feedback.state === 'saved' ? 'Changes saved. New offers use these settings.'
    : feedback.state === 'started' ? 'Relaying enabled. Every transaction still needs your approval.'
      : feedback.state === 'stopped' ? 'Relaying stopped. Already shared signatures cannot be revoked.' : '';

  if (helperOnly) return <section aria-label="Relay controls">
    <div className="rounded-[20px] border border-white/10 bg-panel px-4 pb-3 pt-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`${id}-fee`} className="text-[13px] font-medium text-ink">Your fee per payment</label>
        <span className="text-[11px] font-medium text-muted">Paid privately</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <input id={`${id}-fee`} className="min-w-0 flex-1 rounded-lg bg-transparent py-1 text-[38px]! font-semibold leading-tight tracking-[-0.04em] text-ink tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent sm:text-[44px]!"
          inputMode="decimal" autoComplete="off" spellCheck={false} value={feeAmount}
          aria-describedby={`${id}-fee-hint${error?.field === 'fee' ? ` ${id}-error` : ''}`}
          aria-invalid={error?.field === 'fee' || undefined}
          onChange={event => { edited.current.add('feeAtomic'); setFeeAmount(event.target.value); setFeedback({ state: 'idle' }); }} />
        <span className="shrink-0 text-[12px] text-muted">asset units</span>
      </div>
      <p id={`${id}-fee-hint`} className="mt-1 text-[12px] leading-relaxed text-muted">Paid in the payment’s asset: XLM for XLM, USDC for USDC.</p>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.08] pt-2">
        <span className="text-[11px] text-muted">Applies to new offers</span>
        <Button type="button" variant="ghost" aria-disabled={!dirty}
          className={`min-h-11 shrink-0 ${!dirty ? 'text-muted' : ''}`}
          onClick={() => { if (dirty) save(); }}>Save changes</Button>
      </div>
    </div>

    <div className="flex items-start gap-2.5 px-1 py-4">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-accent"><IconShield size={16} /></span>
      <p className="text-[12px] leading-relaxed text-muted"><span className="font-medium text-ink">You approve every transaction.</span>{' '}
        You pay network fees in XLM; review the maximum before signing. Your account is public as the transaction source. A fee is not guaranteed profit.</p>
    </div>
    <p className="px-1 text-[11px] leading-relaxed text-muted">
      Starting automatically signs encrypted account-possession offers, not transactions. Public Nostr relays can see your IP address and connection timing.
      Keep StellarKey open and unlocked to receive requests.
    </p>
    {error ? <p id={`${id}-error`} role="alert" className="mt-3 rounded-xl border border-neg/30 bg-neg/10 p-3 text-[12px] leading-relaxed text-[#FF6961]">{error.message}</p> : null}
    <div role="status" aria-atomic="true" className="min-h-9 px-1 py-2 text-[11px] leading-relaxed text-muted">{message}</div>
    <Button id={`${id}-participation`} type="button" variant={saved.helpRelay && requested ? 'secondary' : 'primary'} className="min-h-12 w-full"
      onClick={() => { if (!saved.helpRelay) save(true); else if (!requested) resume(); else stop(); }}>
      {!saved.helpRelay ? 'Start relaying' : requested ? 'Stop relaying' : 'Resume relaying'}
    </Button>
    {saved.helpRelay && !requested ? <Button id={`${id}-stop-paused`} type="button" variant="secondary" className="mt-2 min-h-12 w-full" onClick={stop}>
      Stop relaying
    </Button> : null}
    <p className="px-1 pb-3 pt-2 text-center text-[11px] leading-relaxed text-muted">Stopping cannot revoke a signature already shared.</p>

    <details className="group/connections border-t border-white/[0.08]" open={connectionsOpen}
      onToggle={event => setConnectionsOpen(event.currentTarget.open)}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 text-[13px] font-medium text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        Relay connections<IconChevronDown size={14} className="shrink-0 group-open/connections:rotate-180" />
      </summary>
      <div className="space-y-3 pb-4">
        <p className="px-1 text-[12px] leading-relaxed text-muted">No StellarKey backend. Two public Nostr relays carry encrypted messages. Saving settings restarts your offer session; already shared signatures remain valid.</p>
        {relayFields}
        <p className="px-1 text-[11px] leading-relaxed text-muted">An offer proves control of the account key, not that the account meets its transaction signing threshold. Every exact transaction still requires your approval.</p>
        <Button type="button" variant="secondary" className="w-full" onClick={() => save()}>Save connections</Button>
      </div>
    </details>
  </section>;

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-2">
      <h3 id={`${id}-title`} className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        Peer relay
      </h3>
      <div className="ios-group overflow-hidden">
          <RelayToggleRow
            title="Prefer privacy relay"
            description="Preselect a peer wallet for new private sends and withdrawals."
            checked={draft.useRelay}
            label="Prefer privacy relay for new private payments"
            onChange={value => update('useRelay', value)}
          />
        <div className="border-t border-white/[0.07]">
          <RelayToggleRow
            title="Help relay private payments"
            description="Offer this wallet as a peer while StellarKey is open and unlocked."
            checked={draft.helpRelay}
            label="Help relay private payments from other wallets"
            onChange={value => update('helpRelay', value)}
          />
        </div>
        <div className="space-y-3 border-t border-white/[0.07] px-4 py-4">
          {relayFields}
          <Field
            label="Private fee"
            hint="0.001 means 0.001 XLM for XLM, or 0.001 USDC for USDC."
          >
            <input
              className="input font-mono text-base sm:text-[13px]"
              inputMode="decimal"
              value={feeAmount}
              onChange={event => {
                edited.current.add('feeAtomic');
                setFeeAmount(event.target.value);
                setFeedback({ state: 'idle' });
              }}
            />
          </Field>
          <Notice>
            No StellarKey backend is involved. The browser connects to two public Nostr relays;
            those operators can observe your IP address and connection timing. Helping
            automatically signs encrypted account-possession offers while unlocked;
            every exact transaction still requires your approval. An offer proves control
            of the account key, not that the account meets its transaction signing threshold.
          </Notice>
          {error ? <p id={`${id}-error`} role="alert" className="text-[12px] text-[#FF6961]">{error.message}</p> : null}
          <p role="status" className="text-[12px] text-muted">{message}</p>
          <Button type="button" className="w-full" onClick={() => save()}>
            Save relay settings
          </Button>
        </div>
      </div>
    </section>
  );
}
