'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { PrivateRelayEntry } from '@/features/private-balance/components/PrivateRelayEntry';
import { PrivateRelayHelperManager } from '@/features/private-balance/components/PrivateRelayHelperManager';
import { loadPrivateRelayPreferences, savePrivateRelayPreferences } from '@/features/private-balance/relay/preferences';
import { getPrivateRelayHelperStatus, subscribePrivateRelayHelperStatus } from '@/features/private-balance/relay/helper-status';
import { WakuPrivateRelayAdapter, type WakuLightNode, type WakuSdk } from '@/features/private-balance/relay/waku';
import { initialPrivateBalanceRuntimeData, PrivateBalanceRuntimeControlProvider, PrivateBalanceRuntimeDataProvider, usePrivateBalanceRuntime } from '@/hooks/usePrivateBalanceRuntime';
import { shouldMountPrivateBalanceRuntime } from '@/lib/private-balance-bootstrap';

// The real controls, lazy intent gate, manager, session, messenger and adapter
// cooperate. Only SDK I/O is replaced. No usable account, chain, payment input
// or external request is created. Diagnostics are fixed labels/counts only.
interface AdapterIoBoundary {
  bootstrapPeers: readonly string[];
  loadSdk(): Promise<WakuSdk>;
  loadMuxers(): Promise<unknown[]>;
  node(): Promise<WakuLightNode>;
}

function WakuPanel() {
  const { requested } = usePrivateBalanceRuntime();
  const installed = useRef<HTMLParagraphElement>(null);
  const [creates, setCreates] = useState(0);
  const [stops, setStops] = useState(0);
  const [sdkCluster, setSdkCluster] = useState<number | null>(null);
  const [connectedPaints, setConnectedPaints] = useState(0);
  const [subscribes, setSubscribes] = useState(0);
  const [storeQueries, setStoreQueries] = useState(0);
  const live = useRef(false);
  const connected = useRef(true);
  const reportedCluster = useRef(3);
  const stallNext = useRef(false);
  const waiting = useRef(new Set<() => void>());

  useEffect(() => {
    // Substitute only SDK I/O after the production factory has constructed its
    // adapter. Messenger, transport factory and cluster propagation run intact.
    const prototype = WakuPrivateRelayAdapter.prototype as unknown as AdapterIoBoundary;
    const originalNode = prototype.node;
    const instrumented = new WeakSet<AdapterIoBoundary>();
    const waiters = waiting.current;
    let active = true;
    const unsubscribe = subscribePrivateRelayHelperStatus(() => {
      if (active && getPrivateRelayHelperStatus().phase === 'connected') setConnectedPaints(value => value + 1);
    });
    prototype.node = function () {
      if (!instrumented.has(this)) {
        instrumented.add(this);
        const network = { peers: this.bootstrapPeers };
        const realIO = live.current;
        if (!realIO) this.loadMuxers = async () => [];
        const sdkPromise = (async (): Promise<WakuSdk> => {
          const stalled = stallNext.current;
          stallNext.current = false;
          const realSdk = await import('@waku/sdk');
          const { utils } = realSdk;
          if (realIO) {
            // A unique, unused topic prevents querying or subscribing to wallet
            // traffic. Publishing is prohibited, including accidental requests.
            const topic = `/stellarkey-e2e/1/${crypto.randomUUID()}/json`;
            const sdk: WakuSdk = {
              utils, Protocols: realSdk.Protocols,
              createLightNode: async options => {
                const node = await realSdk.createLightNode({ ...options,
                  libp2p: { ...options.libp2p, hideWebSocketInfo: true },
                } as Parameters<typeof realSdk.createLightNode>[0]);
                if (active) { setCreates(value => value + 1); setSdkCluster(options.networkConfig?.clusterId ?? null); }
                return {
                  start: () => node.start(),
                  stop: async () => {
                    await node.stop();
                    if (active) setStops(value => value + 1);
                  },
                  waitForPeers: (protocols, timeout) => node.waitForPeers(protocols as Parameters<typeof node.waitForPeers>[0], timeout),
                  isConnected: () => node.isConnected(),
                  getConnectedPeers: () => node.getConnectedPeers(),
                  libp2p: node.libp2p,
                  peerManager: (node as unknown as WakuLightNode).peerManager,
                  createEncoder: () => { throw new Error('Live connection check cannot publish'); },
                  createDecoder: () => node.createDecoder({ contentTopic: topic }),
                  lightPush: { multicodec: node.lightPush.multicodec, send: async () => { throw new Error('Live connection check cannot publish'); } },
                  filter: {
                    multicodec: node.filter.multicodec,
                    subscribe: async decoder => {
                      const ok = await node.filter.subscribe(decoder as Parameters<typeof node.filter.subscribe>[0], () => {});
                      if (ok && active) setSubscribes(value => value + 1);
                      return ok;
                    },
                    unsubscribe: decoder => node.filter.unsubscribe(decoder as Parameters<typeof node.filter.unsubscribe>[0]),
                    unsubscribeAll: () => node.filter.unsubscribeAll(),
                  },
                  store: { queryWithOrderedCallback: async (decoders, _callback, options) => {
                    await node.store.queryWithOrderedCallback(decoders as Parameters<typeof node.store.queryWithOrderedCallback>[0], () => {}, options);
                    if (active) setStoreQueries(value => value + 1);
                  } },
                };
              },
            };
            return sdk;
          }
          const peers = () => network.peers.map(address => ({
            id: { toString: () => address.slice(address.lastIndexOf('/p2p/') + 5) },
            protocols: ['/vac/waku/lightpush/3.0.0', '/vac/waku/filter-subscribe/2.0.0-beta1'],
            metadata: new Map([['shardInfo', utils.encodeRelayShard({ clusterId: reportedCluster.current, shards: [0, 1, 2, 3, 4, 5, 6, 7] })]]),
          }));
          let stopped = false;
          const node: WakuLightNode = {
            start: async () => {},
            stop: async () => { if (stopped) return; stopped = true; if (active) setStops(value => value + 1); },
            waitForPeers: async () => { if (stalled) await new Promise<void>(resolve => waiters.add(resolve)); },
            createEncoder: params => params,
            createDecoder: params => params,
            isConnected: () => !stopped && connected.current,
            getConnectedPeers: async () => !stopped && connected.current ? peers() : [],
            libp2p: { stop: async () => {}, peerStore: { all: async () => peers() } },
            peerManager: { getPeers: async () => [], isPeerOnPubsub: async () => true },
            lightPush: { multicodec: '/vac/waku/lightpush/3.0.0', send: async () => { throw new Error('Synthetic fixture never publishes'); } },
            filter: {
              multicodec: '/vac/waku/filter-subscribe/2.0.0-beta1',
              subscribe: async () => { if (active) setSubscribes(value => value + 1); return true; },
              unsubscribe: async () => true,
            },
            store: { queryWithOrderedCallback: async () => {} },
          };
          const sdk: WakuSdk = {
            utils: { decodeRelayShard: utils.decodeRelayShard },
            Protocols: { LightPush: 'lightpush', Filter: 'filter' },
            createLightNode: async options => {
              if (active) { setCreates(value => value + 1); setSdkCluster(options.networkConfig?.clusterId ?? null); }
              return node;
            },
          };
          return sdk;
        })();
        this.loadSdk = () => sdkPromise;
      }
      return originalNode.call(this);
    };
    if (installed.current) installed.current.textContent = 'true';
    return () => {
      active = false;
      prototype.node = originalNode;
      unsubscribe();
      for (const resolve of waiters) resolve();
      waiters.clear();
    };
  }, []);

  const runtime = useMemo(() => ({ ...initialPrivateBalanceRuntimeData,
    phase: requested ? 'current' as const : 'disabled' as const,
    publicAddress: 'synthetic-not-an-account',
    deployment: { ...initialPrivateBalanceRuntimeData.deployment, networkId: 'synthetic-network', poolContractId: 'synthetic-pool' },
  }), [requested]);
  const mounted = shouldMountPrivateBalanceRuntime({ accountReady: true, deploymentReady: true, encryptedStateExists: true, requested });

  return <PrivateBalanceRuntimeDataProvider value={runtime}>
    <PrivateRelayEntry />
    <p ref={installed} data-testid="waku-fixture-ready">false</p>
    <p data-testid="waku-requested">{String(requested)}</p>
    <p data-testid="waku-creates">{creates}</p>
    <p data-testid="waku-stops">{stops}</p>
    <p data-testid="waku-sdk-cluster">{sdkCluster ?? 'none'}</p>
    <p data-testid="waku-connected-paints">{connectedPaints}</p>
    <p data-testid="waku-subscriptions">{subscribes}</p>
    <p data-testid="waku-store-queries">{storeQueries}</p>
    <Button onClick={() => { live.current = true; }}>Use real local Waku nodes</Button>
    <Button onClick={() => { connected.current = false; }}>Drop synthetic Waku connections</Button>
    <Button onClick={() => { connected.current = true; }}>Recover synthetic Waku connections</Button>
    <Button onClick={() => { reportedCluster.current = 1; }}>Change synthetic node cluster</Button>
    <Button onClick={() => { stallNext.current = true; }}>Delay next Waku handshake</Button>
    <Button onClick={() => { for (const resolve of waiting.current) resolve(); waiting.current.clear(); }}>Release old Waku handshakes</Button>
    <Button onClick={() => savePrivateRelayPreferences({ ...loadPrivateRelayPreferences(), useRelay: true })}>Change Waku sender preference only</Button>
    {mounted ? <PrivateRelayHelperManager /> : null}
  </PrivateBalanceRuntimeDataProvider>;
}

export function RelayWakuFixture() {
  const [scope, setScope] = useState(0);
  return <main data-app-surface className="min-h-screen p-6">
    <h1>Waku connection checks</h1>
    <Button onClick={() => setScope(value => value + 1)}>Fresh Waku unlock</Button>
    <PrivateBalanceRuntimeControlProvider scopeKey={`synthetic-waku-${scope}`}>
      <WakuPanel key={scope} />
    </PrivateBalanceRuntimeControlProvider>
  </main>;
}
