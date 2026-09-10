/** Which carrier moves encrypted relay messages between a sender and a helper.
 * Both carry the same signed, padded, NIP-44 encrypted events; only the
 * third party that sees connection metadata differs. */
export type PrivateRelayTransportKind = 'nostr' | 'waku';

export type PrivateRelayNetwork =
  | { transport: 'nostr'; relayUrls: readonly string[] }
  /** Empty `peers` means the public network bootstrap; otherwise only these service nodes are dialled. */
  | { transport: 'waku'; peers: readonly string[]; clusterId: number };

export const PRIVATE_RELAY_TRANSPORT_KINDS: readonly PrivateRelayTransportKind[] = ['nostr', 'waku'];
/** The Waku Network's cluster; self-hosted service nodes may run another. */
export const WAKU_DEFAULT_CLUSTER_ID = 1;
export const WAKU_MAX_PEERS = 4;

export function isPrivateRelayTransportKind(value: unknown): value is PrivateRelayTransportKind {
  return value === 'nostr' || value === 'waku';
}

const multiaddr = /^\/(?:dns4|dns6|dns|ip4|ip6)\/([A-Za-z0-9.:_-]{1,253})\/tcp\/(\d{1,5})\/(wss|ws)\/p2p\/([1-9A-HJ-NP-Za-km-z]{40,70})$/u;

/** Browser-dialable service node addresses: secure websockets, or plain ws on a loopback host. */
export function validateWakuPeerAddresses(peers: readonly string[]): string[] {
  if (!Array.isArray(peers) || peers.length > WAKU_MAX_PEERS) throw new Error('Waku peer addresses are invalid');
  const result: string[] = [];
  for (const raw of peers) {
    if (typeof raw !== 'string') throw new Error('Waku peer address is invalid');
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    const match = multiaddr.exec(trimmed);
    if (!match) throw new Error('Waku peer address must be a /dns4 or /ip4 websocket multiaddr ending in /p2p/<peer id>');
    const [, host, port, scheme] = match;
    if (Number(port) < 1 || Number(port) > 65_535) throw new Error('Waku peer port is invalid');
    if (scheme === 'ws' && !['127.0.0.1', 'localhost', '::1'].includes(host!)) throw new Error('Waku peers must use wss unless on this device');
    if (!result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

export function validateWakuClusterId(value: unknown): number {
  if (typeof value === 'string' && /^\d{1,5}$/u.test(value.trim())) value = Number(value.trim());
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 65_535) throw new Error('Waku cluster must be a whole number between 0 and 65535');
  return value as number;
}

/** Resolves any accepted input to a Waku network: the wallet relays exclusively
 * over Waku. An explicit Nostr network or a legacy relay-URL list yields a Waku
 * network with no peers, which the UI treats as "no service node configured". */
export function privateRelayNetwork(
  input: PrivateRelayNetwork | readonly string[] | {
    transport?: PrivateRelayTransportKind; relayUrls?: readonly string[]; wakuPeers?: readonly string[]; wakuClusterId?: number;
  },
): PrivateRelayNetwork {
  if (Array.isArray(input)) return { transport: 'waku', peers: [], clusterId: WAKU_DEFAULT_CLUSTER_ID };
  const value = input as {
    peers?: readonly string[]; wakuPeers?: readonly string[]; clusterId?: number; wakuClusterId?: number;
  };
  return {
    transport: 'waku',
    peers: [...(value.peers ?? value.wakuPeers ?? [])],
    clusterId: value.clusterId ?? value.wakuClusterId ?? WAKU_DEFAULT_CLUSTER_ID,
  };
}

export interface PrivateRelayNetworkCopy {
  /** Short noun for the carriers, e.g. "public relays" or "Waku peers". */
  carriers: string;
  /** Sentence fragment naming who can see connection metadata. */
  observers: string;
  /** Status line for a helper session, e.g. "Connected to 2 of 2 public relays". */
  connection(connected: number, total: number): string;
}

export function describePrivateRelayNetwork(network: PrivateRelayNetwork | PrivateRelayTransportKind): PrivateRelayNetworkCopy {
  // Waku is the only carrier; a configured service node is described as the user's own.
  const own = typeof network !== 'string' && network.transport === 'waku' && network.peers.length > 0;
  return {
    carriers: own ? 'your Waku service node' : 'the Waku service node',
    observers: own
      ? 'The Waku service node you configured carries encrypted messages and can observe your IP address and timing.'
      : 'Your Waku service node carries encrypted messages and can observe your IP address and timing.',
    connection: (connected, total) => `Connected to ${connected} of ${total} Waku services`,
  };
}
