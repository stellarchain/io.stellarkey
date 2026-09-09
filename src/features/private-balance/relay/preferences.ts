import {
  WAKU_DEFAULT_CLUSTER_ID,
  isPrivateRelayTransportKind,
  validateWakuClusterId,
  validateWakuPeerAddresses,
  type PrivateRelayTransportKind,
} from './network';
import { validatePrivateRelayUrls } from './transport';

export const PRIVATE_RELAY_PREFERENCES_STORAGE_KEY = 'stellarkey.private-relay.preferences.v1';
export const PRIVATE_RELAY_PREFERENCES_EVENT = 'stellarkey:private-relay-preferences';
export const DEFAULT_PRIVATE_RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
] as const;

export interface PrivateRelayPreferences {
  useRelay: boolean;
  helpRelay: boolean;
  /** Which carrier moves relay messages; relayUrls apply to Nostr only. */
  transport: PrivateRelayTransportKind;
  relayUrls: string[];
  /** Waku only: service node multiaddrs to dial instead of the public bootstrap (empty = public). */
  wakuPeers: string[];
  /** Waku only: the cluster those nodes serve (1 = The Waku Network). */
  wakuClusterId: number;
  feeAtomic: string;
}

/** The helper does not consume the sender's useRelay setting. Retain its
 * effect identity on no-op reloads without suppressing real policy changes. */
export function retainPrivateRelayHelperPreferences(
  current: PrivateRelayPreferences,
  next: PrivateRelayPreferences,
): PrivateRelayPreferences {
  return current.helpRelay === next.helpRelay && current.feeAtomic === next.feeAtomic &&
    current.transport === next.transport && current.wakuClusterId === next.wakuClusterId &&
    (current.wakuPeers ?? []).join('\n') === (next.wakuPeers ?? []).join('\n') &&
    current.relayUrls.length === next.relayUrls.length &&
    current.relayUrls.every((url, index) => url === next.relayUrls[index])
    ? current : next;
}

export const DEFAULT_PRIVATE_RELAY_PREFERENCES: PrivateRelayPreferences = {
  useRelay: false,
  helpRelay: false,
  transport: 'nostr',
  relayUrls: [...DEFAULT_PRIVATE_RELAY_URLS],
  wakuPeers: [],
  wakuClusterId: WAKU_DEFAULT_CLUSTER_ID,
  feeAtomic: '10000',
};

function validate(raw: unknown): PrivateRelayPreferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_PRIVATE_RELAY_PREFERENCES, relayUrls: [...DEFAULT_PRIVATE_RELAY_URLS], wakuPeers: [] };
  }
  const value = raw as Record<string, unknown>;
  const feeAtomic = typeof value.feeAtomic === 'string' && /^(?:[1-9][0-9]{0,20})$/u.test(value.feeAtomic)
    ? value.feeAtomic
    : DEFAULT_PRIVATE_RELAY_PREFERENCES.feeAtomic;
  let relayUrls: string[] = [...DEFAULT_PRIVATE_RELAY_URLS];
  if (Array.isArray(value.relayUrls) && value.relayUrls.every(url => typeof url === 'string')) {
    try {
      relayUrls = validatePrivateRelayUrls(value.relayUrls);
    } catch {
      // Invalid persisted network input never enables a socket.
    }
  }
  let wakuPeers: string[] = [];
  try { if (Array.isArray(value.wakuPeers)) wakuPeers = validateWakuPeerAddresses(value.wakuPeers as string[]); } catch { /* Invalid persisted peers never dial. */ }
  let wakuClusterId = WAKU_DEFAULT_CLUSTER_ID;
  try { if (value.wakuClusterId !== undefined) wakuClusterId = validateWakuClusterId(value.wakuClusterId); } catch { /* Fall back to the public cluster. */ }
  return {
    useRelay: value.useRelay === true,
    helpRelay: value.helpRelay === true,
    transport: isPrivateRelayTransportKind(value.transport) ? value.transport : 'nostr',
    relayUrls,
    wakuPeers,
    wakuClusterId,
    feeAtomic,
  };
}

export function loadPrivateRelayPreferences(): PrivateRelayPreferences {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_PRIVATE_RELAY_PREFERENCES, relayUrls: [...DEFAULT_PRIVATE_RELAY_URLS], wakuPeers: [] };
  }
  try {
    const raw = window.localStorage.getItem(PRIVATE_RELAY_PREFERENCES_STORAGE_KEY);
    return raw ? validate(JSON.parse(raw)) : validate(null);
  } catch {
    return validate(null);
  }
}

export function savePrivateRelayPreferences(input: PrivateRelayPreferences): PrivateRelayPreferences {
  if (!/^(?:[1-9][0-9]{0,20})$/u.test(input.feeAtomic)) {
    throw new Error('Private relay fee must be a positive whole number of atomic units.');
  }
  const relayUrls = validatePrivateRelayUrls(input.relayUrls);
  if (!isPrivateRelayTransportKind(input.transport)) throw new Error('Private relay transport is not supported.');
  const validated: PrivateRelayPreferences = {
    useRelay: input.useRelay === true,
    helpRelay: input.helpRelay === true,
    transport: input.transport,
    relayUrls,
    wakuPeers: validateWakuPeerAddresses(input.wakuPeers ?? []),
    wakuClusterId: validateWakuClusterId(input.wakuClusterId ?? WAKU_DEFAULT_CLUSTER_ID),
    feeAtomic: input.feeAtomic,
  };
  if (typeof window === 'undefined') return validated;
  window.localStorage.setItem(PRIVATE_RELAY_PREFERENCES_STORAGE_KEY, JSON.stringify(validated));
  window.dispatchEvent(new CustomEvent(PRIVATE_RELAY_PREFERENCES_EVENT, { detail: validated }));
  return validated;
}
