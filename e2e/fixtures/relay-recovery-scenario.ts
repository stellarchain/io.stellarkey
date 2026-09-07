// TEST ONLY: non-usable deployment, no network, no valid spend proofs.
// Production preparation, encryption, storage, signing classification and scan
// run unchanged. The worker bridge invokes the real builder/scanner; only the
// prover, archive transport and helper/RPC responses are controlled here.
import { Account, Keypair, SorobanDataBuilder, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
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
import type { PrivateBalanceWorkerClient } from '../../src/features/private-balance/worker/client';
import { scanArchiveRecords } from '../../src/features/private-balance/runtime/scanner';
import { syncPrivateBalance } from '../../src/features/private-balance/runtime/sync-machine';
import { commitPrivateBalanceState, createEmptyPrivateBalanceState, loadPrivateBalanceState,
  releaseExpiredPrivateBuildReservations, releaseStalePrivatePendingActions } from '../../src/features/private-balance/runtime/storage';
import { broadcastPrivateBalanceAction, recoverPrivateBalanceAction, signReviewedPrivateBalanceAction } from '../../src/features/private-balance/runtime/submission';
import { parsePrivateAmount } from '../../src/features/private-balance/runtime/coin-selection';
import { selectTotalShieldedBalance } from '../../src/features/private-balance/runtime/selectors';
import type { PrivateBalanceDurableState } from '../../src/features/private-balance/runtime/types';
import type { AuthorizePrivateProofDisclosure } from '../../src/features/private-balance/runtime/proof-disclosure';

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
const scopeFor = (manifest: PrivateBalanceManifest, name: typeof names[number]) => ({ accountId: `synthetic-relay-recovery-${name}`,
  networkId: manifest.networkId, realmId: manifest.realmId, poolId: hex(new Uint8Array(StrKey.decodeContract(manifest.poolContractId))),
  deploymentBindingHash: manifest.deploymentBindingHash });

export async function readRelayRecoveryBalances(manifest: PrivateBalanceManifest, driver: EncryptedRecordDriver) {
  const states = await Promise.all(names.map(name => loadPrivateBalanceState(scopeFor(manifest, name), keyFor(name), driver)));
  if (states.some(state => !state)) throw new Error('Synthetic scenario has not been seeded');
  const [bob, alice, charlie] = states as PrivateBalanceDurableState[];
  return { bob: format(selectTotalShieldedBalance(bob)),
    reserved: format(bob.notes.filter(note => note.status === 'reserved').reduce((sum, note) => sum + BigInt(note.value), 0n)),
    alice: format(selectTotalShieldedBalance(alice)), charlie: format(selectTotalShieldedBalance(charlie)), pending: bob.pendingActions.length };
}

export type PrepareMode = 'approve' | 'cancel' | 'proof-failure' | 'quote-expired' | 'helper-reject' | 'helper-timeout';
export type SubmitMode = 'PENDING' | 'ERROR' | 'timeout' | 'signer-reject';

export async function createRelayRecoveryScenario(development: PrivateBalanceManifest, driver: EncryptedRecordDriver,
  options: { deposits?: string[]; amount?: string; outgoingHistory?: 'recoverable' | 'minimized' } = {}) {
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
    const accountPublicKey = bytes(11 + index);
    const keyContext = { ...base, accountPublicKey, contextField };
    const esk = await deriveExpandedSpendingKey(new Uint8Array(64).fill(21 + index), 1, base.networkId, base.realmId, base.poolId, accountPublicKey, contextField);
    // Alice's fee lane must use Charlie's recipient diversifier, exactly as
    // the real helper quote binds it; ownership keys remain independent.
    const diversifier = Uint8Array.of(0, 0, 0, name === 'alice' ? 3 : index + 1);
    const identity = await deriveDiversifiedAddressKeys(esk.baseOwnerCommitment, esk.hpkePrivateKey, diversifier);
    const address = encodePrivateAddress({ deploymentTag: derivePrivateAddressDeploymentTag(base.deploymentBindingHash), diversifier,
      ownerCommitment: identity.ownerCommitment, hpkePublicKey: identity.hpkePublicKey }, 'tskpay_');
    const state = createEmptyPrivateBalanceState('09'.repeat(32));
    state.outgoingHistoryMode = options.outgoingHistory ?? 'recoverable';
    const scope = scopeFor(manifest, name);
    // Refuse to overwrite a scenario: browser reload must inspect real storage.
    if (await loadPrivateBalanceState(scope, keyFor(name), driver)) throw new Error('Synthetic scenario already exists');
    await commitPrivateBalanceState(scope, keyFor(name), state, null, driver);
    return { name, esk, keyContext, address, scope, storageKey: keyFor(name),
      scanContext: { ...base, contextHash, contextField, accountAddress: { kind: 0, payload: accountPublicKey } } };
  }));
  const [bob, alice, charlie] = actors;
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
  let confirmed = false;
  let shared = 0;
  let submissions = 0;
  let senderLookups = 0;
  const stages: string[] = [];
  const helperSigner = Keypair.fromRawEd25519Seed(bytes(42));
  const loadBob = async () => {
    const state = await loadPrivateBalanceState(bob.scope, bob.storageKey, driver);
    if (!state) throw new Error('Synthetic Bob state missing');
    return state;
  };
  return {
    get shared() { return shared; }, get submissions() { return submissions; },
    get senderLookups() { return senderLookups; }, get stages() { return [...stages]; },
    get review() { return review ?? null; },
    draft: { kind: 'transfer' as const, amount, recipientAddress: charlie.address },
    async journal() {
      const state = await loadBob();
      return { builds: state.buildReservations.length, pending: state.pendingActions.map(action => ({ status: action.status,
        exposure: action.proofExposure, attempts: action.broadcastAttempts, rpc: action.latestRpcStatus ?? null,
        hasEnvelope: !!action.signedEnvelopeXdr })) };
    },
    balances: () => readRelayRecoveryBalances(manifest, driver), sync,
    async prepare(mode: PrepareMode, authorize?: AuthorizePrivateProofDisclosure) {
      const originalHead = PrivateBalanceArchiveClient.prototype.readHead;
      const originalPaused = PrivateBalanceArchiveClient.prototype.readDepositsPaused;
      const originalFetch = globalThis.fetch;
      const expiresAt = Math.floor(Date.now() / 1000) + 240;
      stages.length = 0;
      const relayPreparation = { expiresAt, prepare: async (request: { operationXdr: string; maxTime: number; classicFeeStroops: string }) => {
        shared++;
        if (mode === 'helper-reject') throw new Error('Synthetic helper rejected preparation');
        if (mode === 'helper-timeout') throw new Error('Synthetic helper preparation timed out');
        const transaction = new TransactionBuilder(new Account(helperSigner.publicKey(), '7'), { fee: request.classicFeeStroops,
          networkPassphrase: manifest.networkPassphrase, timebounds: { minTime: 0, maxTime: request.maxTime } })
          .addOperation(xdr.Operation.fromXDR(request.operationXdr, 'base64'))
          .setSorobanData(new SorobanDataBuilder().setResourceFee('500').build()).build();
        return { preparedEnvelopeXdr: transaction.toXdr(), accountSequence: '7', simulationLedger: 100 + records.length };
      } };
      let built: Awaited<ReturnType<typeof preparePrivateAction>> | undefined;
      // No Worker thread/prover is claimed here. The real action builder runs
      // in-process against exactly the notes/paths supplied by the real flow.
      const worker = {
        buildAction: async (reservationId, intent, merklePaths, availableNotes) => {
          built = await preparePrivateAction({ esk: bob.esk, keyContext: bob.keyContext, intent, merklePaths, availableNotes });
          return { messageVersion: 1, id: 'synthetic', sessionId: 'synthetic', type: 'ACTION_PREPARED', reservationId,
            preparedActionId: 'synthetic-prepared', ...built, actionFieldHex: hex(built.actionField) };
        },
        generateProof: async () => {
          if (mode === 'proof-failure') throw new Error('Synthetic prover failure');
          return { messageVersion: 1, id: 'synthetic', sessionId: 'synthetic', type: 'PROOF_OK',
            proof: { pi_a: [], pi_b: [], pi_c: [], protocol: 'groth16', curve: 'bn128' }, publicSignals: [], sorobanProofHex: '01'.repeat(256) };
        },
      } satisfies Pick<PrivateBalanceWorkerClient, 'buildAction' | 'generateProof'>;
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
          draft: { kind: 'transfer', amount, recipientAddress: charlie.address, relay: { feeAtomic: '30000000', privateFeeAddress: alice.address,
            sourceAccount: helperSigner.publicKey(), requestId: '51'.repeat(32), quoteId: '52'.repeat(32), peerPublicKey: '53'.repeat(32) } },
          relayPreparation, onProgress: stage => { stages.push(stage); }, authorizeDisclosure: async request => {
            if (mode === 'cancel') throw new DOMException('Synthetic consent cancelled', 'AbortError');
            await authorize?.(request);
            if (mode === 'quote-expired') relayPreparation.expiresAt = Math.floor(Date.now() / 1000) - 1;
            // This is only a test ledger input; it can be appended after the
            // production journal establishes proof disclosure, never before.
            sharedAction = built?.action;
          } });
        review = result.review;
      } finally {
        PrivateBalanceArchiveClient.prototype.readHead = originalHead;
        PrivateBalanceArchiveClient.prototype.readDepositsPaused = originalPaused;
        globalThis.fetch = originalFetch;
      }
    },
    async submit(mode: SubmitMode) {
      if (!review) throw new Error('Synthetic review missing');
      const current = await loadBob();
      const signed = await signReviewedPrivateBalanceAction({ context: bob.scope, storageKey: bob.storageKey, expectedRevision: current.revision,
        actionId: review.id, review: review.transaction, networkPassphrase: manifest.networkPassphrase, storageDriver: driver,
        sign: async request => {
          if (mode === 'signer-reject') throw new Error('Synthetic Alice rejected signing');
          const transaction = TransactionBuilder.fromXdr(request.envelopeXdr, manifest.networkPassphrase);
          transaction.sign(helperSigner); return transaction.toXdr();
        } });
      return broadcastPrivateBalanceAction({ context: bob.scope, storageKey: bob.storageKey, expectedRevision: signed.revision,
        actionId: review.id, networkPassphrase: manifest.networkPassphrase, submissionMode: 'relay', storageDriver: driver,
        rpc: { sendTransaction: async transaction => {
          submissions++;
          if (mode === 'timeout') throw new Error('Synthetic uncertain relay RPC outcome');
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
        rpc: { getTransaction: async () => { senderLookups++; throw new Error('Synthetic relay must never disclose a hash to sender RPC'); } },
        scanCanonicalTranscript: async () => {
          await sync(); const current = await loadBob();
          return { actionFields: current.activities.map(activity => activity.id), nullifiers: current.activities.flatMap(activity => activity.nullifiers),
            headCloseTimeSeconds: Math.floor(future / 1000) };
        } });
    },
    async confirm() {
      if (!sharedAction || !shared) throw new Error('Cannot include a proof that was never shared');
      if (!confirmed) { await append(sharedAction); confirmed = true; }
      await sync();
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
