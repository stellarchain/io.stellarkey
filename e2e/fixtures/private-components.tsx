'use client';

// Synthetic component fixture only. The runner temporarily mounts this file;
// no fixture route is present in normal development or production builds.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, ModalHeader, Tabs } from '@/components/ui';
import { WalletProvider, useWallet } from '@/hooks/useWallet';
import { ToastProvider } from '@/components/Toast';
import { initialPrivateBalanceRuntimeData, PrivateBalanceRuntimeDataProvider, usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { PrivateOutgoingHistorySettings } from '@/features/private-balance/components/PrivateOutgoingHistorySettings';
import { PrivateActionReview } from '@/features/private-balance/components/PrivateActionReview';
import type { PrivateOutgoingHistoryMode } from '@/features/private-balance/runtime/outgoing-history';
import type { PrivateChainedSendApproval } from '@/features/private-balance/runtime/chained-send';
import { disclosePrivateProof, PrivateProofConsent, type PrivateProofDisclosure } from '@/features/private-balance/runtime/proof-disclosure';
import { UxPrimitivesFixture } from '../../../e2e/fixtures/ux-primitives';
import { QrFreshnessFixture } from '../../../e2e/fixtures/qr-freshness';
import { DirectPrivateFixture } from '../../../e2e/fixtures/private-direct-panel';
import { MerchantLifetimeFixture } from '../../../e2e/fixtures/merchant-lifetime-panel';
import { ModalOwnershipFixture } from '../../../e2e/fixtures/modal-ownership-panel';
import { MerchantFeedbackFixture } from '../../../e2e/fixtures/merchant-feedback-panel';
import { SigningContextFixture } from '../../../e2e/fixtures/signing-context-panel';
import { PrivateRecoveryFixture } from '../../../e2e/fixtures/private-recovery-panel';
import { IndexedDbEncryptedRecordDriver } from '@/lib/indexed-db';
import { clearPrivateBalanceCommitmentCache, loadPrivateBalanceCommitments, recordVerifiedPrivateBalanceCommitments } from '@/features/private-balance/runtime/public-cache';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { PrivateBalanceProvider } from '@/features/private-balance/runtime/provider';
import { HorizonStealthAnnouncementReader } from '@/features/private-balance/runtime/stealth-horizon';
import { PrivateBalanceArchiveClient } from '@/features/private-balance/runtime/archive-client';
import { PrivateBalanceWorkerClient } from '@/features/private-balance/worker/client';
import { computeContextHash, computeContextField, computeGenesisRecordHash, createEmptyTree, derivePrivateAddressDeploymentTag, encodePrivateAddress } from '@stellarkey/private-balance';
import type { StealthAnnouncementPage } from '@/features/private-balance/runtime/stealth-sync';
import type { AccountMeta, NetworkKey } from '@/lib/types';
import type { PrivateBalanceManifest } from '@/lib/private-balance-manifest';
import { privateBalanceSensitivePrefix } from '@/lib/private-balance-bootstrap';
import { forceClaimPrivateBalanceLease, privateBalanceLeaseKey } from '@/features/private-balance/runtime/coordination';
import { stealthDiscoveryRecordKey } from '@/features/private-balance/runtime/stealth-cache';
import { lockVault, unlockVault, withPrivacySessionRoot } from '@/lib/vault';
import { commitPrivateBalanceState, createEmptyPrivateBalanceState, loadPrivateBalanceState } from '@/features/private-balance/runtime/storage';
import developmentManifest from '../../../protocol/private-balance/manifests/development.json';

const discoveryPassword = 'synthetic discovery correct horse battery staple';
const discoveryAsset = { ...developmentManifest.assets[0], kind: 'native' as const, status: 'active' as const };
const discoveryDeployment = { ...initialPrivateBalanceRuntimeData.deployment };
const discoveryRegistry = [{ index: 0, contractId: discoveryAsset.contractId }];
const discoveryPage: StealthAnnouncementPage = { announcements: [], nextCursor: '1', latestLedger: 1, hasMore: false };

function DiscoveryProviderControls() {
  const runtime = usePrivateBalanceRuntimeData();
  const captured = useRef({ refresh: runtime.refreshStealth, remove: runtime.disableLocalData });
  const [removal, setRemoval] = useState('idle');
  const [settled, setSettled] = useState(0);
  const [shieldedSettled, setShieldedSettled] = useState(0);
  const addressPublications = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // Observe committed publications without storing or rendering their values.
    const counter = addressPublications.current;
    if (runtime.privateAddress && counter) counter.textContent = String(Number(counter.textContent) + 1);
  }, [runtime.privateAddress]);
  return <>
    <Button onClick={() => { void runtime.refreshSync().catch(() => {}).finally(() => setShieldedSettled(value => value + 1)); }}>Start synthetic shielded sync</Button>
    <Button onClick={() => { void runtime.refreshStealth().catch(() => {}).finally(() => setSettled(value => value + 1)); }}>Start discovery scan</Button>
    <Button onClick={() => { void captured.current.refresh().catch(() => {}).finally(() => setSettled(value => value + 1)); }}>Start captured discovery scan</Button>
    <Button onClick={() => { setRemoval('waiting'); void captured.current.remove('REMOVE PRIVATE BALANCE')
      .then(() => setRemoval('removed'), () => setRemoval('refused')); }}>Remove captured discovery data</Button>
    <Button onClick={() => { setRemoval('waiting'); void runtime.disableLocalData('REMOVE PRIVATE BALANCE')
      .then(() => setRemoval('removed'), () => setRemoval('refused')); }}>Remove synthetic discovery data</Button>
    <p data-testid="discovery-leader">{String(runtime.isLeader)}</p>
    <p data-testid="discovery-identity">{runtime.stealthMetaAddress ? 'present' : 'cleared'}</p>
    <p data-testid="discovery-syncing">{String(runtime.stealthSyncing)}</p>
    <p data-testid="discovery-error">{runtime.stealthError ? 'error' : 'none'}</p>
    <p data-testid="discovery-settled">{settled}</p>
    <p data-testid="discovery-removal">{removal}</p>
    <p data-testid="discovery-shielded-settled">{shieldedSettled}</p>
    <p data-testid="discovery-shielded-address">{runtime.privateAddress ? 'present' : 'cleared'}</p>
    <p data-testid="discovery-shielded-error">{runtime.error ? 'error' : 'none'}</p>
    <p ref={addressPublications} data-testid="discovery-address-publications">0</p>
  </>;
}

function DiscoveryProviderChecks() {
  const wallet = useWallet();
  const [account, setAccount] = useState<AccountMeta | null>(null);
  const [mounted, setMounted] = useState(true);
  const [network, setNetwork] = useState<NetworkKey>('testnet');
  const [binding, setBinding] = useState(developmentManifest.deploymentBindingHash);
  const [reads, setReads] = useState(0);
  const [aborts, setAborts] = useState(0);
  const [stored, setStored] = useState('unchecked');
  const [seeded, setSeeded] = useState('idle');
  const [directVault, setDirectVault] = useState('idle');
  const [shieldedStage, setShieldedStage] = useState('idle');
  const [addressStored, setAddressStored] = useState('unchecked');
  const shieldedGate = useRef<{ mode: 'off' | 'init' | 'prefix' | 'address-cas'; armed: boolean; release: (() => void) | null }>({ mode: 'off', armed: false, release: null });
  const pending = useRef<Array<{ resolve(page: StealthAnnouncementPage): void; reject(error: Error): void }>>([]);
  useEffect(() => {
    const original = HorizonStealthAnnouncementReader.prototype.readPage;
    const waiting = pending.current;
    HorizonStealthAnnouncementReader.prototype.readPage = function (input) {
      setReads(value => value + 1);
      const abort = () => setAborts(value => value + 1);
      input.signal?.addEventListener('abort', abort, { once: true });
      return new Promise<StealthAnnouncementPage>((resolve, reject) => {
        waiting.push({
          resolve: page => { input.signal?.removeEventListener('abort', abort); resolve(page); },
          reject: error => { input.signal?.removeEventListener('abort', abort); reject(error); },
        });
      }); // Intentionally ignores cancellation until the controlled delivery.
    };
    return () => {
      HorizonStealthAnnouncementReader.prototype.readPage = original;
      for (const waiter of waiting) waiter.resolve(discoveryPage);
      waiting.length = 0;
    };
  }, []);
  useEffect(() => {
    // Only the explicit shielded-race controls enable these transport/worker
    // doubles. Vault, storage, sync-machine and provider ownership stay real.
    const gate = shieldedGate.current;
    const archive = PrivateBalanceArchiveClient.prototype;
    const originals = { readDepositsPaused: archive.readDepositsPaused, readNetworkPassphrase: archive.readNetworkPassphrase,
      readOldestLedgerSequence: archive.readOldestLedgerSequence, readLatestLedgerSequence: archive.readLatestLedgerSequence,
      readLedgerIdentity: archive.readLedgerIdentity, readHead: archive.readHead };
    const originalInit = PrivateBalanceWorkerClient.prototype.initSession;
    const originalPrefix = IndexedDbEncryptedRecordDriver.prototype.readPrefix;
    const originalCompare = IndexedDbEncryptedRecordDriver.prototype.compareAndSet;
    const originalFetch = window.fetch;
    const decode = (value: string) => Uint8Array.from(value.match(/../g)!, byte => Number.parseInt(byte, 16));
    const marker = () => new Uint8Array(32).fill(1);
    const contextHash = computeContextHash(2, decode(developmentManifest.networkId), decode(developmentManifest.realmId), new Uint8Array(StrKey.decodeContract(developmentManifest.poolContractId)));
    const pause = async (stage: 'init' | 'prefix' | 'address-cas') => {
      if (!gate.armed || gate.mode !== stage) return;
      gate.armed = false;
      setShieldedStage(stage);
      await new Promise<void>(resolve => { gate.release = resolve; });
      setShieldedStage('released');
    };
    window.fetch = async (resource, init) => {
      if (gate.mode !== 'off' && init?.method === 'POST' && typeof init.body === 'string') {
        const request = JSON.parse(init.body) as { method?: string; id?: number };
        if (request.method === 'getNetwork') return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id,
          result: { passphrase: developmentManifest.networkPassphrase, protocolVersion: 25 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(resource, init);
    };
    archive.readDepositsPaused = async function () { return gate.mode === 'off' ? originals.readDepositsPaused.call(this) : false; };
    archive.readNetworkPassphrase = async function () { return gate.mode === 'off' ? originals.readNetworkPassphrase.call(this) : developmentManifest.networkPassphrase; };
    archive.readOldestLedgerSequence = async function () { return gate.mode === 'off' ? originals.readOldestLedgerSequence.call(this) : 0; };
    archive.readLatestLedgerSequence = async function () { return gate.mode === 'off' ? originals.readLatestLedgerSequence.call(this) : 1; };
    archive.readLedgerIdentity = async function (sequence) { return gate.mode === 'off' ? originals.readLedgerIdentity.call(this, sequence)
      : { sequence, hash: developmentManifest.deploymentCheckpoint.hash }; };
    archive.readHead = async function () {
      if (gate.mode === 'off') return originals.readHead.call(this);
      return { latestLedger: 1, config: { protocolVersion: 2, networkId: decode(developmentManifest.networkId),
        realmId: decode(developmentManifest.realmId), guardian: developmentManifest.guardianAddress,
        initialAssetAdmin: developmentManifest.assetAdminAddress, poseidon2ParameterHash: marker(), circuitHash: marker(),
        verificationKeyHash: marker(), treeDepth: 17, rootWindowLedgers: 1440,
        deploymentBindingHash: decode(developmentManifest.deploymentBindingHash), contextHash, contextField: computeContextField(contextHash) },
      meta: { actionCount: 0n, transcriptHead: computeGenesisRecordHash(contextHash, decode(developmentManifest.deploymentBindingHash)) },
      tree: await createEmptyTree() };
    };
    PrivateBalanceWorkerClient.prototype.initSession = async function (...args) {
      if (gate.mode === 'off') return originalInit.apply(this, args);
      const address = encodePrivateAddress({ deploymentTag: derivePrivateAddressDeploymentTag(decode(args[0].deploymentBindingHash)),
        diversifier: Uint8Array.of(0, 0, 0, 1), ownerCommitment: marker(), hpkePublicKey: new Uint8Array(32).fill(2) }, 'tskpay_');
      await pause('init');
      return { ownerCommitmentHex: '01'.repeat(32), address };
    };
    IndexedDbEncryptedRecordDriver.prototype.readPrefix = async function (prefix) {
      const result = await originalPrefix.call(this, prefix);
      if (prefix.startsWith('private:sensitive:v1:')) await pause('prefix');
      return result;
    };
    IndexedDbEncryptedRecordDriver.prototype.compareAndSet = async function (...args) {
      const result = await originalCompare.apply(this, args);
      if (result.ok && args[0].startsWith('private:sensitive:v1:')) await pause('address-cas');
      return result;
    };
    return () => {
      gate.release?.();
      Object.assign(archive, originals);
      PrivateBalanceWorkerClient.prototype.initSession = originalInit;
      IndexedDbEncryptedRecordDriver.prototype.readPrefix = originalPrefix;
      IndexedDbEncryptedRecordDriver.prototype.compareAndSet = originalCompare;
      window.fetch = originalFetch;
    };
  }, []);
  const manifest = useMemo(() => ({ ...developmentManifest, deploymentBindingHash: binding }) as PrivateBalanceManifest, [binding]);
  const scope = useMemo(() => ({ networkId: manifest.networkId, realmId: manifest.realmId,
    poolId: Array.from(StrKey.decodeContract(manifest.poolContractId), byte => byte.toString(16).padStart(2, '0')).join(''),
    accountId: account?.id ?? 'synthetic-pending', deploymentBindingHash: binding,
  }), [account?.id, binding, manifest]);
  return <main data-app-surface className="min-h-screen p-6">
    <h1>Synthetic discovery lifecycle checks</h1>
    <Button onClick={() => { void wallet.createWallet(discoveryPassword, { secret: Keypair.random().secret() })
      .then(result => { setAccount(result.account); wallet.completeSetup(); }); }}>Prepare discovery runtime</Button>
    <Button onClick={() => wallet.lock()}>Lock discovery wallet</Button>
    <Button onClick={() => { void wallet.unlock(discoveryPassword); }}>Unlock discovery wallet</Button>
    <Button onClick={() => { lockVault(); setDirectVault('locked'); }}>Revoke vault without phase update</Button>
    <Button onClick={() => { void unlockVault(discoveryPassword).then(() => setDirectVault('unlocked')); }}>Replace vault session without phase update</Button>
    {(['init', 'prefix', 'address-cas'] as const).map(stage => <Button key={stage} onClick={() => {
      shieldedGate.current.mode = stage; shieldedGate.current.armed = true; setShieldedStage('armed');
    }}>Pause synthetic shielded {stage}</Button>)}
    <Button onClick={() => { shieldedGate.current.release?.(); shieldedGate.current.release = null; }}>Release old shielded response</Button>
    <Button onClick={() => { void wallet.addAccount({ secret: Keypair.random().secret() }).then(setAccount); }}>Replace discovery account</Button>
    <Button onClick={() => setNetwork(value => value === 'testnet' ? 'mainnet' : 'testnet')}>Replace discovery network</Button>
    <Button onClick={() => setBinding(value => value === '04'.repeat(32) ? developmentManifest.deploymentBindingHash : '04'.repeat(32))}>Replace discovery deployment</Button>
    <Button onClick={() => setMounted(value => !value)}>Toggle discovery provider</Button>
    <Button onClick={() => {
      forceClaimPrivateBalanceLease(localStorage, privateBalanceLeaseKey(scope), 'synthetic-other-owner', Date.now(), 60_000);
      window.dispatchEvent(new StorageEvent('storage', { key: privateBalanceLeaseKey(scope) }));
    }}>Take discovery lease elsewhere</Button>
    <Button onClick={() => forceClaimPrivateBalanceLease(localStorage, privateBalanceLeaseKey(scope), 'synthetic-other-owner', Date.now(), 60_000)}>
      Take discovery lease silently</Button>
    {(['proof', 'build', 'empty'] as const).map(kind => <Button key={kind} onClick={() => {
      if (!account) return;
      setSeeded('waiting');
      void withPrivacySessionRoot(account.id, manifest, async (_root, storageKey) => {
        const state = createEmptyPrivateBalanceState('01'.repeat(32));
        if (kind === 'build') state.buildReservations.push({ id: 'synthetic-build', kind: 'deposit', proofExposure: 'local', outgoingHistoryMode: 'recoverable',
          assetContractId: discoveryAsset.contractId, reservedNoteIds: [], createdAt: 1, updatedAt: 1 });
        else if (kind === 'proof') {
          state.notes.push({ id: '09'.repeat(32), commitment: '09'.repeat(32), value: '1', assetIndex: 0,
            assetContractId: discoveryAsset.contractId, diversifier: '00000000', ownerCommitment: '0a'.repeat(32),
            leafIndex: 0n, actionIndex: 0n, rho: '0b'.repeat(32), memoHex: '', senderFingerprintHex: '',
            status: 'reserved', reservedAt: 1, createdAt: 1 });
          state.pendingActions.push({ id: 'synthetic-proof', kind: 'transfer', assetIndex: 0, assetContractId: discoveryAsset.contractId,
          status: 'prepared', proofExposure: 'shared', submissionMode: 'direct', outgoingHistoryMode: 'recoverable', reservedNoteIds: ['09'.repeat(32)], actionField: '01'.repeat(32),
          nullifiers: ['02'.repeat(32), '03'.repeat(32)], outputCommitments: ['04'.repeat(32), '05'.repeat(32), '06'.repeat(32)],
          anchorRoot: '07'.repeat(32), anchorExpiresAtLedger: 1, proofHash: '08'.repeat(32), classicFeeCapStroops: '100',
          resourceFeeCapStroops: '100', broadcastAttempts: 0, createdAt: 1, updatedAt: 1 });
        }
        await commitPrivateBalanceState(scope, storageKey, state, null, new IndexedDbEncryptedRecordDriver());
      }).then(() => setSeeded('ready'), () => setSeeded('failed'));
    }}>Seed synthetic {kind} reservation</Button>)}
    <Button onClick={() => pending.current.shift()?.resolve(discoveryPage)}>Finish oldest discovery page</Button>
    <Button onClick={() => pending.current.shift()?.reject(new Error('Synthetic late transport failure'))}>Fail oldest discovery page</Button>
    <Button onClick={() => pending.current.pop()?.resolve(discoveryPage)}>Finish newest discovery page</Button>
    <Button onClick={() => {
      const driver = new IndexedDbEncryptedRecordDriver();
      void Promise.all([driver.read(stealthDiscoveryRecordKey(scope)), driver.readPrefix(privateBalanceSensitivePrefix(scope))])
        .then(([cache, state]) => setStored(cache === null && state.size === 0 ? 'absent' : 'present'));
    }}>Inspect synthetic discovery storage</Button>
    <Button onClick={() => {
      if (!account) return;
      void withPrivacySessionRoot(account.id, manifest, async (_root, storageKey) => {
        const state = await loadPrivateBalanceState(scope, storageKey, new IndexedDbEncryptedRecordDriver());
        setAddressStored(state?.privateAddress && state.issuedAddressDiversifiers.length === 1 &&
          state.issuedAddressDiversifiers[0] === '00000001' ? 'recorded' : 'missing');
      }).catch(() => setAddressStored('unavailable'));
    }}>Inspect synthetic address publication</Button>
    <p data-testid="discovery-reads">{reads}</p>
    <p data-testid="discovery-aborts">{aborts}</p>
    <p data-testid="discovery-stored">{stored}</p>
    <p data-testid="discovery-seeded">{seeded}</p>
    <p data-testid="discovery-wallet-phase">{wallet.phase}</p>
    <p data-testid="discovery-direct-vault">{directVault}</p>
    <p data-testid="discovery-shielded-stage">{shieldedStage}</p>
    <p data-testid="discovery-address-stored">{addressStored}</p>
    {account && mounted ? <PrivateBalanceProvider accountId={account.id} accountPublicKey={account.publicKey}
      accountCreatedAt={0} network={network} manifest={manifest} manifestHash={'01'.repeat(32)} storageScope={scope}
      encryptedStateExists={false} deployment={discoveryDeployment} asset={discoveryAsset} registryAssets={discoveryRegistry}
      runtimeKey="synthetic-runtime" portfolioKey="synthetic-portfolio" deploymentId="synthetic-deployment">
      <DiscoveryProviderControls />
    </PrivateBalanceProvider> : null}
  </main>;
}

async function checkDiscoveryWriteRevocation(mode: string): Promise<void> {
  const driver = new IndexedDbEncryptedRecordDriver();
  const controller = new AbortController();
  const key = `synthetic-discovery-check:${mode}`;
  const value = JSON.stringify({ revision: 0 });
  const originalOpen = IDBFactory.prototype.open;
  const originalGet = IDBObjectStore.prototype.get;
  const originalPut = IDBObjectStore.prototype.put;
  const originalTransaction = IDBDatabase.prototype.transaction;
  let releaseBlocker = () => {};
  let closeDatabase = () => {};
  try {
    if (mode === 'database-open') {
      IDBFactory.prototype.open = function (...args: Parameters<typeof originalOpen>) {
        const request = originalOpen.apply(this, args);
        request.addEventListener('success', () => controller.abort(), { once: true });
        return request;
      };
    } else {
      await driver.remove(key);
    }
    if (mode === 'record-read') {
      IDBObjectStore.prototype.get = function (query) {
        const request = originalGet.call(this, query);
        if (query === key) request.addEventListener('success', () => controller.abort(), { once: true });
        return request;
      };
    }
    if (mode === 'uncommitted-put') {
      IDBObjectStore.prototype.put = function (record, suppliedKey) {
        const request = originalPut.call(this, record, suppliedKey);
        if (record.key === key) request.addEventListener('success', () => controller.abort(), { once: true });
        return request;
      };
    }
    let queued: Promise<void> | null = null;
    if (mode === 'queued-write') {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('wallet.local.v1', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Synthetic database unavailable'));
      });
      closeDatabase = () => database.close();
      const blocker = database.transaction('encrypted-records', 'readwrite');
      const store = blocker.objectStore('encrypted-records');
      let blocking = true;
      releaseBlocker = () => { blocking = false; };
      const keepAlive = () => {
        const request = store.get('synthetic-blocker');
        request.onsuccess = () => { if (blocking) keepAlive(); };
      };
      keepAlive();
      queued = new Promise<void>(resolve => {
        IDBDatabase.prototype.transaction = function (...args: Parameters<typeof originalTransaction>) {
          const transaction = originalTransaction.apply(this, args);
          if (args[1] === 'readwrite') resolve();
          return transaction;
        };
      });
    }
    const compare = driver.compareAndSet.bind(driver) as (
      key: string, expected: number | null, value: string, guard: { signal: AbortSignal },
    ) => Promise<unknown>;
    const settled = compare(key, null, value, { signal: controller.signal }).then(
      () => 'committed', error => error instanceof Error ? error.name : 'unknown',
    );
    if (queued) {
      await queued;
      controller.abort();
      releaseBlocker();
    }
    const outcome = await settled;
    IDBObjectStore.prototype.get = originalGet;
    const retained = await driver.read(key);
    if (retained !== null || outcome !== 'AbortError') throw new Error('Cancelled discovery write was retained');
  } finally {
    releaseBlocker(); closeDatabase();
    IDBFactory.prototype.open = originalOpen;
    IDBObjectStore.prototype.get = originalGet;
    IDBObjectStore.prototype.put = originalPut;
    IDBDatabase.prototype.transaction = originalTransaction;
  }
}

async function checkDiscoveryRemovalRollback(): Promise<void> {
  const driver = new IndexedDbEncryptedRecordDriver();
  const controller = new AbortController();
  const stateKey = 'synthetic-removal:state';
  const cacheKey = 'synthetic-removal-cache';
  await driver.putManyVerified(new Map([[stateKey, 'synthetic-state'], [cacheKey, 'synthetic-cache']]));
  const originalDelete = IDBObjectStore.prototype.delete;
  try {
    IDBObjectStore.prototype.delete = function (query) {
      const request = originalDelete.call(this, query);
      if (query === cacheKey) request.addEventListener('success', () => controller.abort(), { once: true });
      return request;
    };
    const replace = driver.replacePrefixVerified.bind(driver) as (
      prefix: string, entries: Map<string, string>, remove: string[], guard: { signal: AbortSignal },
    ) => Promise<void>;
    const outcome = await replace('synthetic-removal:', new Map(), [cacheKey], { signal: controller.signal })
      .then(() => 'removed', error => error instanceof Error ? error.name : 'unknown');
    const [state, cache] = await Promise.all([driver.read(stateKey), driver.read(cacheKey)]);
    if (outcome !== 'AbortError' || state !== 'synthetic-state' || cache !== 'synthetic-cache') {
      throw new Error('Cancelled removal was not atomic');
    }
  } finally { IDBObjectStore.prototype.delete = originalDelete; }
}

function DiscoveryStorageChecks() {
  const [result, setResult] = useState('idle');
  return <>
    {['changed', 'expected-absent', 'matching', 'matching-absent', 'snapshot-copy', 'prefix-copy', 'readback-rollback', 'cache-integration'].map(mode => <Button key={mode}
      onClick={() => {
        setResult('running');
        void checkPublicCacheAtomicRange(mode).then(() => setResult('passed'), () => setResult('failed'));
      }}>Check public cache atomic range {mode}</Button>)}
    <Button onClick={() => { setResult('running'); void checkDiscoveryRemovalRollback()
      .then(() => setResult('passed'), () => setResult('failed')); }}>Check discovery removal rollback</Button>
    {['changed', 'expected-absent', 'matching', 'matching-absent'].map(mode => <Button key={mode}
      onClick={() => {
        setResult('running');
        void checkDiscoveryRemovalSnapshot(mode).then(() => setResult('passed'), () => setResult('failed'));
      }}>Check discovery removal snapshot {mode}</Button>)}
    {['database-open', 'record-read', 'queued-write', 'uncommitted-put'].map(mode => <Button key={mode}
      onClick={() => {
        setResult('running');
        void checkDiscoveryWriteRevocation(mode).then(() => setResult('passed'), () => setResult('failed'));
      }}>Check discovery {mode}</Button>)}
    <p data-testid="discovery-storage-result">{result}</p>
  </>;
}

async function checkPublicCacheAtomicRange(mode: string): Promise<void> {
  if (mode === 'cache-integration') return checkPublicCacheIntegration();
  const driver = new IndexedDbEncryptedRecordDriver();
  const writer = new IndexedDbEncryptedRecordDriver();
  const prefix = 'synthetic-public-range:';
  const checkpoint = `${prefix}checkpoint`;
  const leaf = `${prefix}leaf`;
  const retained = `${prefix}retained`;
  const old = '{"revision":0,"status":"synthetic-old"}';
  const next = '{"revision":1,"status":"synthetic-next"}';
  const changed = '{"revision":0,"status":"synthetic-changed"}';
  const absent = mode === 'expected-absent' || mode === 'matching-absent';
  const mismatch = mode === 'changed' || mode === 'expected-absent' || mode === 'snapshot-copy' || mode === 'prefix-copy';
  await driver.removePrefix(prefix);
  await driver.putManyVerified(new Map([[checkpoint, old], [retained, 'synthetic-retained'], ...(!absent ? [[leaf, old]] : [])] as [string, string][]));
  const expected = new Map<string, string | null>([[checkpoint, old], [leaf, absent ? null : old]]);
  const expectedPrefix = { prefix, entries: await driver.readPrefix(prefix) };
  if (mismatch) await writer.putVerified(leaf, changed);
  const before = await driver.readPrefix(prefix);
  const originalGet = IDBObjectStore.prototype.get;
  const originalPut = IDBObjectStore.prototype.put;
  const originalDelete = IDBObjectStore.prototype.delete;
  let mutations = 0;
  let wrote = false;
  try {
    IDBObjectStore.prototype.put = function (record, key) {
      mutations += 1; wrote = true;
      return originalPut.call(this, record, key);
    };
    IDBObjectStore.prototype.delete = function (query) {
      mutations += 1;
      return originalDelete.call(this, query);
    };
    if (mode === 'readback-rollback') IDBObjectStore.prototype.get = function (query) {
      const request = originalGet.call(this, query);
      if (wrote && query === leaf) request.addEventListener('success', () => {
        Object.defineProperty(request, 'result', { value: { key: leaf, value: 'synthetic-corrupt-readback' } });
      }, { once: true });
      return request;
    };
    const compare = driver.compareAndSetMany.bind(driver) as (
      key: string, revision: number | null, entries: ReadonlyMap<string, string>, remove: string[],
      prefix: { prefix: string; entries: ReadonlyMap<string, string> } | undefined,
      expected: ReadonlyMap<string, string | null> | undefined,
    ) => Promise<{ ok: boolean }>;
    const pending = compare(checkpoint, 0, new Map([[checkpoint, next], [leaf, next]]), [retained],
      mode === 'prefix-copy' ? expectedPrefix : undefined, mode === 'prefix-copy' ? undefined : expected);
    // Mutation immediately after invocation must not change the transaction's basis.
    if (mode === 'snapshot-copy') expected.set(leaf, changed);
    if (mode === 'prefix-copy') expectedPrefix.entries.set(leaf, changed);
    const outcome = await pending.then(result => result.ok ? 'committed' : 'conflict', () => 'rejected');
    IDBObjectStore.prototype.get = originalGet;
    const after = await driver.readPrefix(prefix);
    if (mismatch || mode === 'readback-rollback') {
      if (outcome !== (mismatch ? 'conflict' : 'rejected') || (mismatch && mutations !== 0) ||
        before.size !== after.size || [...before].some(([key, value]) => after.get(key) !== value)) {
        throw new Error('Synthetic atomic range did not retain the original records');
      }
    } else if (outcome !== 'committed' || after.size !== 2 || after.get(checkpoint) !== next || after.get(leaf) !== next) {
      throw new Error('Synthetic atomic range did not commit together');
    }
  } finally {
    IDBObjectStore.prototype.get = originalGet;
    IDBObjectStore.prototype.put = originalPut;
    IDBObjectStore.prototype.delete = originalDelete;
    await driver.removePrefix(prefix);
  }
}

async function checkPublicCacheIntegration(): Promise<void> {
  const first = new IndexedDbEncryptedRecordDriver();
  const second = new IndexedDbEncryptedRecordDriver();
  const context = { networkId: '01'.repeat(32), realmId: '02'.repeat(32), poolId: '03'.repeat(32) };
  const scope = `${context.networkId}:${context.realmId}:${context.poolId}:`;
  const legacyPrefix = `private:cache:v1:${scope}`;
  const currentPrefix = `private:cache:v2:${scope}`;
  const legacyKey = `${legacyPrefix}commitments:${'0'.repeat(39)}`;
  const marker = (value: number) => new Uint8Array(32).fill(value);
  const legacyRaw = JSON.stringify({ kind: 'public-commitment-chunk', version: 1, revision: 0, startIndex: '0', commitments: ['01'.repeat(32)] });
  try {
    await first.putManyVerified(new Map([[legacyKey, legacyRaw], [`${legacyPrefix}synthetic-discovery`, 'synthetic-encrypted']]));
    if ((await loadPrivateBalanceCommitments(context, first)).length !== 0 || await first.read(legacyKey) !== legacyRaw) {
      throw new Error('Unsupported cache data must be ignored without mutation');
    }
    await recordVerifiedPrivateBalanceCommitments(context, 0n, [marker(1)], first);
    await recordVerifiedPrivateBalanceCommitments(context, 1n, [marker(2)], first);
    await recordVerifiedPrivateBalanceCommitments(context, 1n, [marker(2), marker(3)], second);
    await recordVerifiedPrivateBalanceCommitments(context, 3n, [marker(4)], first);
    const loaded = await loadPrivateBalanceCommitments(context, second);
    if (loaded.length !== 4 || loaded.some((value, index) => value.some(byte => byte !== index + 1))) {
      throw new Error('Synthetic incremental records differ');
    }
    const before = await first.readPrefix(currentPrefix);
    const rejected = await recordVerifiedPrivateBalanceCommitments(context, 0n, [marker(9)], second)
      .then(() => false, () => true);
    const after = await first.readPrefix(currentPrefix);
    if (!rejected || before.size !== after.size || [...before].some(([key, raw]) => after.get(key) !== raw)) {
      throw new Error('Synthetic overlap conflict changed storage');
    }
    await clearPrivateBalanceCommitmentCache(context, first);
    if ((await loadPrivateBalanceCommitments(context, second)).length !== 0 ||
      await first.read(legacyKey) !== legacyRaw || await first.read(`${legacyPrefix}synthetic-discovery`) !== 'synthetic-encrypted') {
      throw new Error('Synthetic reset did not preserve its namespace boundary');
    }
    await recordVerifiedPrivateBalanceCommitments(context, 0n, [marker(5)], second);
    if ((await loadPrivateBalanceCommitments(context, first)).length !== 1) throw new Error('Synthetic reset reimported legacy records');
  } finally {
    await first.removePrefix(currentPrefix);
    await first.removePrefix(legacyPrefix);
  }
}

async function checkDiscoveryRemovalSnapshot(mode: string): Promise<void> {
  const driver = new IndexedDbEncryptedRecordDriver();
  const writer = new IndexedDbEncryptedRecordDriver();
  const prefix = 'synthetic-fenced-removal:';
  const statePrefix = `${prefix}state:`;
  const stateKey = `${statePrefix}commit`;
  const cacheKey = `${prefix}cache`;
  const retainedKey = `${prefix}retained`;
  const absent = mode === 'expected-absent' || mode === 'matching-absent';
  const mismatched = mode === 'changed' || mode === 'expected-absent';
  await driver.removePrefix(prefix);
  await driver.putManyVerified(new Map([
    [cacheKey, 'synthetic-cache'], [retainedKey, 'synthetic-retained'],
    ...(!absent ? [[stateKey, '{"revision":1,"status":"synthetic-idle"}']] : []),
  ] as [string, string][]));
  const expected = new Map<string, string | null>([[stateKey, await driver.read(stateKey)]]);
  // A separate writer updates raw state after removal's validation snapshot.
  // The revision deliberately stays equal, so revision-only comparison fails.
  if (mismatched) await writer.putVerified(stateKey, '{"revision":1,"status":"synthetic-pending"}');
  const before = await driver.readPrefix(prefix);
  const originalDelete = IDBObjectStore.prototype.delete;
  const originalPut = IDBObjectStore.prototype.put;
  let mutations = 0;
  try {
    IDBObjectStore.prototype.delete = function (query) {
      mutations += 1;
      return originalDelete.call(this, query);
    };
    IDBObjectStore.prototype.put = function (record, key) {
      mutations += 1;
      return originalPut.call(this, record, key);
    };
    const replace = driver.replacePrefixVerified.bind(driver) as (
      prefix: string, entries: Map<string, string>, remove: string[], guard: object,
      expected: ReadonlyMap<string, string | null>,
    ) => Promise<void>;
    const outcome = await replace(statePrefix, new Map(), [cacheKey], {}, expected)
      .then(() => 'removed', () => 'rejected');
    const after = await driver.readPrefix(prefix);
    if (mismatched) {
      if (outcome !== 'rejected' || mutations !== 0 || before.size !== after.size ||
        [...before].some(([key, value]) => after.get(key) !== value)) {
        throw new Error('Stale removal snapshot did not preserve every record');
      }
    } else if (outcome !== 'removed' || after.size !== 1 || after.get(retainedKey) !== 'synthetic-retained') {
      throw new Error('Matching removal snapshot did not remove the expected records');
    }
  } finally {
    IDBObjectStore.prototype.delete = originalDelete;
    IDBObjectStore.prototype.put = originalPut;
  }
}

const draft = { kind: 'transfer' as const, amount: '1', recipientAddress: 'synthetic-recipient-only' };
const approval: PrivateChainedSendApproval = {
  id: 'synthetic-chain', steps: 2, perStepMaxFeeStroops: '1000',
  cumulativeMaxFeeStroops: '2000', expiresAtSeconds: 4_000_000_000,
};

function ProofPanel() {
  const consent = useRef(new PrivateProofConsent());
  const operation = useRef<AbortController | null>(null);
  const [disclosure, setDisclosure] = useState<Readonly<PrivateProofDisclosure> | null>(null);
  const [amount, setAmount] = useState('1');
  const [events, setEvents] = useState<string[]>([]);
  const [status, setStatus] = useState('idle');
  useEffect(() => () => operation.current?.abort(), []);
  const start = () => {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setEvents([]); setAmount('1'); setStatus('waiting');
    void disclosePrivateProof({
      request: { kind: 'transfer', actionId: 'synthetic-proof', actionField: '55'.repeat(32), assetContractId: 'synthetic',
        amountStroops: '10000000', recipientAddress: draft.recipientAddress, publicRecipient: null, memoHex: null,
        privateFeeAtomic: '0', maximumNetworkFeeStroops: '1000', submissionMode: 'direct' },
      signal: controller.signal,
      authorize: request => { setDisclosure(request); return consent.current.wait(request.actionId, controller.signal); },
      commit: async () => { setEvents(current => [...current, 'reserved']); },
      disclose: async () => { setEvents(current => [...current, 'shared']); },
    }).then(() => {
      if (operation.current === controller) { setStatus('shared'); setDisclosure(null); }
    }).catch(() => {
      if (operation.current === controller) { setStatus('cancelled'); setDisclosure(null); }
    });
  };
  return <>
    <Button onClick={start}>Start synthetic proof review</Button>
    <Button variant="secondary" onClick={() => setAmount(value => value === '1' ? '2' : '1')}>Change synthetic amount</Button>
    <p data-testid="proof-events">{events.join(',') || 'none'}</p>
    <p data-testid="proof-status">{status}</p>
    <PrivateActionReview draft={{ ...draft, amount }} review={null} disclosure={disclosure} chained={null}
      chainProgress={null} progress={null} preparing={false} working={false}
      error={null} errorCause={null} balanceBeforeStroops={20_000_000n} confirmLabel="Send privately"
      onConfirm={() => { if (disclosure) consent.current.approve(disclosure.actionId); }}
      onBack={() => operation.current?.abort()} />
  </>;
}

function Fixture() {
  const [privateRecovery, setPrivateRecovery] = useState(false);
  const [signingContext, setSigningContext] = useState(false);
  const [merchantFeedback, setMerchantFeedback] = useState(false);
  const [modalOwnership, setModalOwnership] = useState(false);
  const [merchantLifetime, setMerchantLifetime] = useState(false);
  const [discovery, setDiscovery] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('recovery');
  const [scope, setScope] = useState('account-a');
  const [modes, setModes] = useState<Record<string, PrivateOutgoingHistoryMode>>({});
  const [step, setStep] = useState(1);
  const [waiting, setWaiting] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [writes, setWrites] = useState(0);
  const completion = useRef<(() => void) | null>(null);
  const rejection = useRef<(() => void) | null>(null);
  if (privateRecovery) return <PrivateRecoveryFixture />;
  if (signingContext) return <SigningContextFixture />;
  if (merchantFeedback) return <MerchantFeedbackFixture />;
  if (modalOwnership) return <ModalOwnershipFixture onExit={() => setModalOwnership(false)} />;
  if (merchantLifetime) return <MerchantLifetimeFixture />;
  if (discovery) return <DiscoveryProviderChecks />;
  return (
    <PrivateBalanceRuntimeDataProvider value={{ ...initialPrivateBalanceRuntimeData, asset: {
      index: 0, kind: 'native', code: 'XLM', issuer: null, name: 'Synthetic XLM', decimals: 7, displayDecimals: 7, contractId: 'synthetic', status: 'active',
    } }}>
      <main id="app-content" data-app-surface className="min-h-screen p-6">
        <h1 className="text-xl text-white">Synthetic privacy interaction checks</h1>
        <Button onClick={() => setPrivateRecovery(true)}>Test private recovery</Button>
        <Button onClick={() => setSigningContext(true)}>Test signing context</Button>
        <Button onClick={() => setMerchantFeedback(true)}>Test merchant feedback</Button>
        <Button onClick={() => setMerchantLifetime(true)}>Test merchant lifetime</Button>
        <Button onClick={() => setModalOwnership(true)}>Test modal ownership</Button>
        <Button onClick={() => setDiscovery(true)}>Test discovery lifecycle</Button>
        <DiscoveryStorageChecks />
        <UxPrimitivesFixture />
        <QrFreshnessFixture />
        <DirectPrivateFixture />
        <Button onClick={() => { setOpen(true); setCancelled(false); }}>Open privacy controls</Button>
        <p data-testid="writes">{writes}</p>
        <Modal open={open} onClose={() => setOpen(false)} wide>
          <ModalHeader title="Synthetic privacy controls" onClose={() => setOpen(false)} />
          <div className="space-y-4 p-4">
            <Tabs ariaLabel="Privacy check panels" options={[{ value: 'recovery', label: 'Recovery' }, { value: 'chain', label: 'Chain' }, { value: 'proof', label: 'Proof' }]} value={tab} onChange={setTab}>
            {tab === 'recovery' ? <>
              <Button variant="secondary" onClick={() => setScope(value => value === 'account-a' ? 'account-b' : 'account-a')}>Switch synthetic account</Button>
              <Button variant="secondary" onClick={() => completion.current?.()}>Finish pending preference</Button>
              <Button variant="secondary" onClick={() => rejection.current?.()}>Reject pending preference</Button>
              <p data-testid="scope">{scope}</p>
              <PrivateOutgoingHistorySettings scope={scope} mode={modes[scope] ?? 'recoverable'} disabled={false}
                onChange={async (mode, consent) => {
                  if (mode === 'minimized' && consent.acknowledgeRecoveryLoss !== true) throw new Error('Consent required');
                  const selected = scope;
                  try {
                    await new Promise<void>((resolve, reject) => {
                      completion.current = resolve;
                      rejection.current = () => reject(new Error('Synthetic preference write failed.'));
                    });
                    setModes(current => ({ ...current, [selected]: mode }));
                    setWrites(value => value + 1);
                  } finally {
                    completion.current = null;
                    rejection.current = null;
                  }
                }} />
            </> : tab === 'proof' ? <ProofPanel /> : cancelled ? <>
              <p>Chain finished</p>
              <Button onClick={() => { setCancelled(false); setStep(1); setWaiting(false); }}>Review another chain</Button>
            </> : <>
              <Button variant="secondary" disabled={!waiting} onClick={() => { if (step === 1) setStep(2); else { setWaiting(false); setCancelled(true); } }}>Deliver canonical synthetic result</Button>
              <PrivateActionReview draft={draft} review={null} chained={{ approval, draft }}
                chainProgress={{ step, totalSteps: 2, stage: waiting ? 'confirming' : 'preparing' }}
                progress={null}
                preparing={false} working={waiting} error={null} errorCause={null} balanceBeforeStroops={20_000_000n}
                confirmLabel="Send privately" onConfirm={() => setWaiting(true)} onBack={() => setTab('recovery')} />
            </>}
            </Tabs>
          </div>
        </Modal>
      </main>
    </PrivateBalanceRuntimeDataProvider>
  );
}

export default function PrivateComponentsFixture() {
  return <ToastProvider><WalletProvider><Fixture /></WalletProvider></ToastProvider>;
}
