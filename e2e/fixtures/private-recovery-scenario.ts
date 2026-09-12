// TEST ONLY: non-usable deployment, no network, no valid spend proofs.
// Production preparation, encryption, storage, signing classification and scan
// run unchanged. The worker bridge invokes the real builder/scanner; only the
// prover, archive transport and RPC responses are controlled here.
import { Account, Address, Contract, Keypair, SorobanDataBuilder, StrKey, TransactionBuilder, nativeToScVal, scValToNative, xdr, rpc as SorobanRpc, type FeeBumpTransaction, type Transaction } from '@stellar/stellar-sdk';
import { appendCommitments, computeContextField, computeContextHash, computeGenesisRecordHash,
  computeRecordHash, createEmptyTree, deriveDiversifiedAddressKeys, deriveExpandedSpendingKey,
  derivePrivateAddressDeploymentTag, encodePrivateAddress, toViewingKey,
  type ActionModel, type ArchiveRecordModel } from '@stellarkey/private-balance';
import type { EncryptedRecordDriver, RecordDriverExpectedPrefix, RecordDriverGuard } from '../../src/lib/indexed-db';
import { computeSha256 } from '../../src/lib/private-balance-artifacts';
import type { PrivateBalanceManifest } from '../../src/lib/private-balance-manifest';
import { PrivateBalanceArchiveClient, type ArchiveHeadState } from '../../src/features/private-balance/runtime/archive-client';
import { preparePrivateBalanceActionFlow, type PreparedPrivateActionReview } from '../../src/features/private-balance/runtime/action-flow';
import { preparePrivateAction } from '../../src/features/private-balance/worker/action-builder';
import { PrivateBalanceWorkerClient } from '../../src/features/private-balance/worker/client';
import { HorizonStealthAnnouncementReader } from '../../src/features/private-balance/runtime/stealth-horizon';
import { scanArchiveRecords } from '../../src/features/private-balance/runtime/scanner';
import { syncPrivateBalance } from '../../src/features/private-balance/runtime/sync-machine';
import { commitPrivateBalanceState, createEmptyPrivateBalanceState, loadPrivateBalanceState,
  releaseExpiredPrivateBuildReservations, releaseStalePrivatePendingActions } from '../../src/features/private-balance/runtime/storage';
import { broadcastPrivateBalanceAction, recoverPrivateBalanceAction, signReviewedPrivateBalanceAction } from '../../src/features/private-balance/runtime/submission';
import { parsePrivateAmount } from '../../src/features/private-balance/runtime/coin-selection';
import { selectTotalShieldedBalance } from '../../src/features/private-balance/runtime/selectors';
import type { PrivateBalanceDurableState } from '../../src/features/private-balance/runtime/types';
import type { AuthorizePrivateProofDisclosure } from '../../src/features/private-balance/runtime/proof-disclosure';
import { exportPrivateBalanceBackupArchive, restorePrivateBalanceBackupArchive } from '../../src/features/private-balance/runtime/backup';

export class SyntheticRecordDriver implements EncryptedRecordDriver {
  records = new Map<string, string>();
  async read(key: string) { return this.records.get(key) ?? null; }
  async readPrefix(prefix: string) { return new Map([...this.records].filter(([key]) => key.startsWith(prefix))); }
  async putVerified(key: string, value: string) { this.records.set(key, value); return value; }
  async putManyVerified(entries: ReadonlyMap<string, string>) { for (const [key, value] of entries) this.records.set(key, value); }
  async compareAndSet(key: string, revision: number | null, value: string, guard: RecordDriverGuard = {}) {
    guard.signal?.throwIfAborted(); guard.assertActive?.();
    return this.compareAndSetMany(key, revision, new Map([[key, value]]));
  }
  async compareAndSetMany(key: string, revision: number | null, entries: ReadonlyMap<string, string>,
    removeKeys: readonly string[] = [], expectedPrefix?: RecordDriverExpectedPrefix, expectedRecords?: ReadonlyMap<string, string | null>) {
    const current = this.records.get(key) ?? null;
    if ((current ? JSON.parse(current).revision : null) !== revision) return { ok: false, current };
    if (expectedPrefix) {
      const actual = new Map([...this.records].filter(([key]) => key.startsWith(expectedPrefix.prefix)));
      if (actual.size !== expectedPrefix.entries.size || [...expectedPrefix.entries].some(([key, value]) => actual.get(key) !== value)) return { ok: false, current };
    }
    if ([...expectedRecords ?? []].some(([key, value]) => (this.records.get(key) ?? null) !== value)) return { ok: false, current };
    for (const key of removeKeys) if (!entries.has(key)) this.records.delete(key);
    for (const [key, value] of entries) this.records.set(key, value);
    return { ok: true, current: this.records.get(key) ?? null };
  }
  async replacePrefixVerified(prefix: string, entries: ReadonlyMap<string, string>, removeKeys: readonly string[] = [],
    guard: RecordDriverGuard = {}, expectedRecords?: ReadonlyMap<string, string | null>) {
    guard.signal?.throwIfAborted(); guard.assertActive?.();
    if ([...expectedRecords ?? []].some(([key, value]) => (this.records.get(key) ?? null) !== value)) throw new Error('Synthetic record conflict');
    for (const key of this.records.keys()) if (key.startsWith(prefix)) this.records.delete(key);
    for (const key of removeKeys) this.records.delete(key);
    for (const [key, value] of entries) this.records.set(key, value);
  }
  async remove(key: string) { this.records.delete(key); }
  async removePrefix(prefix: string) { for (const key of this.records.keys()) if (key.startsWith(prefix)) this.records.delete(key); }
}

const bytes = (value: number) => new Uint8Array(32).fill(value);
const hex = (value: Uint8Array) => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
const decode = (value: string) => Uint8Array.from(value.match(/../g)!, byte => Number.parseInt(byte, 16));
const format = (value: bigint) => `${value / 10_000_000n}${value % 10_000_000n ? `.${(value % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '')}` : ''}`;
const names = ['bob', 'alice', 'charlie'] as const;
const keyFor = (name: typeof names[number]) => bytes(31 + names.indexOf(name));
const scopeFor = (manifest: PrivateBalanceManifest, name: typeof names[number]) => ({ accountId: `synthetic-private-recovery-${name}`,
  networkId: manifest.networkId, realmId: manifest.realmId, poolId: hex(new Uint8Array(StrKey.decodeContract(manifest.poolContractId))),
  deploymentBindingHash: manifest.deploymentBindingHash });

export async function readPrivateRecoveryBalances(manifest: PrivateBalanceManifest, driver: EncryptedRecordDriver) {
  const states = await Promise.all(names.map(name => loadPrivateBalanceState(scopeFor(manifest, name), keyFor(name), driver)));
  if (states.some(state => !state)) throw new Error('Synthetic scenario has not been seeded');
  const [bob, alice, charlie] = states as PrivateBalanceDurableState[];
  return { bob: format(selectTotalShieldedBalance(bob)),
    reserved: format(bob.notes.filter(note => note.status === 'reserved').reduce((sum, note) => sum + BigInt(note.value), 0n)),
    alice: format(selectTotalShieldedBalance(alice)), charlie: format(selectTotalShieldedBalance(charlie)), pending: bob.pendingActions.length };
}

export async function readPrivateRecoveryState(manifest: PrivateBalanceManifest, driver: EncryptedRecordDriver) {
  return loadPrivateBalanceState(scopeFor(manifest, 'bob'), keyFor('bob'), driver);
}

export type PrepareMode = 'approve' | 'cancel' | 'proof-failure' | 'consent-expired' | 'rpc-reject' | 'rpc-timeout';
export type SubmitMode = 'PENDING' | 'ERROR' | 'timeout' | 'signer-reject';

export async function createPrivateRecoveryScenario(development: PrivateBalanceManifest, driver: EncryptedRecordDriver,
  options: { deposits?: string[]; amount?: string; outgoingHistory?: 'recoverable' | 'minimized';
    bob?: { accountId: string; publicKey: string; root: Uint8Array; storageKey: Uint8Array } } = {}) {
  const manifest = structuredClone(development);
  const artifacts = new Map<string, Uint8Array>([
    ['circuit.wasm', Uint8Array.of(0, 1)], ['circuit.zkey', Uint8Array.of(2, 3)],
    ['verification-key.json', new TextEncoder().encode(JSON.stringify({ protocol: 'groth16', curve: 'bn128',
      nPublic: manifest.constants.publicInputs, vk_alpha_1: [], vk_beta_2: [], vk_gamma_2: [], vk_delta_2: [],
      IC: Array.from({ length: manifest.constants.publicInputs + 1 }, () => []) }))],
  ]);
  delete manifest.artifacts.zkeyTransport;
  manifest.artifacts.wasmByteLength = 2; manifest.artifacts.zkeyByteLength = 2;
  manifest.artifacts.wasmSha256 = await computeSha256(artifacts.get('circuit.wasm')!.slice().buffer);
  manifest.artifacts.zkeySha256 = await computeSha256(artifacts.get('circuit.zkey')!.slice().buffer);
  manifest.artifacts.vkJsonSha256 = await computeSha256(artifacts.get('verification-key.json')!.slice().buffer);
  const base = { protocolVersion: 1, networkId: decode(manifest.networkId), realmId: decode(manifest.realmId),
    poolId: new Uint8Array(StrKey.decodeContract(manifest.poolContractId)), deploymentBindingHash: decode(manifest.deploymentBindingHash),
    addressPrefix: 'tskpay_' as const, assets: manifest.assets.map(({ index, contractId }) => ({ index, contractId })) };
  const contextHash = computeContextHash(1, base.networkId, base.realmId, base.poolId);
  const contextField = computeContextField(contextHash);
  const actors = await Promise.all(names.map(async (name, index) => {
    const override = name === 'bob' ? options.bob : undefined;
    const accountPublicKey = new Uint8Array(override ? StrKey.decodeEd25519PublicKey(override.publicKey) : Keypair.fromRawEd25519Seed(bytes(11 + index)).rawPublicKey());
    const keyContext = { ...base, accountPublicKey, contextField };
    const esk = await deriveExpandedSpendingKey(override?.root ?? new Uint8Array(64).fill(21 + index), 1, base.networkId, base.realmId, base.poolId, accountPublicKey, contextField);
    const diversifier = Uint8Array.of(0, 0, 0, index + 1);
    const identity = await deriveDiversifiedAddressKeys(esk.baseOwnerCommitment, esk.hpkePrivateKey, diversifier);
    const address = encodePrivateAddress({ deploymentTag: derivePrivateAddressDeploymentTag(base.deploymentBindingHash), diversifier,
      ownerCommitment: identity.ownerCommitment, hpkePublicKey: identity.hpkePublicKey }, 'tskpay_');
    const state = createEmptyPrivateBalanceState('09'.repeat(32));
    state.outgoingHistoryMode = options.outgoingHistory ?? 'recoverable';
    const scope = { ...scopeFor(manifest, name), ...(override ? { accountId: override.accountId } : {}) };
    const storageKey = override?.storageKey.slice() ?? keyFor(name);
    // Refuse to overwrite a scenario: browser reload must inspect real storage.
    if (await loadPrivateBalanceState(scope, storageKey, driver)) throw new Error('Synthetic scenario already exists');
    await commitPrivateBalanceState(scope, storageKey, state, null, driver);
    return { name, esk, keyContext, address, scope, storageKey,
      scanContext: { ...base, contextHash, contextField, accountAddress: { kind: 0, payload: accountPublicKey } } };
  }));
  const [bob, , charlie] = actors;
  const amount = options.amount ?? '10';
  const assetContractId = manifest.assets[0].contractId;
  const records: ArchiveRecordModel[] = [];
  const tree = await createEmptyTree();
  let transcriptHead = computeGenesisRecordHash(contextHash, base.deploymentBindingHash);
  const append = async (action: ActionModel) => {
    const fields = { ...action };
    const actionIndex = records.length;
    const record = { ...fields, actionKind: action.kind, actionIndex, ledgerSequence: 100 + actionIndex,
      startingLeafIndex: actionIndex * 3, treeRootAfter: (await appendCommitments(tree, action.outputs.map(output => output.cm))).slice() };
    transcriptHead = computeRecordHash(record, 1, transcriptHead);
    records.push(record);
  };
  const head = (): ArchiveHeadState => ({ latestLedger: 100 + records.length,
    config: { protocolVersion: 1, networkId: base.networkId, realmId: base.realmId, guardian: manifest.guardianAddress,
      initialAssetAdmin: manifest.assetAdminAddress, poseidon2ParameterHash: bytes(1), circuitHash: bytes(2), verificationKeyHash: bytes(3),
      treeDepth: manifest.constants.treeDepth, rootWindowLedgers: manifest.constants.rootWindowLedgers,
      deploymentBindingHash: base.deploymentBindingHash, contextHash, contextField },
    meta: { actionCount: records.length, transcriptHead }, tree });
  const archive = { readHead: async () => head(), readRecords: async (start: number, count: number) => records.slice(start, start + count),
    readLedgerCloseTimes: async (sequences: readonly number[]) => Object.fromEntries(sequences.map(sequence => [sequence, 1_800_000_000 + sequence])) };
  const sync = async () => {
    for (const actor of actors) await syncPrivateBalance({ archive, contextHash, deploymentBindingHash: base.deploymentBindingHash,
      manifestHash: '09'.repeat(32), storageContext: actor.scope, storageKey: actor.storageKey, storageDriver: driver, publicCacheDriver: driver,
      worker: { scanPage: input => scanArchiveRecords({ ...input, viewingKey: toViewingKey(actor.esk), context: actor.scanContext }) } });
  };
  for (const deposit of options.deposits ?? ['100']) {
    const prepared = await preparePrivateAction({ esk: bob.esk, keyContext: bob.keyContext, availableNotes: [], merklePaths: [],
      intent: { kind: 'deposit', assetIndex: 0, assetContractId, publicValue: parsePrivateAmount(deposit, 7).toString(),
        depositSource: { kind: 0, payload: bob.keyContext.accountPublicKey } } });
    await append(prepared.action);
  }
  await sync();
  let review: PreparedPrivateActionReview | undefined;
  let sharedAction: ActionModel | undefined;
  let recoveryAction: ActionModel | undefined;
  let confirmed = false;
  let shared = 0;
  let submissions = 0;
  let workerCrashes = 0;
  let senderLookups = 0;
  const stages: string[] = [];
  const bobSigner = Keypair.fromRawEd25519Seed(bytes(11));
  const loadBob = async () => {
    const state = await loadPrivateBalanceState(bob.scope, bob.storageKey, driver);
    if (!state) throw new Error('Synthetic Bob state missing');
    return state;
  };
  return {
    manifest, scope: bob.scope,
    get shared() { return shared; }, get submissions() { return submissions; },
    get workerCrashes() { return workerCrashes; },
    get senderLookups() { return senderLookups; }, get stages() { return [...stages]; },
    get review() { return review ?? null; },
    state: loadBob,
    async changeState(update: (state: PrivateBalanceDurableState) => PrivateBalanceDurableState) {
      const state = await loadBob();
      const next = { ...update(structuredClone(state)), revision: state.revision + 1 };
      await commitPrivateBalanceState(bob.scope, bob.storageKey, next, state.revision, driver);
    },
    async restoreBackup() {
      const archive = await exportPrivateBalanceBackupArchive(driver);
      await restorePrivateBalanceBackupArchive({ archive, driver, validateContext: async () => {}, resolveStorageKey: async context => {
        const actor = actors.find(actor => actor.scope.accountId === context.accountId);
        if (!actor) throw new Error('Synthetic backup context mismatch');
        return actor.storageKey.slice();
      } });
    },
    draft: { kind: 'transfer' as const, amount, recipientAddress: charlie.address },
    async journal() {
      const state = await loadBob();
      return { builds: state.buildReservations.length, pending: state.pendingActions.map(action => ({ status: action.status,
        exposure: action.proofExposure, attempts: action.broadcastAttempts, rpc: action.latestRpcStatus ?? null,
        hasEnvelope: !!action.signedEnvelopeXdr })) };
    },
    balances: async () => {
      const states = await Promise.all(actors.map(actor => loadPrivateBalanceState(actor.scope, actor.storageKey, driver)));
      const [sender, unrelated, recipient] = states as PrivateBalanceDurableState[];
      return { bob: format(selectTotalShieldedBalance(sender)),
        reserved: format(sender.notes.filter(note => note.status === 'reserved').reduce((sum, note) => sum + BigInt(note.value), 0n)),
        alice: format(selectTotalShieldedBalance(unrelated)), charlie: format(selectTotalShieldedBalance(recipient)), pending: sender.pendingActions.length };
    }, sync,
    installProviderTransport(options: { crashWorkerAt?: 'build' | 'submission'; uncertainSubmission?: boolean; simulationResourceFee?: () => string; receiveSyncBlocked?: () => boolean; beforeAddressRotation?: () => Promise<void>;
      nativeBalance?: () => string; onSubmit?: (transaction: Transaction | FeeBumpTransaction) => void } = {}) {
      const latestWorker: { current: PrivateBalanceWorkerClient | null } = { current: null };
      const crashWorker = (client: PrivateBalanceWorkerClient) => {
        // Fault injection at the actual browser-worker event boundary. The
        // production client owns failure, rejection, teardown and recovery.
        const worker = (client as unknown as { worker: Worker | null }).worker;
        if (!worker) throw new Error('Synthetic worker event target missing');
        workerCrashes++;
        worker.dispatchEvent(new Event('error'));
      };
      const archivePrototype = PrivateBalanceArchiveClient.prototype;
      const savedArchive = { readHead: archivePrototype.readHead, readRecords: archivePrototype.readRecords,
        readLedgerCloseTimes: archivePrototype.readLedgerCloseTimes, readDepositsPaused: archivePrototype.readDepositsPaused,
        readNetworkPassphrase: archivePrototype.readNetworkPassphrase, readOldestLedgerSequence: archivePrototype.readOldestLedgerSequence,
        readLatestLedgerSequence: archivePrototype.readLatestLedgerSequence, readLedgerIdentity: archivePrototype.readLedgerIdentity,
        readAssetBalance: archivePrototype.readAssetBalance };
      const rpcPrototype = SorobanRpc.Server.prototype;
      const savedRpc = { getAccount: rpcPrototype.getAccount, simulateTransaction: rpcPrototype.simulateTransaction,
        sendTransaction: rpcPrototype.sendTransaction, getTransaction: rpcPrototype.getTransaction };
      const workerPrototype = PrivateBalanceWorkerClient.prototype;
      const savedBuild = workerPrototype.buildAction;
      const savedProof = workerPrototype.generateProof;
      const savedGenerateAddress = workerPrototype.generateAddress;
      workerPrototype.generateAddress = async function () {
        await options.beforeAddressRotation?.();
        return savedGenerateAddress.call(this);
      };
      const savedFetch = globalThis.fetch;
      const savedStealth = HorizonStealthAnnouncementReader.prototype.readPage;
      Object.assign(archivePrototype, { ...archive, readDepositsPaused: async () => false,
        readHead: async () => {
          if (options.receiveSyncBlocked?.()) throw new Error('Synthetic receive archive unavailable.');
          return archive.readHead();
        },
        readAssetBalance: async () => 10000000000n,
        readNetworkPassphrase: async () => manifest.networkPassphrase, readOldestLedgerSequence: async () => 0,
        readLatestLedgerSequence: async () => head().latestLedger,
        readLedgerIdentity: async (sequence: number) => ({ sequence, hash: manifest.deploymentCheckpoint.hash }) });
      HorizonStealthAnnouncementReader.prototype.readPage = async () => ({ announcements: [], latestLedger: head().latestLedger, hasMore: false, nextCursor: '1' });
      rpcPrototype.getAccount = async address => new Account(address, '7');
      rpcPrototype.simulateTransaction = async transaction => {
        shared++;
        const envelope = transaction.toEnvelope();
        if (envelope.type !== 'envelopeTypeTx') throw new Error('Synthetic simulation requires a direct transaction');
        const operation = envelope.value.tx.operations[0];
        if (operation.body.type !== 'invokeHostFunction' || operation.body.invokeHostFunctionOp.hostFunction.type !== 'hostFunctionTypeInvokeContract') {
          throw new Error('Synthetic simulation requires a pool invocation');
        }
        const invocation = operation.body.invokeHostFunctionOp.hostFunction.invokeContract;
        const auth: xdr.SorobanAuthorizationEntry[] = [];
        if (invocation.functionName.toString() === 'deposit') {
          const fields = scValToNative(invocation.args[0]) as { asset_index: number; public_value: bigint; deposit_source: string };
          const transferOperation = new Contract(manifest.assets[fields.asset_index].contractId).call('transfer',
            Address.fromString(fields.deposit_source).toScVal(), Address.fromString(manifest.poolContractId).toScVal(),
            nativeToScVal(fields.public_value));
          if (transferOperation.body.type !== 'invokeHostFunction' || transferOperation.body.invokeHostFunctionOp.hostFunction.type !== 'hostFunctionTypeInvokeContract') {
            throw new Error('Synthetic deposit requires a token transfer invocation');
          }
          const transfer = transferOperation.body.invokeHostFunctionOp.hostFunction.invokeContract;
          const authorize = (call: xdr.InvokeContractArgs, subInvocations: xdr.SorobanAuthorizedInvocation[] = []) => new xdr.SorobanAuthorizedInvocation({
            function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(call), subInvocations,
          });
          auth.push(new xdr.SorobanAuthorizationEntry({ credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
            rootInvocation: authorize(invocation, [authorize(transfer)]) }));
        }
        const resourceFee = options.simulationResourceFee?.() ?? '500';
        return { _parsed: true, id: 'synthetic', latestLedger: head().latestLedger, events: [],
          transactionData: new SorobanDataBuilder().setResourceFee(resourceFee), minResourceFee: resourceFee, result: { auth, retval: xdr.ScVal.scvVoid() } };
      };
      rpcPrototype.sendTransaction = async transaction => {
        options.onSubmit?.(transaction);
        submissions++;
        if (options.crashWorkerAt === 'submission' && latestWorker.current) crashWorker(latestWorker.current);
        if (options.uncertainSubmission) throw new Error('Synthetic uncertain submission response');
        return { status: 'PENDING', hash: hex(transaction.hash()), latestLedger: head().latestLedger, latestLedgerCloseTime: 1_800_000_000 };
      };
      rpcPrototype.getTransaction = async hash => ({ status: SorobanRpc.Api.GetTransactionStatus.NOT_FOUND, txHash: hash,
        latestLedger: head().latestLedger, latestLedgerCloseTime: 1_800_000_000, oldestLedger: 0, oldestLedgerCloseTime: 1_800_000_000 });
      workerPrototype.buildAction = async function (...args) {
        latestWorker.current = this;
        if (options.crashWorkerAt === 'build' && workerCrashes === 0) crashWorker(this);
        const built = await savedBuild.apply(this, args);
        recoveryAction = built.action;
        return built;
      };
      workerPrototype.generateProof = async () => ({ messageVersion: 1, id: 'synthetic', sessionId: 'synthetic', type: 'PROOF_OK',
        proof: { pi_a: [], pi_b: [], pi_c: [], protocol: 'groth16', curve: 'bn128' }, publicSignals: [], sorobanProofHex: '01'.repeat(256) });
      globalThis.fetch = async (resource, init) => {
        const url = typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url;
        const path = url.split('?')[0].split('/').at(-1)!;
        const payload = artifacts.get(path);
        if (url.includes('/protocol/private-balance/v1/') && payload) return new Response(payload.slice().buffer);
        if (options.nativeBalance && /\/accounts\/G[A-Z2-7]{55}(?:\?|$)/.test(url)) {
          return new Response(JSON.stringify({ balances: [{ asset_type: 'native', balance: options.nativeBalance(), selling_liabilities: '2.0000000' }],
            subentry_count: 0, num_sponsoring: 0, num_sponsored: 0 }), { headers: { 'Content-Type': 'application/json' } });
        }
        if (options.nativeBalance && /\/ledgers\?/.test(url)) return new Response(JSON.stringify({ _embedded: { records: [{ base_reserve_in_stroops: '5000000' }] } }), { headers: { 'Content-Type': 'application/json' } });
        if (init?.method === 'POST' && typeof init.body === 'string') {
          const request = JSON.parse(init.body) as { method?: string; id?: number };
          if (request.method === 'getNetwork') return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id,
            result: { passphrase: manifest.networkPassphrase, protocolVersion: 25 } }), { headers: { 'Content-Type': 'application/json' } });
          throw new Error('Synthetic provider forbids external mutation');
        }
        return savedFetch(resource, init); // Browser routing blocks external reads.
      };
      return () => {
        Object.assign(archivePrototype, savedArchive); Object.assign(rpcPrototype, savedRpc);
        workerPrototype.buildAction = savedBuild; workerPrototype.generateProof = savedProof;
        workerPrototype.generateAddress = savedGenerateAddress;
        globalThis.fetch = savedFetch; HorizonStealthAnnouncementReader.prototype.readPage = savedStealth;
      };
    },
    async prepare(mode: PrepareMode, authorize?: AuthorizePrivateProofDisclosure, recovery = false, signal?: AbortSignal) {
      const originalHead = PrivateBalanceArchiveClient.prototype.readHead;
      const originalPaused = PrivateBalanceArchiveClient.prototype.readDepositsPaused;
      const originalFetch = globalThis.fetch;
      const originalAccount = SorobanRpc.Server.prototype.getAccount;
      const originalSimulate = SorobanRpc.Server.prototype.simulateTransaction;
      const recoveryActionId = recovery ? (await loadBob()).pendingActions[0]?.id : undefined;
      stages.length = 0;
      let built: Awaited<ReturnType<typeof preparePrivateAction>> | undefined;
      // No Worker thread/prover is claimed here. The real action builder runs
      // in-process against exactly the notes/paths supplied by the real flow.
      const worker = {
        deriveAddressForDiversifier: async (diversifier: Uint8Array) => {
          const identity = await deriveDiversifiedAddressKeys(bob.esk.baseOwnerCommitment, bob.esk.hpkePrivateKey, diversifier);
          return { address: encodePrivateAddress({ deploymentTag: derivePrivateAddressDeploymentTag(base.deploymentBindingHash), diversifier,
            ownerCommitment: identity.ownerCommitment, hpkePublicKey: identity.hpkePublicKey }, 'tskpay_') };
        },
        buildAction: async (...[reservationId, intent, merklePaths, availableNotes]: Parameters<PrivateBalanceWorkerClient['buildAction']>) => {
          built = await preparePrivateAction({ esk: bob.esk, keyContext: bob.keyContext, intent, merklePaths, availableNotes });
          return { messageVersion: 1, id: 'synthetic', sessionId: 'synthetic', type: 'ACTION_PREPARED', reservationId,
            preparedActionId: 'synthetic-prepared', ...built, actionFieldHex: hex(built.actionField) };
        },
        generateProof: async () => {
          if (mode === 'proof-failure') throw new Error('Synthetic prover failure');
          return { messageVersion: 1, id: 'synthetic', sessionId: 'synthetic', type: 'PROOF_OK',
            proof: { pi_a: [], pi_b: [], pi_c: [], protocol: 'groth16', curve: 'bn128' }, publicSignals: [], sorobanProofHex: '01'.repeat(256) };
        },
      };
      SorobanRpc.Server.prototype.getAccount = async address => new Account(address, '7');
      SorobanRpc.Server.prototype.simulateTransaction = async () => {
        shared++;
        if (recovery) recoveryAction = built?.action; else sharedAction = built?.action;
        if (mode === 'rpc-reject') throw new Error('Synthetic RPC rejected preparation');
        if (mode === 'rpc-timeout') throw new Error('Synthetic RPC preparation timed out');
        return { id: 'synthetic', latestLedger: 100 + records.length, events: [],
          transactionData: new SorobanDataBuilder().setResourceFee('500'), minResourceFee: '500',
          result: { auth: [], retval: xdr.ScVal.scvVoid() }, _parsed: true };
      };
      PrivateBalanceArchiveClient.prototype.readHead = async () => head();
      PrivateBalanceArchiveClient.prototype.readDepositsPaused = async () => false;
      globalThis.fetch = async resource => {
        const url = String(resource);
        const name = url.split('?')[0].split('/').at(-1)!;
        const payload = artifacts.get(name);
        if (!url.startsWith('/protocol/private-balance/v1/') || !payload) throw new Error('Synthetic scenario forbids network transport');
        return new Response(payload.slice().buffer);
      };
      try {
        const result = await preparePrivateBalanceActionFlow({ manifest, accountPublicKey: StrKey.encodeEd25519PublicKey(bob.keyContext.accountPublicKey),
          privateAddress: bob.address, storageContext: bob.scope, storageKey: bob.storageKey, storageDriver: driver,
          worker: worker as unknown as PrivateBalanceWorkerClient, rpcUrl: 'http://127.0.0.1:1', classicFeeStroops: 100n,
          assetContractId, assetIndex: 0, registryAssets: base.assets, assetCode: 'XLM', assetDecimals: 7,
          recoveryActionId,
          signal,
          draft: recovery ? { kind: 'consolidate' } : { kind: 'transfer', amount, recipientAddress: charlie.address },
          onProgress: stage => { stages.push(stage); }, authorizeDisclosure: async request => {
            if (mode === 'cancel') throw new DOMException('Synthetic consent cancelled', 'AbortError');
            await authorize?.(request);
            if (mode === 'consent-expired') throw new Error('Synthetic consent expired before proof sharing');
          } });
        review = result.review;
        return review;
      } finally {
        PrivateBalanceArchiveClient.prototype.readHead = originalHead;
        PrivateBalanceArchiveClient.prototype.readDepositsPaused = originalPaused;
        globalThis.fetch = originalFetch;
        SorobanRpc.Server.prototype.getAccount = originalAccount;
        SorobanRpc.Server.prototype.simulateTransaction = originalSimulate;
      }
    },
    async submit(mode: SubmitMode) {
      if (!review) throw new Error('Synthetic review missing');
      const current = await loadBob();
      const signed = await signReviewedPrivateBalanceAction({ context: bob.scope, storageKey: bob.storageKey, expectedRevision: current.revision,
        actionId: review.id, review: review.transaction, networkPassphrase: manifest.networkPassphrase, storageDriver: driver,
        sign: async request => {
          if (mode === 'signer-reject') throw new Error('Synthetic sender rejected signing');
          const transaction = TransactionBuilder.fromXdr(request.envelopeXdr, manifest.networkPassphrase);
          transaction.sign(bobSigner); return transaction.toXdr();
        } });
      return broadcastPrivateBalanceAction({ context: bob.scope, storageKey: bob.storageKey, expectedRevision: signed.revision,
        actionId: review.id, networkPassphrase: manifest.networkPassphrase, submissionMode: 'direct', storageDriver: driver,
        rpc: { sendTransaction: async transaction => {
          submissions++;
          if (mode === 'timeout') throw new Error('Synthetic uncertain RPC outcome');
          return { status: mode === 'ERROR' ? 'ERROR' : 'PENDING', hash: hex(transaction.hash()) };
        } } });
    },
    async expireAndRecover() {
      const future = Date.now() + 24 * 60 * 60 * 1000;
      await releaseExpiredPrivateBuildReservations(bob.scope, bob.storageKey, future, 1, driver);
      await releaseStalePrivatePendingActions(bob.scope, bob.storageKey, future, 1, driver);
      await sync();
      for (const action of (await loadBob()).pendingActions) await recoverPrivateBalanceAction({ context: bob.scope, storageKey: bob.storageKey,
        actionId: action.id, storageDriver: driver, networkPassphrase: manifest.networkPassphrase,
        rpc: { getTransaction: async () => { senderLookups++; throw new Error('Synthetic exposed proof must reconcile through the canonical archive'); } },
        scanCanonicalTranscript: async () => {
          await sync(); const current = await loadBob();
          return { actionFields: current.activities.map(activity => activity.id), nullifiers: current.activities.flatMap(activity => activity.nullifiers),
            headCloseTimeSeconds: Math.floor(future / 1000) };
        } });
    },
    async confirm(recovery = false, scan = true) {
      const action = recovery ? recoveryAction : sharedAction;
      if (!action || !shared) throw new Error('Cannot include a proof that was never shared');
      if (!confirmed) { await append(action); confirmed = true; }
      if (scan) await sync();
    },
    async freshScanBalances() {
      const values = await Promise.all(actors.map(async actor => {
        const scanned = await scanArchiveRecords({ records, viewingKey: toViewingKey(actor.esk), context: actor.scanContext,
          expectedPriorRecordHash: computeGenesisRecordHash(contextHash, base.deploymentBindingHash) });
        return [actor.name, format(selectTotalShieldedBalance(scanned))];
      }));
      return Object.fromEntries(values);
    },
  };
}
