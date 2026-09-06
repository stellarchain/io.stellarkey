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
  relayUrls: string[];
  feeAtomic: string;
}

/** The helper does not consume the sender's useRelay setting. Retain its
 * effect identity on no-op reloads without suppressing real policy changes. */
export function retainPrivateRelayHelperPreferences(
  current: PrivateRelayPreferences,
  next: PrivateRelayPreferences,
): PrivateRelayPreferences {
  return current.helpRelay === next.helpRelay && current.feeAtomic === next.feeAtomic &&
    current.relayUrls.length === next.relayUrls.length &&
    current.relayUrls.every((url, index) => url === next.relayUrls[index])
    ? current : next;
}

export const DEFAULT_PRIVATE_RELAY_PREFERENCES: PrivateRelayPreferences = {
  useRelay: false,
  helpRelay: false,
  relayUrls: [...DEFAULT_PRIVATE_RELAY_URLS],
  feeAtomic: '10000',
};

function validate(raw: unknown): PrivateRelayPreferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_PRIVATE_RELAY_PREFERENCES, relayUrls: [...DEFAULT_PRIVATE_RELAY_URLS] };
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
  return {
    useRelay: value.useRelay === true,
    helpRelay: value.helpRelay === true,
    relayUrls,
    feeAtomic,
  };
}

export function loadPrivateRelayPreferences(): PrivateRelayPreferences {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_PRIVATE_RELAY_PREFERENCES, relayUrls: [...DEFAULT_PRIVATE_RELAY_URLS] };
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
  const validated: PrivateRelayPreferences = {
    useRelay: input.useRelay === true,
    helpRelay: input.helpRelay === true,
    relayUrls,
    feeAtomic: input.feeAtomic,
  };
  if (typeof window === 'undefined') return validated;
  window.localStorage.setItem(PRIVATE_RELAY_PREFERENCES_STORAGE_KEY, JSON.stringify(validated));
  window.dispatchEvent(new CustomEvent(PRIVATE_RELAY_PREFERENCES_EVENT, { detail: validated }));
  return validated;
}
