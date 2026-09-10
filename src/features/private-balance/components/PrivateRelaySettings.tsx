'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, Field, FieldLabelRow, Notice, QuickAmountChips, SegmentedControl, Toggle } from '@/components/ui';
import { IconChevronDown, IconEye, IconLock, IconShield, IconWallet } from '@/components/icons';
import { usePrivateBalanceRuntime } from '@/hooks/usePrivateBalanceRuntime';
import {
  loadPrivateRelayPreferences,
  savePrivateRelayPreferences,
  PRIVATE_RELAY_PREFERENCES_EVENT,
  type PrivateRelayPreferences,
} from '../relay/preferences';
import { describePrivateRelayNetwork, privateRelayNetwork, validateWakuClusterId, validateWakuPeerAddresses, type PrivateRelayTransportKind } from '../relay/network';
import { validatePrivateRelayUrls } from '../relay/transport';
import { parsePrivateAmount } from '../runtime/coin-selection';
import { formatPrivateBalanceXlm } from '../runtime/selectors';
import { useReportToOwner } from './useReportToOwner';

/** Common fee levels in display units; the field accepts anything with up to 7 decimals. */
const FEE_PRESETS = [0.001, 0.005, 0.01, 0.05] as const;

/** One row of the "what to expect" list: an icon tile, a plain statement and its consequence. */
function ExpectRow({
  icon,
  tint,
  title,
  sub,
  sep = false,
}: {
  icon: ReactNode;
  tint: string;
  title: string;
  sub: string;
  sep?: boolean;
}) {
  return (
    <div className={`flex items-start gap-3.5 px-4 py-3 ${sep ? 'ios-sep' : ''}`}>
      <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-sm" style={{ background: tint }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold leading-tight text-white">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-neutral-400">{sub}</span>
      </span>
    </div>
  );
}

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
  onDirtyChange,
  extras,
}: {
  helperOnly?: boolean;
  onSaved?(): void;
  /** Helper-only: extra disclosure sections rendered above the pinned action row. */
  extras?: ReactNode;
  /** Reports unfinished fee or relay-address edits so the owning dialog can guard its dismissal. */
  onDirtyChange?(dirty: boolean): void;
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
  const edited = useRef(new Set<'useRelay' | 'helpRelay' | 'feeAtomic' | 'transport' | 'wakuPeers' | 'wakuClusterId' | number>());
  const [wakuPeersDraft, setWakuPeersDraft] = useState<string[]>(() => [draft.wakuPeers[0] ?? '', draft.wakuPeers[1] ?? '']);
  const [wakuClusterDraft, setWakuClusterDraft] = useState(() => String(draft.wakuClusterId));
  const id = useId();
  const error = feedback.state === 'error' ? feedback : null;
  const dirty = feeAmount !== feeForInput(saved.feeAtomic) ||
    draft.transport !== saved.transport ||
    draft.relayUrls.join('\n') !== saved.relayUrls.join('\n') ||
    wakuPeersDraft.map(peer => peer.trim()).filter(Boolean).join('\n') !== saved.wakuPeers.join('\n') ||
    wakuClusterDraft.trim() !== String(saved.wakuClusterId);
  const networkCopy = describePrivateRelayNetwork(privateRelayNetwork({ ...draft, wakuPeers: wakuPeersDraft.filter(peer => peer.trim()) }));
  useReportToOwner(onDirtyChange, dirty, false);

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
        transport: edited.current.has('transport') ? current.transport : next.transport,
        relayUrls: next.relayUrls.map((url, index) => edited.current.has(index) ? current.relayUrls[index] ?? url : url),
      }));
      if (!edited.current.has('feeAtomic')) setFeeAmount(feeForInput(next.feeAtomic));
      if (!edited.current.has('wakuPeers')) setWakuPeersDraft([next.wakuPeers[0] ?? '', next.wakuPeers[1] ?? '']);
      if (!edited.current.has('wakuClusterId')) setWakuClusterDraft(String(next.wakuClusterId));
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

  const updateTransport = (value: PrivateRelayTransportKind) => {
    edited.current.add('transport');
    setDraft(current => ({ ...current, transport: value }));
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
    const transport = edited.current.has('transport') ? draft.transport : latest.transport;
    let wakuPeers: string[];
    let wakuClusterId: number;
    try {
      wakuPeers = edited.current.has('wakuPeers') ? validateWakuPeerAddresses(wakuPeersDraft) : latest.wakuPeers;
      wakuClusterId = edited.current.has('wakuClusterId') ? validateWakuClusterId(wakuClusterDraft) : latest.wakuClusterId;
    } catch (cause) {
      setConnectionsOpen(true);
      setFeedback({ state: 'error', field: 'connections', message: cause instanceof Error ? cause.message : 'Check the Waku peer settings.' });
      return;
    }
    let relayUrls: string[];
    try {
      // Relay addresses only matter on Nostr; a Waku session discovers its peers.
      relayUrls = transport === 'nostr'
        ? validatePrivateRelayUrls(latest.relayUrls.map((url, index) => edited.current.has(index) ? draft.relayUrls[index] ?? url : url))
        : latest.relayUrls;
    } catch {
      setConnectionsOpen(true);
      setFeedback({ state: 'error', field: 'connections', message: 'Use two different public relay addresses, each starting with wss://.' });
      return;
    }
    try {
      const next = savePrivateRelayPreferences({
        relayUrls, feeAtomic, transport, wakuPeers, wakuClusterId,
        useRelay: !helperOnly && edited.current.has('useRelay') ? draft.useRelay : latest.useRelay,
        helpRelay: helpRelay ?? (!helperOnly && edited.current.has('helpRelay') ? draft.helpRelay : latest.helpRelay),
      });
      const startRequested = next.helpRelay && (helpRelay === true ||
        (!helperOnly && edited.current.has('helpRelay')));
      edited.current.clear();
      setSaved(next);
      setDraft(next);
      setFeeAmount(feeForInput(next.feeAtomic));
      setWakuPeersDraft([next.wakuPeers[0] ?? '', next.wakuPeers[1] ?? '']);
      setWakuClusterDraft(String(next.wakuClusterId));
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
    <div>
      <p id={`${id}-transport-label`} className="field-label">Message transport</p>
      <SegmentedControl<PrivateRelayTransportKind>
        ariaLabel="Choose how relay messages travel"
        value={draft.transport}
        options={[
          { label: 'Nostr relays', value: 'nostr' },
          { label: 'Waku network (beta)', value: 'waku' },
        ]}
        onChange={value => updateTransport(value)}
      />
    </div>
    {draft.transport === 'nostr' ? <div className="space-y-3">{[0, 1].map(index => <Field key={index} label={`Public relay ${index + 1}`}>
      <input className="input mono text-base sm:text-[13px]" inputMode="url" autoCapitalize="none"
        enterKeyHint={index === 0 ? 'next' : 'done'}
        autoCorrect="off" spellCheck={false} value={draft.relayUrls[index] ?? ''}
        aria-invalid={error?.field === 'connections' || undefined}
        aria-describedby={error?.field === 'connections' ? `${id}-error` : undefined}
        onChange={event => {
          // Inline so the compiler sees the ref read inside an event handler.
          edited.current.add(index);
          setDraft(current => ({ ...current, relayUrls: current.relayUrls.map((url, slot) => slot === index ? event.target.value : url) }));
          setFeedback({ state: 'idle' });
        }} />
    </Field>)}</div> : <div className="space-y-3">
      <Notice compact>
        Beta. Leave the peers empty to use the public Waku network, which discovers light-push and filter peers for you.
        Public service nodes rate-limit publishing without an RLN membership, so a full exchange may not complete there;
        for reliable relaying enter the websocket addresses of Waku service nodes you run or trust, on their cluster
        (each node needs at least one relay peer, or it refuses to publish).
        Messages stay end-to-end encrypted either way; the peers see your IP address and timing, not your payment.
      </Notice>
      {[0, 1].map(index => <Field key={index} label={`Waku peer ${index + 1} (optional)`}>
        <input className="input mono text-base sm:text-[13px]" inputMode="url" autoCapitalize="none"
          placeholder="/dns4/node.example/tcp/8000/wss/p2p/16Uiu2…"
          autoCorrect="off" spellCheck={false} value={wakuPeersDraft[index] ?? ''}
          aria-invalid={error?.field === 'connections' || undefined}
          aria-describedby={error?.field === 'connections' ? `${id}-error` : undefined}
          onChange={event => {
            edited.current.add('wakuPeers');
            setWakuPeersDraft(current => current.map((peer, slot) => slot === index ? event.target.value : peer));
            setFeedback({ state: 'idle' });
          }} />
      </Field>)}
      <Field label="Waku cluster" hint="1 is the public Waku Network. Self-hosted nodes must run this cluster with auto-sharding.">
        <input className="input mono text-base sm:text-[13px]" inputMode="numeric" value={wakuClusterDraft}
          aria-invalid={error?.field === 'connections' || undefined}
          aria-describedby={error?.field === 'connections' ? `${id}-error` : undefined}
          onChange={event => {
            edited.current.add('wakuClusterId');
            setWakuClusterDraft(event.target.value);
            setFeedback({ state: 'idle' });
          }} />
      </Field>
    </div>}
  </div>;
  const message = feedback.state === 'saved' ? 'Changes saved. New offers use these settings.'
    : feedback.state === 'started' ? 'Relaying enabled. Every transaction still needs your approval.'
      : feedback.state === 'stopped' ? 'Relaying stopped. Already shared signatures cannot be revoked.' : '';

  if (helperOnly) return <section aria-label="Relay controls" className="space-y-4">
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <FieldLabelRow htmlFor={`${id}-fee`} label="Your fee per payment" meta="Paid privately" />
      <div>
        <input id={`${id}-fee`} className="input mono text-[22px]! font-semibold tabular-nums sm:text-[22px]!"
          inputMode="decimal" enterKeyHint="done" autoComplete="off" spellCheck={false} value={feeAmount}
          aria-describedby={`${id}-fee-hint${error?.field === 'fee' ? ` ${id}-error` : ''}`}
          aria-invalid={error?.field === 'fee' || undefined}
          onChange={event => { edited.current.add('feeAtomic'); setFeeAmount(event.target.value); setFeedback({ state: 'idle' }); }} />
      </div>
      <QuickAmountChips className="mt-2.5" values={FEE_PRESETS}
        onPick={value => { edited.current.add('feeAtomic'); setFeeAmount(value); setFeedback({ state: 'idle' }); }} />
      <p id={`${id}-fee-hint`} className="mt-2.5 text-[12px] leading-relaxed text-neutral-400">
        Paid in the payment’s asset: XLM for XLM, USDC for USDC. Changes apply to new offers.
      </p>
      <div className="mt-3 flex justify-end">
        <Button type="button" variant="secondary" aria-disabled={!dirty}
          onClick={() => { if (dirty) save(); }}>Save Changes</Button>
      </div>
    </div>

    <div>
      <p className="px-1 pb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">What to expect</p>
      <div className="list-group">
        <ExpectRow icon={<IconShield size={15} />} tint="#30D158" title="You approve every transaction"
          sub="No transaction is signed without your approval. The maximum network fee is shown before you sign." />
        <ExpectRow icon={<IconWallet size={15} />} tint="#0A84FF" title="Network fees are yours" sep
          sub="You pay network fees in XLM, and your account is public as the transaction source. A fee is not guaranteed profit." />
        <ExpectRow icon={<IconEye size={15} />} tint="#FF9F0A" title={`${draft.transport === 'waku' ? 'Waku peers' : 'Public relays'} see your connection`} sep
          sub={networkCopy.observers} />
        <ExpectRow icon={<IconLock size={15} />} tint="#5E5CE6" title="Keep StellarKey open and unlocked" sep
          sub="Starting automatically signs encrypted account-possession offers, not transactions. Requests arrive only while unlocked." />
      </div>
    </div>

    <details className="group/connections rounded-2xl border border-white/10 bg-white/[0.03]" open={connectionsOpen}
      onToggle={event => setConnectionsOpen(event.currentTarget.open)}>
      <summary className="tap flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-[13.5px] font-semibold text-white hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A84FF] [&::-webkit-details-marker]:hidden">
        Relay connections
        <IconChevronDown size={14} className="shrink-0 text-neutral-400 transition-transform group-open/connections:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-white/[0.08] px-4 pb-4 pt-3">
        <p className="text-[12px] leading-relaxed text-neutral-400">No StellarKey backend. {draft.transport === 'waku' ? 'Waku light-push and filter peers carry encrypted messages.' : 'Two public Nostr relays carry encrypted messages.'} Saving settings restarts your offer session; already shared signatures remain valid.</p>
        {relayFields}
        <p className="text-[11px] leading-relaxed text-neutral-400">An offer proves control of the account key, not that the account meets its transaction signing threshold. Every exact transaction still requires your approval.</p>
        <Button type="button" variant="secondary" className="w-full" onClick={() => save()}>Save connections</Button>
      </div>
    </details>
    {extras}

    <div className="modal-footer-pinned -mb-4 mt-1 grid grid-cols-1 gap-2 pb-4 pt-3 sm:-mb-6 sm:pb-6">
      {error ? <Notice id={`${id}-error`} tone="danger" compact role="alert">{error.message}</Notice> : null}
      <div role="status" aria-atomic="true" className="min-h-5 px-1 text-[12px] leading-relaxed text-neutral-400">{message}</div>
      <Button id={`${id}-participation`} type="button" variant={saved.helpRelay && requested ? 'secondary' : 'primary'} className="w-full"
        onClick={() => { if (!saved.helpRelay) save(true); else if (!requested) resume(); else stop(); }}>
        {!saved.helpRelay ? 'Start Relaying' : requested ? 'Stop Relaying' : 'Resume Relaying'}
      </Button>
      {saved.helpRelay && !requested ? <Button id={`${id}-stop-paused`} type="button" variant="secondary" className="w-full" onClick={stop}>
        Stop Relaying
      </Button> : null}
      <p className="text-center text-[11px] leading-relaxed text-neutral-400">Stopping cannot revoke a signature already shared.</p>
    </div>

  </section>;

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-2">
      <h3 id={`${id}-title`} className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
        Peer relay
      </h3>
      <div className="list-group">
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
            label="Private Fee"
            hint="0.001 means 0.001 XLM for XLM, or 0.001 USDC for USDC."
          >
            <input
              className="input mono text-base sm:text-[13px]"
              inputMode="decimal"
              enterKeyHint="done"
              value={feeAmount}
              onChange={event => {
                edited.current.add('feeAtomic');
                setFeeAmount(event.target.value);
                setFeedback({ state: 'idle' });
              }}
            />
          </Field>
          <Notice>
            No StellarKey backend is involved. {draft.transport === 'waku'
              ? 'The browser connects to public Waku light-push and filter peers; those operators'
              : 'The browser connects to two public Nostr relays; those operators'} can observe your IP address and connection timing. Helping
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
