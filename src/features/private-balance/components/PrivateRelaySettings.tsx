'use client';

import { useState } from 'react';
import { Button, Field, Notice, Toggle } from '@/components/ui';
import {
  loadPrivateRelayPreferences,
  savePrivateRelayPreferences,
  type PrivateRelayPreferences,
} from '../relay/preferences';
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
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-500">{description}</p>
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
  const [draft, setDraft] = useState<PrivateRelayPreferences>(loadPrivateRelayPreferences);
  const [feeAmount, setFeeAmount] = useState(() => feeForInput(draft.feeAtomic));
  const [error, setError] = useState<string | null>(null);

  const update = <Key extends keyof PrivateRelayPreferences>(
    key: Key,
    value: PrivateRelayPreferences[Key],
  ) => {
    setDraft(current => ({ ...current, [key]: value }));
    setError(null);
  };

  const updateRelay = (index: number, value: string) => {
    const relayUrls = [...draft.relayUrls];
    relayUrls[index] = value;
    update('relayUrls', relayUrls);
  };

  const save = () => {
    setError(null);
    try {
      const saved = savePrivateRelayPreferences({
        ...draft,
        feeAtomic: parsePrivateAmount(feeAmount, 7).toString(),
      });
      setDraft(saved);
      setFeeAmount(feeForInput(saved.feeAtomic));
      onSaved?.();
    } catch (cause: unknown) {
      setError(cause instanceof Error
        ? cause.message.replace(/^Private amount/u, 'Private fee')
        : 'Relay settings are invalid.');
    }
  };

  return (
    <section aria-labelledby="private-relay-settings-title" className="space-y-2">
      <h3 id="private-relay-settings-title" className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
        Peer relay
      </h3>
      <div className="ios-group overflow-hidden">
        {!helperOnly ? (
          <RelayToggleRow
            title="Prefer privacy relay"
            description="Preselect a peer wallet for new private sends and withdrawals."
            checked={draft.useRelay}
            label="Prefer privacy relay for new private payments"
            onChange={value => update('useRelay', value)}
          />
        ) : null}
        <div className={helperOnly ? '' : 'border-t border-white/[0.07]'}>
          <RelayToggleRow
            title="Help relay private payments"
            description="Offer this wallet as a peer while StellarKey is open and unlocked."
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
          <Field
            label="Private fee"
            hint="0.001 means 0.001 XLM for XLM, or 0.001 USDC for USDC."
          >
            <input
              className="input font-mono text-base sm:text-[13px]"
              inputMode="decimal"
              value={feeAmount}
              onChange={event => {
                setFeeAmount(event.target.value);
                setError(null);
              }}
            />
          </Field>
          <Notice>
            No StellarKey backend is involved. The browser connects to two public Nostr relays;
            those operators can observe your IP address and connection timing. Helping never signs
            automatically: every exact transaction still requires your approval.
          </Notice>
          {error ? <p role="alert" className="text-[12px] text-[#FF6961]">{error}</p> : null}
          <Button type="button" className="w-full" onClick={save}>
            Save relay settings
          </Button>
        </div>
      </div>
    </section>
  );
}
