// TEST ONLY: a synthetic Private Payments network with three real wallets
// (Alice, Bob, Charlie) that share one in-process pool archive. Preparation,
// encrypted storage, signing classification, broadcast bookkeeping, recovery
// and the canonical scanner run unchanged; only the prover, the archive
// transport and the RPC are controlled.
// No network, no funded accounts, no valid spend proofs.
import { Account, Address, Contract, FeeBumpTransaction, Keypair, SorobanDataBuilder, StrKey, Transaction, TransactionBuilder, nativeToScVal, scValToNative, xdr, rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { appendCommitments, computeContextField, computeContextHash, computeGenesisRecordHash,
  computeRecordHash, createEmptyTree, deriveDiversifiedAddressKeys, deriveExpandedSpendingKey,
  derivePrivateAddressDeploymentTag, encodePrivateAddress, toViewingKey,
  type ActionModel, type ArchiveRecordModel } from '@stellarkey/private-balance';
import { computeSha256 } from '../../src/lib/private-balance-artifacts';
import type { PrivateBalanceManifest } from '../../src/lib/private-balance-manifest';
import { PrivateBalanceArchiveClient, type ArchiveHeadState } from '../../src/features/private-balance/runtime/archive-client';
import { preparePrivateBalanceActionFlow, type PreparedPrivateActionReview, type PrivateActionDraft } from '../../src/features/private-balance/runtime/action-flow';
import { preparePrivateAction } from '../../src/features/private-balance/worker/action-builder';
import type { PrivateBalanceWorkerClient } from '../../src/features/private-balance/worker/client';
import { HorizonStealthAnnouncementReader } from '../../src/features/private-balance/runtime/stealth-horizon';
import { scanArchiveRecords } from '../../src/features/private-balance/runtime/scanner';
import { syncPrivateBalance } from '../../src/features/private-balance/runtime/sync-machine';
import { clearShieldedState, commitPrivateBalanceState, createEmptyPrivateBalanceState, loadPrivateBalanceState,
  releaseExpiredPrivateBuildReservations, releaseStalePrivatePendingActions } from '../../src/features/private-balance/runtime/storage';
import { clearPrivateBalanceCommitmentCache } from '../../src/features/private-balance/runtime/public-cache';
import { clearPrivateBalanceMerkleCache } from '../../src/features/private-balance/runtime/merkle-cache';
import { broadcastPrivateBalanceAction, recoverPrivateBalanceAction, signReviewedPrivateBalanceAction,
  type PrivateRecoveryResult } from '../../src/features/private-balance/runtime/submission';
import { parsePrivateAmount } from '../../src/features/private-balance/runtime/coin-selection';
import type { AuthorizePrivateProofDisclosure } from '../../src/features/private-balance/runtime/proof-disclosure';
import { SyntheticRecordDriver } from '../../e2e/fixtures/private-recovery-scenario';

export { SyntheticRecordDriver };

export type ActorName = 'alice' | 'bob' | 'charlie';
export const ACTORS: readonly ActorName[] = ['alice', 'bob', 'charlie'];

/** How consent, the prover and the direct RPC behave during preparation. */
export type PrepareMode = 'approve' | 'cancel' | 'proof-failure' | 'consent-expired' | 'rpc-reject' | 'rpc-timeout';
/** How the RPC answers the signed envelope. `skip` leaves the action reviewed but unsent. */
export type SubmitMode = 'PENDING' | 'ERROR' | 'timeout' | 'signer-reject' | 'skip';

export interface ActionHandle {
  id: string;
  actor: ActorName;
  kind: PrivateActionDraft['kind'];
  /** Null when the proof was shared but the flow failed before review (an RPC failure). */
  review: PreparedPrivateActionReview | null;
  /** The exact action the real builder produced; canonical inclusion appends it. */
  action: ActionModel;
  amountStroops: bigint;
  /** Public account credited by a confirmed withdrawal. */
  publicRecipient: ActorName | null;
  transactionHash: string | null;
  included: boolean;
  failed: boolean;
}

const STROOP = 10_000_000n;
const bytes = (value: number) => new Uint8Array(32).fill(value);
const hex = (value: Uint8Array) => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
const decode = (value: string) => Uint8Array.from(value.match(/../g)!, byte => Number.parseInt(byte, 16));
export const format = (value: bigint) => `${value / STROOP}${value % STROOP ? `.${(value % STROOP).toString().padStart(7, '0').replace(/0+$/, '')}` : ''}`;

export interface ActorBalances {
  spendable: bigint;
  reserved: bigint;
  /** Everything the wallet still owns in the pool: spendable plus reserved. */
  shielded: bigint;
  public: bigint;
  pending: number;
  reservedNotes: number;
}

export async function createPrivatePaymentsNetwork(development: PrivateBalanceManifest, options: {
  driver?: SyntheticRecordDriver;
  /** Starting public balance for every wallet, in display units. */
  publicBalance?: string;
  outgoingHistory?: 'recoverable' | 'minimized';
} = {}) {
  const driver = options.driver ?? new SyntheticRecordDriver();
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
  const assetContractId = manifest.assets[0].contractId;
  const initialPublic = parsePrivateAmount(options.publicBalance ?? '1000', 7);

  const actors = await Promise.all(ACTORS.map(async (name, index) => {
    const signer = Keypair.fromRawEd25519Seed(bytes(61 + index));
    const accountPublicKey = new Uint8Array(signer.rawPublicKey());
    const keyContext = { ...base, accountPublicKey, contextField };
    const esk = await deriveExpandedSpendingKey(new Uint8Array(64).fill(71 + index), 1, base.networkId, base.realmId, base.poolId, accountPublicKey, contextField);
    const diversifier = Uint8Array.of(0, 0, 0, index + 1);
    const identity = await deriveDiversifiedAddressKeys(esk.baseOwnerCommitment, esk.hpkePrivateKey, diversifier);
    const address = encodePrivateAddress({ deploymentTag: derivePrivateAddressDeploymentTag(base.deploymentBindingHash), diversifier,
      ownerCommitment: identity.ownerCommitment, hpkePublicKey: identity.hpkePublicKey }, 'tskpay_');
    const scope = { accountId: `synthetic-network-${name}`, networkId: manifest.networkId, realmId: manifest.realmId,
      poolId: hex(base.poolId), deploymentBindingHash: manifest.deploymentBindingHash };
    const storageKey = bytes(81 + index);
    const state = createEmptyPrivateBalanceState('09'.repeat(32));
    state.outgoingHistoryMode = options.outgoingHistory ?? 'recoverable';
    if (await loadPrivateBalanceState(scope, storageKey, driver)) throw new Error('Synthetic network already exists');
    await commitPrivateBalanceState(scope, storageKey, state, null, driver);
    return { name, signer, publicKey: signer.publicKey(), esk, keyContext, address, scope, storageKey,
      scanContext: { ...base, contextHash, contextField, accountAddress: { kind: 0, payload: accountPublicKey } } };
  }));
  const actor = (name: ActorName) => actors[ACTORS.indexOf(name)];
  const publicBalances = new Map<ActorName, bigint>(ACTORS.map(name => [name, initialPublic]));

  // ---- the shared pool archive ----
  const records: ArchiveRecordModel[] = [];
  const closeTimes = new Map<number, number>();
  const seconds = (ms: number) => Math.floor(ms / 1000);
  const tree = await createEmptyTree();
  let transcriptHead = computeGenesisRecordHash(contextHash, base.deploymentBindingHash);
  const append = async (action: ActionModel) => {
    const actionIndex = records.length;
    const record = { ...action, actionKind: action.kind, actionIndex, ledgerSequence: 100 + actionIndex,
      startingLeafIndex: actionIndex * 3, treeRootAfter: (await appendCommitments(tree, action.outputs.map(output => output.cm))).slice() };
    transcriptHead = computeRecordHash(record, 1, transcriptHead);
    records.push(record);
    closeTimes.set(record.ledgerSequence, seconds(Date.now()));
    return actionIndex;
  };
  const head = (): ArchiveHeadState => ({ latestLedger: 100 + records.length,
    config: { protocolVersion: 1, networkId: base.networkId, realmId: base.realmId, guardian: manifest.guardianAddress,
      initialAssetAdmin: manifest.assetAdminAddress, poseidon2ParameterHash: bytes(1), circuitHash: bytes(2), verificationKeyHash: bytes(3),
      treeDepth: manifest.constants.treeDepth, rootWindowLedgers: manifest.constants.rootWindowLedgers,
      deploymentBindingHash: base.deploymentBindingHash, contextHash, contextField },
    meta: { actionCount: records.length, transcriptHead }, tree });
  const archive = { readHead: async () => head(), readRecords: async (start: number, count: number) => records.slice(start, start + count),
    readLedgerCloseTimes: async (sequences: readonly number[]) => Object.fromEntries(sequences.map(sequence => [sequence, closeTimes.get(sequence) ?? seconds(Date.now())])) };

  // ---- controlled transports, installed for the network's lifetime ----
  const handles = new Map<string, ActionHandle>();
  const hashes = new Map<string, ActionHandle>();
  let submissions = 0;
  let simulations = 0;
  let rpcLookups = 0;
  const preparationModes = new Map<string, { mode: PrepareMode }>();
  const archivePrototype = PrivateBalanceArchiveClient.prototype;
  const rpcPrototype = SorobanRpc.Server.prototype;
  const saved = {
    archive: { readHead: archivePrototype.readHead, readRecords: archivePrototype.readRecords, readLedgerCloseTimes: archivePrototype.readLedgerCloseTimes,
      readDepositsPaused: archivePrototype.readDepositsPaused, readNetworkPassphrase: archivePrototype.readNetworkPassphrase,
      readOldestLedgerSequence: archivePrototype.readOldestLedgerSequence, readLatestLedgerSequence: archivePrototype.readLatestLedgerSequence,
      readLedgerIdentity: archivePrototype.readLedgerIdentity, readAssetBalance: archivePrototype.readAssetBalance },
    rpc: { getAccount: rpcPrototype.getAccount, simulateTransaction: rpcPrototype.simulateTransaction },
    fetch: globalThis.fetch, stealth: HorizonStealthAnnouncementReader.prototype.readPage,
  };
  let depositsPaused = false;
  Object.assign(archivePrototype, { ...archive, readDepositsPaused: async () => depositsPaused,
    readNetworkPassphrase: async () => manifest.networkPassphrase, readOldestLedgerSequence: async () => 0,
    readLatestLedgerSequence: async () => head().latestLedger,
    readLedgerIdentity: async (sequence: number) => ({ sequence, hash: manifest.deploymentCheckpoint.hash }),
    readAssetBalance: async (_contract: string, accountPublicKey: string) => {
      const owner = actors.find(candidate => candidate.publicKey === accountPublicKey);
      if (!owner) throw new Error('Synthetic network has no such public account');
      return publicBalances.get(owner.name)!;
    } });
  HorizonStealthAnnouncementReader.prototype.readPage = async () => ({ announcements: [], latestLedger: head().latestLedger, hasMore: false, nextCursor: '1' });
  rpcPrototype.getAccount = async address => new Account(address, '7');
  // Deposits carry exactly one source-account authorization whose root is the
  // pool call and whose single sub-invocation is the asset transfer into the
  // pool, exactly as a live simulation returns it. Spends carry none.
  const depositAuthorization = (transaction: Transaction | FeeBumpTransaction): xdr.SorobanAuthorizationEntry[] => {
    const inner = transaction instanceof FeeBumpTransaction ? transaction.innerTransaction : transaction;
    const envelope = inner.toEnvelope();
    if (envelope.type !== 'envelopeTypeTx') return [];
    const body = envelope.value.tx.operations[0]?.body;
    if (!body || body.type !== 'invokeHostFunction' || body.invokeHostFunctionOp.hostFunction.type !== 'hostFunctionTypeInvokeContract') return [];
    const invocation = body.invokeHostFunctionOp.hostFunction.invokeContract;
    if (invocation.functionName.toString() !== 'deposit') return [];
    const fields = scValToNative(invocation.args[0]) as { deposit_source: string; public_value: bigint; asset_index: number };
    const transferCall = new Contract(manifest.assets[fields.asset_index].contractId).call('transfer',
      Address.fromString(fields.deposit_source).toScVal(), Address.fromString(manifest.poolContractId).toScVal(),
      nativeToScVal(fields.public_value, { type: 'i128' })).body;
    if (transferCall.type !== 'invokeHostFunction' || transferCall.invokeHostFunctionOp.hostFunction.type !== 'hostFunctionTypeInvokeContract') throw new Error('Synthetic transfer call is malformed');
    const transfer = transferCall.invokeHostFunctionOp.hostFunction.invokeContract;
    const authorized = (contractFn: xdr.InvokeContractArgs, subInvocations: xdr.SorobanAuthorizedInvocation[] = []) =>
      new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(contractFn), subInvocations });
    return [new xdr.SorobanAuthorizationEntry({ credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: authorized(invocation, [authorized(transfer)]) })];
  };
  rpcPrototype.simulateTransaction = async transaction => {
    simulations++;
    const source = transaction instanceof FeeBumpTransaction ? transaction.innerTransaction.source : transaction.source;
    const mode = preparationModes.get(source)?.mode;
    if (mode === 'rpc-reject') throw new Error('Synthetic RPC rejected proof simulation');
    if (mode === 'rpc-timeout') throw new Error('Synthetic RPC proof simulation timed out');
    return { _parsed: true, id: 'synthetic', latestLedger: head().latestLedger, events: [],
      transactionData: new SorobanDataBuilder().setResourceFee('500'), minResourceFee: '500',
      result: { auth: depositAuthorization(transaction), retval: xdr.ScVal.scvVoid() } };
  };
  globalThis.fetch = async resource => {
    const url = String(resource instanceof Request ? resource.url : resource);
    const name = url.split('?')[0].split('/').at(-1)!;
    const payload = artifacts.get(name);
    if (!url.startsWith('/protocol/private-balance/v1/') || !payload) throw new Error('Synthetic network forbids network transport');
    return new Response(payload.slice().buffer);
  };
  const restore = () => {
    Object.assign(archivePrototype, saved.archive); Object.assign(rpcPrototype, saved.rpc);
    globalThis.fetch = saved.fetch; HorizonStealthAnnouncementReader.prototype.readPage = saved.stealth;
  };

  const load = async (name: ActorName) => {
    const state = await loadPrivateBalanceState(actor(name).scope, actor(name).storageKey, driver);
    if (!state) throw new Error(`Synthetic ${name} state missing`);
    return state;
  };
  const syncActor = async (name: ActorName) => {
    const current = actor(name);
    return syncPrivateBalance({ archive, contextHash, deploymentBindingHash: base.deploymentBindingHash, manifestHash: '09'.repeat(32),
      storageContext: current.scope, storageKey: current.storageKey, storageDriver: driver, publicCacheDriver: driver,
      worker: { scanPage: input => scanArchiveRecords({ ...input, viewingKey: toViewingKey(current.esk), context: current.scanContext }) } });
  };
  const sync = async (only?: ActorName) => { for (const name of only ? [only] : ACTORS) await syncActor(name); };

  const workerFor = (name: ActorName, mode: PrepareMode, capture: (built: Awaited<ReturnType<typeof preparePrivateAction>>) => void) => {
    const current = actor(name);
    return {
      deriveAddressForDiversifier: async (diversifier: Uint8Array) => {
        const identity = await deriveDiversifiedAddressKeys(current.esk.baseOwnerCommitment, current.esk.hpkePrivateKey, diversifier);
        return { address: encodePrivateAddress({ deploymentTag: derivePrivateAddressDeploymentTag(base.deploymentBindingHash), diversifier,
          ownerCommitment: identity.ownerCommitment, hpkePublicKey: identity.hpkePublicKey }, 'tskpay_') };
      },
      buildAction: async (...[reservationId, intent, merklePaths, availableNotes]: Parameters<PrivateBalanceWorkerClient['buildAction']>) => {
        const built = await preparePrivateAction({ esk: current.esk, keyContext: current.keyContext, intent, merklePaths, availableNotes });
        capture(built);
        return { messageVersion: 1, id: 'synthetic', sessionId: 'synthetic', type: 'ACTION_PREPARED', reservationId,
          preparedActionId: 'synthetic-prepared', ...built, actionFieldHex: hex(built.actionField) };
      },
      generateProof: async () => {
        if (mode === 'proof-failure') throw new Error('Synthetic prover failure');
        return { messageVersion: 1, id: 'synthetic', sessionId: 'synthetic', type: 'PROOF_OK',
          proof: { pi_a: [], pi_b: [], pi_c: [], protocol: 'groth16', curve: 'bn128' }, publicSignals: [], sorobanProofHex: '01'.repeat(256) };
      },
    } as unknown as PrivateBalanceWorkerClient;
  };

  /** Prepares through the real flow; onBuilt can inspect a captured action after preparation fails. */
  const prepare = async (name: ActorName, draft: PrivateActionDraft, options: { mode?: PrepareMode;
    authorize?: AuthorizePrivateProofDisclosure; recoveryActionId?: string; signal?: AbortSignal;
    /** Receives a handle for an action whose proof was shared even though preparation then failed. */
    onBuilt?: (handle: ActionHandle) => void } = {}) => {
    const mode = options.mode ?? 'approve';
    const sender = actor(name);
    let built: Awaited<ReturnType<typeof preparePrivateAction>> | undefined;
    const preparation = { mode };
    const flow = () => preparePrivateBalanceActionFlow({ manifest, accountPublicKey: sender.publicKey, privateAddress: sender.address,
      storageContext: sender.scope, storageKey: sender.storageKey, storageDriver: driver,
      worker: workerFor(name, mode, value => { built = value; }), rpcUrl: 'http://127.0.0.1:1', classicFeeStroops: 100n,
      assetContractId, assetIndex: 0, registryAssets: base.assets, assetCode: 'XLM', assetDecimals: 7,
      draft, recoveryActionId: options.recoveryActionId, signal: options.signal,
      authorizeDisclosure: async request => {
        if (mode === 'cancel') throw new DOMException('Synthetic consent cancelled', 'AbortError');
        await options.authorize?.(request);
        if (mode === 'consent-expired') throw new Error('Synthetic proof-sharing consent expired');
      } });
    let result: Awaited<ReturnType<typeof preparePrivateBalanceActionFlow>>;
    preparationModes.set(sender.publicKey, preparation);
    try { result = await flow(); } catch (error) {
      const shared = built && (await load(name)).pendingActions.find(action => action.actionField === hex(built!.actionField));
      if (built && options.onBuilt) {
        const pendingId = shared?.id ?? `unreviewed-${handles.size}`;
        const handle: ActionHandle = { id: pendingId, actor: name, kind: draft.kind, review: null, action: built.action,
          amountStroops: draft.kind === 'deposit' || draft.kind === 'transfer' || draft.kind === 'withdraw' ? parsePrivateAmount(draft.amount, 7) : 0n,
          publicRecipient: draft.kind === 'withdraw' ? ACTORS.find(candidate => actor(candidate).publicKey === draft.publicRecipient) ?? null : null,
          transactionHash: null, included: false, failed: false };
        handles.set(handle.id, handle);
        options.onBuilt(handle);
      }
      throw error;
    } finally {
      if (preparationModes.get(sender.publicKey) === preparation) preparationModes.delete(sender.publicKey);
    }
    if (!built) throw new Error('Synthetic builder produced no action');
    const handle: ActionHandle = { id: result.review.id, actor: name, kind: draft.kind, review: result.review,
      action: built.action, amountStroops: BigInt(result.review.amountStroops),
      publicRecipient: draft.kind === 'withdraw' ? ACTORS.find(candidate => actor(candidate).publicKey === draft.publicRecipient) ?? null : null,
      transactionHash: null, included: false, failed: false };
    handles.set(handle.id, handle);
    return handle;
  };

  /** Signs and broadcasts a reviewed action the way the wallet does. */
  const submit = async (handle: ActionHandle, mode: SubmitMode = 'PENDING') => {
    if (mode === 'skip') return null;
    if (!handle.review) throw new Error('Synthetic action was never reviewed');
    const sender = actor(handle.actor);
    const current = await load(handle.actor);
    const signed = await signReviewedPrivateBalanceAction({ context: sender.scope, storageKey: sender.storageKey, expectedRevision: current.revision,
      actionId: handle.id, review: handle.review!.transaction, networkPassphrase: manifest.networkPassphrase, storageDriver: driver,
      sign: async request => {
        if (mode === 'signer-reject') throw new Error('Synthetic signer rejected');
        const transaction = TransactionBuilder.fromXdr(request.envelopeXdr, manifest.networkPassphrase);
        transaction.sign(sender.signer);
        return transaction.toXdr();
      } });
    return broadcastPrivateBalanceAction({ context: sender.scope, storageKey: sender.storageKey, expectedRevision: signed.revision,
      actionId: handle.id, networkPassphrase: manifest.networkPassphrase, submissionMode: 'direct', storageDriver: driver,
      rpc: { sendTransaction: async transaction => {
        submissions++;
        if (mode === 'timeout') throw new Error('Synthetic uncertain RPC outcome');
        const transactionHash = hex(transaction.hash());
        handle.transactionHash = transactionHash;
        hashes.set(transactionHash, handle);
        return { status: mode === 'ERROR' ? 'ERROR' : 'PENDING', hash: transactionHash };
      } } });
  };

  /** The ledger executes the action exactly as built; public balances move; everyone scans. */
  const include = async (handle: ActionHandle, options: { sync?: boolean } = {}) => {
    if (handle.included) throw new Error('Synthetic action already included');
    if (handle.failed) throw new Error('Synthetic action already failed');
    await append(handle.action);
    handle.included = true;
    if (handle.kind === 'deposit') publicBalances.set(handle.actor, publicBalances.get(handle.actor)! - handle.amountStroops);
    if (handle.kind === 'withdraw' && handle.publicRecipient) publicBalances.set(handle.publicRecipient, publicBalances.get(handle.publicRecipient)! + handle.amountStroops);
    if (options.sync !== false) await sync();
  };
  const fail = (handle: ActionHandle) => { if (handle.included) throw new Error('Synthetic action already included'); handle.failed = true; };

  // The head closes "now" as the recovering wallet sees it: time passes on
  // chain without new records, so expiry is decided by the clock, not by
  // the record count.
  const canonicalTranscript = async (name: ActorName, now: number) => {
    await syncActor(name);
    const current = await load(name);
    return { actionFields: current.activities.map(activity => activity.id), nullifiers: current.activities.flatMap(activity => activity.nullifiers),
      headCloseTimeSeconds: seconds(now) };
  };

  /** Runs recovery for every pending action the way an unlock or manual retry does. */
  const recover = async (name: ActorName, options: { now?: number } = {}) => {
    const current = actor(name);
    const now = options.now ?? Date.now();
    await releaseExpiredPrivateBuildReservations(current.scope, current.storageKey, now, undefined, driver);
    await releaseStalePrivatePendingActions(current.scope, current.storageKey, now, undefined, driver);
    await syncActor(name);
    const outcomes: Array<{ id: string; outcome: PrivateRecoveryResult['outcome'] | 'unsubmitted' | 'held'; rpcStatus: PrivateRecoveryResult['rpcStatus'] | null }> = [];
    for (const action of (await load(name)).pendingActions) {
      // Never broadcast by this wallet: only the pre-broadcast sweep above can act on a
      // local-only proof ("unsubmitted"); a spend proof that left the device stays "held".
      if (action.status === 'prepared' || action.status === 'reviewed') {
        const exposed = action.kind !== 'deposit' && action.proofExposure !== 'local';
        outcomes.push({ id: action.id, outcome: exposed ? 'held' : 'unsubmitted', rpcStatus: null }); continue;
      }
      const result = await recoverPrivateBalanceAction({ context: current.scope, storageKey: current.storageKey, actionId: action.id,
        storageDriver: driver, networkPassphrase: manifest.networkPassphrase, now: () => now,
        rpc: { getTransaction: async transactionHash => {
          const handle = hashes.get(transactionHash);
          rpcLookups++;
          return { status: handle?.included ? 'SUCCESS' : handle?.failed ? 'FAILED' : 'NOT_FOUND', txHash: transactionHash,
            latestLedgerCloseTime: seconds(now) };
        } },
        scanCanonicalTranscript: () => canonicalTranscript(name, now) });
      outcomes.push({ id: action.id, outcome: result.outcome, rpcStatus: result.rpcStatus });
    }
    return outcomes;
  };

  const balances = async (name: ActorName): Promise<ActorBalances> => {
    const state = await load(name);
    const sum = (status: string) => state.notes.filter(note => note.status === status).reduce((total, note) => total + BigInt(note.value), 0n);
    const spendable = sum('unspent');
    const reserved = sum('reserved');
    return { spendable, reserved, shielded: spendable + reserved, public: publicBalances.get(name)!, pending: state.pendingActions.length,
      reservedNotes: state.notes.filter(note => note.status === 'reserved').length };
  };

  /** Rebuilds every wallet's view from its seed and the canonical archive alone. */
  const freshScan = async (name: ActorName) => {
    const current = actor(name);
    const scanned = await scanArchiveRecords({ records, viewingKey: toViewingKey(current.esk), context: current.scanContext,
      expectedPriorRecordHash: computeGenesisRecordHash(contextHash, base.deploymentBindingHash) });
    return scanned.notes.filter(note => note.status === 'unspent').reduce((total, note) => total + BigInt(note.value), 0n);
  };

  /** Loses every local record for one wallet (a reinstall) and rebuilds it from the seed and the archive alone. */
  const forget = async (name: ActorName) => {
    const current = actor(name);
    await clearShieldedState(current.scope, driver);
    await clearPrivateBalanceCommitmentCache(current.scope, driver);
    await clearPrivateBalanceMerkleCache(current.scope, driver);
    const state = createEmptyPrivateBalanceState('09'.repeat(32));
    state.outgoingHistoryMode = options.outgoingHistory ?? 'recoverable';
    await commitPrivateBalanceState(current.scope, current.storageKey, state, null, driver);
    await syncActor(name);
  };

  // Every wallet verifies the empty pool first: actions need a checkpoint.
  await sync();

  return {
    manifest, driver, actors, records,
    get submissions() { return submissions; }, get simulations() { return simulations; }, get rpcLookups() { return rpcLookups; },
    address: (name: ActorName) => actor(name).address,
    publicKey: (name: ActorName) => actor(name).publicKey,
    pauseDeposits(paused: boolean) { depositsPaused = paused; },
    state: load, sync, prepare, submit, include, fail, recover, balances, freshScan, forget, restore,
    /** Prepare, sign and broadcast in one step; `mode` controls the RPC answer. */
    async send(name: ActorName, draft: PrivateActionDraft, options: { prepare?: PrepareMode; submit?: SubmitMode } = {}) {
      const handle = await prepare(name, draft, { mode: options.prepare });
      await submit(handle, options.submit ?? 'PENDING');
      return handle;
    },
    /** Public and shielded value across every wallet; only withdrawals and deposits move between the two. */
    async totals() {
      let shielded = 0n, publicTotal = 0n, reserved = 0n, pending = 0;
      for (const name of ACTORS) {
        const current = await balances(name);
        shielded += current.shielded; publicTotal += current.public; reserved += current.reserved; pending += current.pending;
      }
      return { shielded, public: publicTotal, reserved, pending, everything: shielded + publicTotal, initial: initialPublic * BigInt(ACTORS.length) };
    },
    /** Every wallet's durable view must equal a fresh seed-plus-archive scan, and nothing may be reserved or pending. */
    async assertSettled() {
      const problems: string[] = [];
      for (const name of ACTORS) {
        const current = await balances(name);
        const scanned = await freshScan(name);
        if (current.reserved !== 0n) problems.push(`${name} still reserves ${format(current.reserved)}`);
        if (current.pending !== 0) problems.push(`${name} still has ${current.pending} pending action(s)`);
        if (current.spendable !== scanned) problems.push(`${name} durable ${format(current.spendable)} differs from fresh scan ${format(scanned)}`);
      }
      const total = await this.totals();
      if (total.everything !== total.initial) problems.push(`value drifted: ${format(total.everything)} of ${format(total.initial)}`);
      if (problems.length) throw new Error(`Synthetic network is not settled: ${problems.join('; ')}`);
    },
  };
}

export type PrivatePaymentsNetwork = Awaited<ReturnType<typeof createPrivatePaymentsNetwork>>;
