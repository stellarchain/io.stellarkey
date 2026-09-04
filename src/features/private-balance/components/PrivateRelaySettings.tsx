'use client';

import { useState } from 'react';
import { Button, Field, Notice, Toggle } from '@/components/ui';
import {
  loadPrivateRelayPreferences,
  savePrivateRelayPreferences,
  type PrivateRelayPreferences,
} from '../relay/preferences';

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
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-500">{description}</p>
      </div>
      <Toggle checked={checked} onChange={value => onChange(Boolean(value))} label={label} />
    </div>
  );
}

export function PrivateRelaySettings() {
  const [draft, setDraft] = useState<PrivateRelayPreferences>(loadPrivateRelayPreferences);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = <Key extends keyof PrivateRelayPreferences>(
    key: Key,
    value: PrivateRelayPreferences[Key],
  ) => {
    setDraft(current => ({ ...current, [key]: value }));
    setResult(null);
    setError(null);
  };

  const updateRelay = (index: number, value: string) => {
    const relayUrls = [...draft.relayUrls];
    relayUrls[index] = value;
    update('relayUrls', relayUrls);
  };

  const save = () => {
    setResult(null);
    setError(null);
    try {
      const saved = savePrivateRelayPreferences(draft);
      setDraft(saved);
      setResult('Relay settings saved on this device.');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Relay settings are invalid.');
    }
  };

  return (
    <section aria-labelledby="private-relay-settings-title" className="space-y-2">
      <h3 id="private-relay-settings-title" className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
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
            description="Offer this wallet as a peer while Private Payments is open."
            checked={draft.helpRelay}
            label="Help relay private payments from other wallets"
            onChange={value => update('helpRelay', value)}
          />
        </div>
        <div className="space-y-3 border-t border-white/[0.07] px-4 py-4">
          <Field label="Public relay 1">
            <input
              className="input font-mono text-base sm:text-[12px]"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={draft.relayUrls[0] ?? ''}
              onChange={event => updateRelay(0, event.target.value)}
            />
          </Field>
          <Field label="Public relay 2">
            <input
              className="input font-mono text-base sm:text-[12px]"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={draft.relayUrls[1] ?? ''}
              onChange={event => updateRelay(1, event.target.value)}
            />
          </Field>
          <Field label="Private fee (atomic units)" hint="Paid in the transferred asset">
            <input
              className="input font-mono text-base sm:text-[13px]"
              inputMode="numeric"
              pattern="[1-9][0-9]*"
              value={draft.feeAtomic}
              onChange={event => update('feeAtomic', event.target.value)}
            />
          </Field>
          <Notice>
            No StellarKey backend is involved. The browser connects to two public Nostr relays;
            those operators can observe your IP address and connection timing. Helping never signs
            automatically: every exact transaction still requires your approval.
          </Notice>
          {error ? <p role="alert" className="text-[12px] text-[#FF6961]">{error}</p> : null}
          {result ? <p role="status" className="text-[12px] text-[#30D158]">{result}</p> : null}
          <Button type="button" className="w-full" onClick={save}>
            Save relay settings
          </Button>
        </div>
      </div>
    </section>
  );
}
