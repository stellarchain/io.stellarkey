import {
  Address,
  StrKey,
  contract,
  rpc as SorobanRpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {
  computeAssetField,
  computeContextField,
  computeContextHash,
  TREE_FRONTIER_SIZE,
  type ArchiveRecordModel,
} from '@stellarkey/private-balance';
import type { PrivateBalanceManifest } from '../../../lib/private-balance-manifest';

// One getLedgers range read covers at most this many ledgers (the RPC's own
// per-request page cap); sequences further apart start a fresh batch.
const MAX_LEDGER_CLOSE_TIME_BATCH_SPAN = 200;
const MAX_LEDGER_CLOSE_TIME_CONCURRENCY = 4;
export const MAX_ARCHIVE_RECORD_BATCH = 200;

interface ArchiveManifest extends Pick<
  PrivateBalanceManifest,
  | 'protocolVersion'
  | 'networkPassphrase'
  | 'networkId'
  | 'realmId'
  | 'poolContractId'
  | 'assetAdminAddress'
  | 'deploymentBindingHash'
> {
  artifacts: Pick<PrivateBalanceManifest['artifacts'], 'r1csSha256' | 'vkBinSha256'>;
  constants: Pick<PrivateBalanceManifest['constants'], 'treeDepth'>;
}

interface ArchiveRpc {
  getNetwork(): Promise<{ passphrase: string }>;
  getHealth(): Promise<{ oldestLedger: number }>;
  getLatestLedger(): Promise<{ sequence: number }>;
  queryContract<T>(
    contractId: string,
    method: string,
    args?: Record<string, unknown>,
    networkPassphrase?: string,
  ): Promise<{ result: T; isReadCall: boolean }>;
  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<{
    entries: Array<{
      key: xdr.LedgerKey;
      val: xdr.LedgerEntryData;
      liveUntilLedgerSeq?: number;
    }>;
    latestLedger: number;
  }>;
  getLedgers(request: {
    startLedger: number;
    pagination?: { limit?: number };
  }): Promise<{
    ledgers: Array<{ sequence: number; ledgerCloseTime: string; hash?: string }>;
  }>;
}

interface PrivateContractInvocation {
  result: unknown;
  isReadCall: boolean;
  simulation?: SorobanRpc.Api.SimulateTransactionResponse;
}

interface PrivateContractClient {
  [method: string]: unknown;
}

interface PrivateContractClientFactoryInput {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  server: ArchiveRpc;
}

type PrivateContractClientFactory = (
  input: PrivateContractClientFactoryInput,
) => Promise<PrivateContractClient>;

/**
 * Protocol 23+ puts auto-restored entries in the write footprint, even for a
 * getter. The SDK's isReadCall therefore rejects an otherwise read-only call.
 * Accept only a complete restoration list with no auth or other changes, and
 * corroborate each simulated value against its unchanged archived ledger data.
 * This never restores anything on-chain and never caches restoration evidence.
 */
async function isUnchangedArchivedRead(
  response: PrivateContractInvocation,
  server: ArchiveRpc,
): Promise<boolean> {
  const simulation = response.simulation;
  if (!simulation || !SorobanRpc.Api.isSimulationSuccess(simulation)) return false;
  if (!simulation.result || simulation.result.auth.length !== 0) return false;
  if (!Number.isSafeInteger(simulation.latestLedger) || simulation.latestLedger <= 0) return false;
  const data = simulation.transactionData.build();
  const writes = data.resources.footprint.readWrite;
  const changes = simulation.stateChanges;
  if (
    writes.length === 0 || writes.length > MAX_ARCHIVE_RECORD_BATCH
    || data.ext.type !== 'resourceExt'
    || data.ext.resourceExt.archivedSorobanEntries.length !== writes.length
    || data.ext.resourceExt.archivedSorobanEntries.some((index, position) => index !== position)
    || !changes || changes.length !== writes.length
    || writes.some(key => key.type !== 'contractCode' && (
      key.type !== 'contractData' || key.contractData.durability.name !== 'persistent'
    ))
  ) return false;

  const writeKeys = writes.map(key => key.toXdr());
  const changeIndices = changes.map(change => writeKeys.findIndex(key => equalBytes(key, change.key.toXdr())));
  if (
    changeIndices.includes(-1) || new Set(changeIndices).size !== writes.length
    || changes.some(change => change.before !== null || !change.after)
  ) return false;

  const ledger = await server.getLedgerEntries(...writes);
  if (
    !Number.isSafeInteger(ledger.latestLedger) || ledger.latestLedger < simulation.latestLedger
    || ledger.entries.length !== writes.length
  ) return false;
  const seen = new Set<number>();
  for (const entry of ledger.entries) {
    const index = writeKeys.findIndex(key => equalBytes(key, entry.key.toXdr()));
    const after = changes[changeIndices.indexOf(index)]?.after;
    if (
      index < 0 || seen.has(index) || !after
      || !Number.isSafeInteger(entry.liveUntilLedgerSeq)
      || entry.liveUntilLedgerSeq! < 0 || entry.liveUntilLedgerSeq! >= simulation.latestLedger
      || !equalBytes(entry.val.toXdr(), after.data.toXdr())
    ) return false;
    seen.add(index);
  }
  return true;
}

/**
 * Loading an untyped SDK contract client fetches the contract instance and
 * Wasm specification. Reusing that client avoids repeating those public RPC
 * reads for every head, registry, and token-metadata method while preserving
 * a fresh simulation for every actual call.
 */
export function createCachedPrivateContractQuery(input: {
  rpcUrl: string;
  server: ArchiveRpc;
  createClient?: PrivateContractClientFactory;
}): ArchiveRpc['queryContract'] {
  const clients = new Map<string, Promise<PrivateContractClient>>();
  const createClient = input.createClient ?? (async options => (
    contract.Client.from({
      contractId: options.contractId,
      rpcUrl: options.rpcUrl,
      networkPassphrase: options.networkPassphrase,
      server: options.server as SorobanRpc.Server,
    }) as Promise<PrivateContractClient>
  ));

  return async <T>(
    contractId: string,
    method: string,
    args?: Record<string, unknown>,
    networkPassphrase?: string,
  ): Promise<{ result: T; isReadCall: boolean }> => {
    if (!networkPassphrase) {
      throw new Error('Private Balance contract query requires a network passphrase');
    }
    const cacheKey = `${networkPassphrase}\u0000${contractId}`;
    let clientPromise = clients.get(cacheKey);
    if (!clientPromise) {
      clientPromise = createClient({
        contractId,
        rpcUrl: input.rpcUrl,
        networkPassphrase,
        server: input.server,
      });
      clients.set(cacheKey, clientPromise);
    }
    let client: PrivateContractClient;
    try {
      client = await clientPromise;
    } catch (error) {
      if (clients.get(cacheKey) === clientPromise) clients.delete(cacheKey);
      throw error;
    }
    const invoke = client[method];
    if (typeof invoke !== 'function') {
      throw new Error(`Private Balance contract has no method '${method}'`);
    }
    const methodOptions = { restore: false };
    const response = await (args === undefined
      ? invoke.call(client, methodOptions)
      : invoke.call(client, args, methodOptions)) as PrivateContractInvocation;
    if (!response || typeof response.isReadCall !== 'boolean') {
      throw new Error(`Private Balance contract method '${method}' returned an invalid response`);
    }
    const isReadCall = response.isReadCall || await isUnchangedArchivedRead(response, input.server);
    // Do not expose the SDK transaction or its sign/send methods to readers.
    return { result: response.result as T, isReadCall };
  };
}

interface PoolConfigState {
  protocolVersion: number;
  networkId: Uint8Array;
  realmId: Uint8Array;
  guardian: string;
  initialAssetAdmin: string;
  poseidon2ParameterHash: Uint8Array;
  circuitHash: Uint8Array;
  verificationKeyHash: Uint8Array;
  treeDepth: number;
  rootWindowLedgers: number;
  deploymentBindingHash: Uint8Array;
  contextHash: Uint8Array;
  contextField: Uint8Array;
}

export interface ArchiveMetaState {
  actionCount: number;
  transcriptHead: Uint8Array;
}

export interface ArchiveTreeState {
  nextIndex: number;
  frontier: Uint8Array[];
  currentRoot: Uint8Array;
}

export interface ArchiveHeadState {
  latestLedger: number;
  config: PoolConfigState;
  meta: ArchiveMetaState;
  tree: ArchiveTreeState;
}

export interface KnownRootState {
  createdAtLedger: number;
  validUntilLedger: number;
  liveUntilLedger: number;
  latestLedger: number;
}

export type PrivateAssetRegistryStatus = 'active' | 'exit-only';

export interface PrivateAssetRegistryEntry {
  index: number;
  contractId: string;
  assetField: Uint8Array;
  status: PrivateAssetRegistryStatus;
}

export interface PrivateAssetRegistryState {
  adminAddress: string;
  assets: PrivateAssetRegistryEntry[];
}

export interface PrivateAssetTokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
}

const MAX_PRIVATE_ASSET_REGISTRY_ENTRIES = 256;

export class ArchiveRecordUnavailableError extends Error {
  public readonly actionIndex: number;
  public readonly latestLedger: number;

  constructor(actionIndex: number, latestLedger: number) {
    super(`Private Balance archive record ${actionIndex} is unavailable.`);
    this.name = 'ArchiveRecordUnavailableError';
    this.actionIndex = actionIndex;
    this.latestLedger = latestLedger;
  }
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function u32(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffff_ffff) {
    throw new Error(`${name} must be a u32`);
  }
  return value as number;
}

function u64(value: unknown, name: string): bigint {
  const parsed = typeof value === 'bigint'
    ? value
    : typeof value === 'number' && Number.isSafeInteger(value)
      ? BigInt(value)
      : -1n;
  if (parsed < 0n || parsed > 0xffff_ffff_ffff_ffffn) throw new Error(`${name} must be a u64`);
  return parsed;
}

function bytes(value: unknown, length: number, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new Error(`${name} must be ${length} bytes`);
  }
  return new Uint8Array(value);
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is invalid`);
  return value;
}

function unwrapContractResult(value: unknown, name: string): unknown {
  if (!(value instanceof contract.Ok)) {
    throw new Error(`${name} did not return a successful contract result`);
  }
  return value.unwrap();
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function hex32(value: string, name: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${name} must be 32-byte lowercase hex`);
  return Uint8Array.from(value.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
}

function addressPayload(
  value: unknown,
  name: string,
): { kind: number; payload: Uint8Array } | undefined {
  if (value === null || value === undefined) return undefined;
  const address = string(value, name);
  if (StrKey.isValidEd25519PublicKey(address)) {
    return { kind: 0, payload: new Uint8Array(StrKey.decodeEd25519PublicKey(address)) };
  }
  if (StrKey.isValidContract(address)) {
    return { kind: 1, payload: new Uint8Array(StrKey.decodeContract(address)) };
  }
  throw new Error(`${name} is not a supported Stellar address`);
}

function decodeOutput(value: unknown, name: string): ArchiveRecordModel['outputs'][number] {
  const output = object(value, name);
  return {
    cm: bytes(output.commitment, 32, `${name}.commitment`),
    recipientEnvelope: bytes(output.recipient_envelope, 181, `${name}.recipient_envelope`),
    outgoingEnvelope: bytes(output.outgoing_envelope, 157, `${name}.outgoing_envelope`),
  };
}

function decodeRecord(value: unknown, name: string): ArchiveRecordModel {
  const record = object(value, name);
  const actionKind = u32(record.action_kind, `${name}.action_kind`);
  if (actionKind < 1 || actionKind > 3) throw new Error(`${name}.action_kind is invalid`);
  const asset = addressPayload(record.asset, `${name}.asset`);
  const assetIndex = record.asset_index === null || record.asset_index === undefined
    ? undefined
    : u32(record.asset_index, `${name}.asset_index`);
  const boundaryAction = actionKind !== 2;
  if (boundaryAction !== Boolean(asset) || boundaryAction !== (assetIndex !== undefined)) {
    throw new Error(`${name} asset and index do not match the action kind`);
  }
  if (asset && asset.kind !== 1) throw new Error(`${name}.asset must be a contract address`);
  return {
    actionIndex: u32(record.action_index, `${name}.action_index`),
    ledgerSequence: u32(record.ledger_sequence, `${name}.ledger_sequence`),
    startingLeafIndex: u32(record.starting_leaf_index, `${name}.starting_leaf_index`),
    actionKind,
    assetIndex,
    asset,
    actionNonce: bytes(record.action_nonce, 32, `${name}.action_nonce`),
    anchorRoot: bytes(record.anchor_root, 32, `${name}.anchor_root`),
    treeRootAfter: bytes(record.tree_root_after, 32, `${name}.tree_root_after`),
    nullifiers: [
      bytes(record.nullifier_0, 32, `${name}.nullifier_0`),
      bytes(record.nullifier_1, 32, `${name}.nullifier_1`),
    ],
    outputs: [
      decodeOutput(record.output_0, `${name}.output_0`),
      decodeOutput(record.output_1, `${name}.output_1`),
      decodeOutput(record.output_2, `${name}.output_2`),
    ],
    publicValue: u64(record.public_value, `${name}.public_value`),
    depositSource: addressPayload(record.deposit_source, `${name}.deposit_source`),
    publicRecipient: addressPayload(record.public_recipient, `${name}.public_recipient`),
  };
}

function decodeConfig(value: unknown): PoolConfigState {
  const config = object(value, 'Pool config');
  return {
    protocolVersion: u32(config.protocol_version, 'Pool config protocol_version'),
    networkId: bytes(config.network_id, 32, 'Pool config network_id'),
    realmId: bytes(config.realm_id, 32, 'Pool config realm_id'),
    guardian: string(config.guardian, 'Pool config guardian'),
    initialAssetAdmin: string(config.initial_asset_admin, 'Pool config initial_asset_admin'),
    poseidon2ParameterHash: bytes(config.poseidon2_parameter_hash, 32, 'Pool config poseidon2_parameter_hash'),
    circuitHash: bytes(config.circuit_hash, 32, 'Pool config circuit_hash'),
    verificationKeyHash: bytes(config.verification_key_hash, 32, 'Pool config verification_key_hash'),
    treeDepth: u32(config.tree_depth, 'Pool config tree_depth'),
    rootWindowLedgers: u32(config.root_window_ledgers, 'Pool config root_window_ledgers'),
    deploymentBindingHash: bytes(config.deployment_binding_hash, 32, 'Pool config deployment_binding_hash'),
    contextHash: bytes(config.context_hash, 32, 'Pool config context_hash'),
    contextField: bytes(config.context_field, 32, 'Pool config context_field'),
  };
}

function decodeMeta(value: unknown): ArchiveMetaState {
  const meta = object(value, 'Archive meta');
  return {
    actionCount: u32(meta.action_count, 'Archive meta action_count'),
    transcriptHead: bytes(meta.transcript_head, 32, 'Archive meta transcript_head'),
  };
}

function decodeTree(value: unknown): ArchiveTreeState {
  const tree = object(value, 'Archive tree');
  const nextIndex = u64(tree.next_index, 'Archive tree next_index');
  if (nextIndex > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Archive tree next_index is too large');
  if (!Array.isArray(tree.frontier) || tree.frontier.length !== TREE_FRONTIER_SIZE) {
    throw new Error('Archive tree frontier is invalid');
  }
  return {
    nextIndex: Number(nextIndex),
    frontier: tree.frontier.map((node, index) => bytes(node, 32, `Archive tree frontier ${index}`)),
    currentRoot: bytes(tree.current_root, 32, 'Archive tree current_root'),
  };
}

function decodeAssetStatus(value: unknown, name: string): PrivateAssetRegistryStatus {
  const status = object(value, name);
  if (status.tag === 'Active') return 'active';
  if (status.tag === 'ExitOnly') return 'exit-only';
  throw new Error(`${name} is invalid`);
}

function decodeAssetConfig(value: unknown, expectedIndex: number): PrivateAssetRegistryEntry {
  const config = object(value, `Private asset ${expectedIndex}`);
  const index = u32(config.index, `Private asset ${expectedIndex}.index`);
  if (index !== expectedIndex) throw new Error('Private asset registry index is not canonical');
  const contractId = string(config.asset, `Private asset ${expectedIndex}.asset`);
  if (!StrKey.isValidContract(contractId)) {
    throw new Error(`Private asset ${expectedIndex}.asset is not a contract address`);
  }
  const assetField = bytes(config.asset_field, 32, `Private asset ${expectedIndex}.asset_field`);
  const expectedField = computeAssetField({
    kind: 1,
    payload: new Uint8Array(StrKey.decodeContract(contractId)),
  });
  if (!equalBytes(assetField, expectedField)) {
    throw new Error(`Private asset ${expectedIndex}.asset_field is not canonical`);
  }
  return {
    index,
    contractId,
    assetField,
    status: decodeAssetStatus(config.status, `Private asset ${expectedIndex}.status`),
  };
}

export function deriveArchiveRecordLedgerKey(
  contractId: string,
  actionIndex: number,
): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(contractId).toScAddress(),
      key: xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('ArchiveRecord'),
        xdr.ScVal.scvU32(actionIndex),
      ]),
      durability: xdr.ContractDataDurability.persistent,
    }),
  );
}

export function deriveKnownRootLedgerKey(
  contractId: string,
  root: Uint8Array,
): xdr.LedgerKey {
  if (!(root instanceof Uint8Array) || root.length !== 32 || root.every(byte => byte === 0)) {
    throw new Error('Private Balance anchor root is invalid');
  }
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(contractId).toScAddress(),
      key: xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('KnownRoot'),
        xdr.ScVal.scvBytes(root),
      ]),
      durability: xdr.ContractDataDurability.temporary,
    }),
  );
}

export class PrivateBalanceArchiveClient {
  private readonly server: ArchiveRpc;
  private readonly manifest: ArchiveManifest;
  private readonly queryContract: ArchiveRpc['queryContract'];

  constructor(
    rpcUrl: string,
    manifest: ArchiveManifest,
    server?: ArchiveRpc,
  ) {
    const endpoint = new URL(rpcUrl);
    const localHttp = endpoint.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'https:' && !localHttp) {
      throw new Error('Private Balance RPC requires HTTPS or a loopback development endpoint');
    }
    this.manifest = manifest;
    this.server = server ?? new SorobanRpc.Server(endpoint.toString(), { allowHttp: localHttp });
    this.queryContract = server && typeof server.queryContract === 'function'
      ? server.queryContract.bind(server)
      : createCachedPrivateContractQuery({
          rpcUrl: endpoint.toString(),
          server: this.server,
        });
  }

  public async readNetworkPassphrase(): Promise<string> {
    const network = await this.server.getNetwork();
    if (typeof network.passphrase !== 'string' || network.passphrase.length === 0) {
      throw new Error('Private Balance RPC returned an invalid network identity');
    }
    return network.passphrase;
  }

  public async readLatestLedgerSequence(): Promise<number> {
    const latest = await this.server.getLatestLedger();
    return u32(latest.sequence, 'Latest ledger');
  }

  public async readOldestLedgerSequence(): Promise<number> {
    const health = await this.server.getHealth();
    return u32(health.oldestLedger, 'Oldest retained ledger');
  }

  public async readLedgerIdentity(sequence: number): Promise<{
    sequence: number;
    hash: string;
  }> {
    const requestedSequence = u32(sequence, 'Ledger identity sequence');
    const response = await this.server.getLedgers({
      startLedger: requestedSequence,
      pagination: { limit: 1 },
    });
    if (
      response.ledgers.length !== 1 ||
      response.ledgers[0].sequence !== requestedSequence ||
      typeof response.ledgers[0].hash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(response.ledgers[0].hash)
    ) {
      throw new Error('Private Balance RPC did not return the requested ledger identity');
    }
    return { sequence: requestedSequence, hash: response.ledgers[0].hash };
  }

  public async readHead(): Promise<ArchiveHeadState> {
    const [latest, configCall, metaCall, treeCall] = await Promise.all([
      this.server.getLatestLedger(),
      this.queryContract<unknown>(
        this.manifest.poolContractId,
        'config',
        undefined,
        this.manifest.networkPassphrase,
      ),
      this.queryContract<unknown>(
        this.manifest.poolContractId,
        'archive_meta',
        undefined,
        this.manifest.networkPassphrase,
      ),
      this.queryContract<unknown>(
        this.manifest.poolContractId,
        'tree_state',
        undefined,
        this.manifest.networkPassphrase,
      ),
    ]);
    if (!configCall.isReadCall || !metaCall.isReadCall || !treeCall.isReadCall) {
      throw new Error('Private Balance state query was not read-only');
    }
    const config = decodeConfig(configCall.result);
    const meta = decodeMeta(metaCall.result);
    const tree = decodeTree(treeCall.result);
    this.validateHead(config, meta, tree);
    return { latestLedger: u32(latest.sequence, 'Latest ledger'), config, meta, tree };
  }

  public async readDepositsPaused(): Promise<boolean> {
    const call = await this.queryContract<unknown>(
      this.manifest.poolContractId,
      'deposits_paused',
      undefined,
      this.manifest.networkPassphrase,
    );
    if (!call.isReadCall || typeof call.result !== 'boolean') {
      throw new Error('Private Balance deposit-pause query was not a valid read-only result');
    }
    return call.result;
  }

  public async readAssetRegistry(): Promise<PrivateAssetRegistryState> {
    const [adminCall, countCall] = await Promise.all([
      this.queryContract<unknown>(
        this.manifest.poolContractId,
        'asset_admin',
        undefined,
        this.manifest.networkPassphrase,
      ),
      this.queryContract<unknown>(
        this.manifest.poolContractId,
        'asset_count',
        undefined,
        this.manifest.networkPassphrase,
      ),
    ]);
    if (!adminCall.isReadCall || !countCall.isReadCall) {
      throw new Error('Private asset registry query was not read-only');
    }
    const adminAddress = string(adminCall.result, 'Private asset administrator');
    if (!StrKey.isValidEd25519PublicKey(adminAddress) && !StrKey.isValidContract(adminAddress)) {
      throw new Error('Private asset administrator is not a Stellar address');
    }
    const count = u32(countCall.result, 'Private asset count');
    if (count > MAX_PRIVATE_ASSET_REGISTRY_ENTRIES) {
      throw new Error('Private asset registry exceeds the client safety limit');
    }
    const calls = await Promise.all(Array.from({ length: count }, (_, index) => (
      this.queryContract<unknown>(
        this.manifest.poolContractId,
        'asset',
        { index },
        this.manifest.networkPassphrase,
      )
    )));
    if (calls.some(call => !call.isReadCall)) {
      throw new Error('Private asset registry entry query was not read-only');
    }
    const assets = calls.map((call, index) => decodeAssetConfig(
      unwrapContractResult(call.result, `Private asset ${index}`),
      index,
    ));
    if (new Set(assets.map(asset => asset.contractId)).size !== assets.length) {
      throw new Error('Private asset registry contains a duplicate contract');
    }
    return { adminAddress, assets };
  }

  public async readAssetTokenMetadata(contractId: string): Promise<PrivateAssetTokenMetadata> {
    if (!StrKey.isValidContract(contractId)) {
      throw new Error('Private Balance asset contract is invalid');
    }
    const [nameCall, symbolCall, decimalsCall] = await Promise.all([
      this.queryContract<unknown>(
        contractId,
        'name',
        undefined,
        this.manifest.networkPassphrase,
      ),
      this.queryContract<unknown>(
        contractId,
        'symbol',
        undefined,
        this.manifest.networkPassphrase,
      ),
      this.queryContract<unknown>(
        contractId,
        'decimals',
        undefined,
        this.manifest.networkPassphrase,
      ),
    ]);
    if (!nameCall.isReadCall || !symbolCall.isReadCall || !decimalsCall.isReadCall) {
      throw new Error('Private asset metadata query was not read-only');
    }
    const name = string(nameCall.result, 'Private asset name');
    const symbol = string(symbolCall.result, 'Private asset symbol');
    const decimals = u32(decimalsCall.result, 'Private asset decimals');
    if (
      name.length > 64
      || symbol.length > 12
      || decimals > 18
      || /[\u0000-\u001f\u007f]/u.test(name)
      || /[\u0000-\u001f\u007f]/u.test(symbol)
    ) {
      throw new Error('Private asset metadata exceeds client limits');
    }
    return { name, symbol, decimals };
  }

  public async readAssetBalance(assetContractId: string, accountPublicKey: string): Promise<bigint> {
    if (!StrKey.isValidContract(assetContractId)) {
      throw new Error('Private Balance asset contract is invalid');
    }
    const call = await this.queryContract<unknown>(
      assetContractId,
      'balance',
      { id: accountPublicKey },
      this.manifest.networkPassphrase,
    );
    if (!call.isReadCall || typeof call.result !== 'bigint' || call.result < 0n) {
      throw new Error('Private Balance asset balance query was not a valid read-only result');
    }
    return call.result;
  }

  public async readKnownRoot(root: Uint8Array): Promise<KnownRootState> {
    const response = await this.server.getLedgerEntries(
      deriveKnownRootLedgerKey(this.manifest.poolContractId, root),
    );
    if (response.entries.length !== 1) {
      throw new Error('Private Balance anchor root is unknown or expired');
    }
    const entry = response.entries[0];
    if (entry.val.type !== 'contractData') {
      throw new Error('Private Balance anchor root entry is invalid');
    }
    const value = object(scValToNative(entry.val.contractData.val), 'Known root');
    const createdAtLedger = u32(value.created_at_ledger, 'Known root created_at_ledger');
    const validUntilLedger = u32(value.valid_until_ledger, 'Known root valid_until_ledger');
    const liveUntilLedger = u32(entry.liveUntilLedgerSeq, 'Known root liveUntilLedgerSeq');
    const latestLedger = u32(response.latestLedger, 'Known root latest ledger');
    if (
      validUntilLedger < createdAtLedger ||
      liveUntilLedger < validUntilLedger ||
      latestLedger > validUntilLedger
    ) {
      throw new Error('Private Balance anchor root is expired or inconsistent');
    }
    return { createdAtLedger, validUntilLedger, liveUntilLedger, latestLedger };
  }

  /**
   * Resolves ledger close times (unix seconds) for the requested sequences.
   * Near-contiguous sequences batch into single getLedgers range reads, and
   * sparse ranges use bounded concurrency instead of blocking setup on each
   * round-trip in series. Sequences outside RPC retention (or missing from a
   * short range response) are silently omitted so callers keep their
   * zero-timestamp fallback for them.
   */
  public async readLedgerCloseTimes(
    sequences: readonly number[],
  ): Promise<Record<number, number>> {
    const unique = [...new Set(sequences.map(sequence => u32(sequence, 'Ledger sequence')))]
      .sort((left, right) => left - right);
    const closedAt: Record<number, number> = {};
    const ranges: Array<{ start: number; end: number; wanted: Set<number> }> = [];
    let index = 0;
    while (index < unique.length) {
      const start = unique[index];
      let end = index;
      while (
        end + 1 < unique.length &&
        unique[end + 1] - start < MAX_LEDGER_CLOSE_TIME_BATCH_SPAN
      ) {
        end += 1;
      }
      ranges.push({
        start,
        end: unique[end],
        wanted: new Set(unique.slice(index, end + 1)),
      });
      index = end + 1;
    }

    let nextRange = 0;
    const readRange = async () => {
      while (nextRange < ranges.length) {
        const range = ranges[nextRange];
        nextRange += 1;
        const { start, end, wanted } = range;
        try {
          const response = await this.server.getLedgers({
            startLedger: start,
            pagination: { limit: end - start + 1 },
          });
          for (const ledger of response.ledgers) {
            if (!wanted.has(ledger.sequence)) continue;
            if (!/^(?:0|[1-9][0-9]*)$/.test(String(ledger.ledgerCloseTime))) continue;
            const closeTime = Number(ledger.ledgerCloseTime);
            if (!Number.isSafeInteger(closeTime) || closeTime <= 0) continue;
            closedAt[ledger.sequence] = closeTime;
          }
        } catch {
          // Outside retention or transiently unavailable; keep the fallback.
        }
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(MAX_LEDGER_CLOSE_TIME_CONCURRENCY, ranges.length) },
      readRange,
    ));
    return closedAt;
  }

  public async readRecords(
    startActionIndex: number,
    count: number,
  ): Promise<ArchiveRecordModel[]> {
    const start = u32(startActionIndex, 'Archive start action index');
    const validCount = u32(count, 'Archive record count');
    if (validCount < 1 || validCount > MAX_ARCHIVE_RECORD_BATCH) {
      throw new Error(`Archive record count must be between 1 and ${MAX_ARCHIVE_RECORD_BATCH}`);
    }
    if (start + validCount - 1 > 0xffff_ffff) {
      throw new Error('Archive record range exceeds u32');
    }
    const expectedKeys = Array.from({ length: validCount }, (_, offset) =>
      deriveArchiveRecordLedgerKey(this.manifest.poolContractId, start + offset));
    const expectedIndices = new Map(expectedKeys.map((key, offset) => [
      key.toXDR('base64'),
      start + offset,
    ]));
    const response = await this.server.getLedgerEntries(...expectedKeys);
    const latestLedger = u32(response.latestLedger, 'Archive response latest ledger');
    const entriesByIndex = new Map<number, (typeof response.entries)[number]>();
    for (const entry of response.entries) {
      const actionIndex = expectedIndices.get(entry.key.toXDR('base64'));
      if (actionIndex === undefined || entriesByIndex.has(actionIndex)) {
        throw new Error('RPC returned an unexpected or duplicate archive record key');
      }
      if (entry.liveUntilLedgerSeq !== undefined) {
        const liveUntilLedger = u32(
          entry.liveUntilLedgerSeq,
          `Archive record ${actionIndex} liveUntilLedgerSeq`,
        );
        if (liveUntilLedger === 0) continue;
      }
      entriesByIndex.set(actionIndex, entry);
    }
    const missingActionIndex = expectedKeys.findIndex(
      (_key, offset) => !entriesByIndex.has(start + offset),
    );
    if (missingActionIndex !== -1) {
      throw new ArchiveRecordUnavailableError(start + missingActionIndex, latestLedger);
    }
    return expectedKeys.map((_key, offset) => {
      const actionIndex = start + offset;
      const entry = entriesByIndex.get(actionIndex);
      if (!entry) {
        throw new ArchiveRecordUnavailableError(actionIndex, latestLedger);
      }
      if (entry.val.type !== 'contractData') {
        throw new Error('RPC returned a non-contract archive entry');
      }
      const record = decodeRecord(
        scValToNative(entry.val.contractData.val),
        `Archive record ${actionIndex}`,
      );
      if (record.actionIndex !== actionIndex) {
        throw new Error('RPC returned an archive record under the wrong storage key');
      }
      return record;
    });
  }

  private validateHead(
    config: PoolConfigState,
    meta: ArchiveMetaState,
    tree: ArchiveTreeState,
  ): void {
    const networkId = hex32(this.manifest.networkId, 'Manifest network ID');
    const realmId = hex32(this.manifest.realmId, 'Manifest realm ID');
    const poolId = new Uint8Array(StrKey.decodeContract(this.manifest.poolContractId));
    const contextHash = computeContextHash(
      this.manifest.protocolVersion,
      networkId,
      realmId,
      poolId,
    );
    if (
      config.protocolVersion !== this.manifest.protocolVersion ||
      !equalBytes(config.networkId, networkId) ||
      !equalBytes(config.realmId, realmId) ||
      config.treeDepth !== this.manifest.constants.treeDepth ||
      config.initialAssetAdmin !== this.manifest.assetAdminAddress ||
      !equalBytes(
        config.deploymentBindingHash,
        hex32(this.manifest.deploymentBindingHash, 'Manifest deployment binding hash'),
      ) ||
      !equalBytes(
        config.circuitHash,
        hex32(this.manifest.artifacts.r1csSha256, 'Manifest circuit hash'),
      ) ||
      !equalBytes(
        config.verificationKeyHash,
        hex32(this.manifest.artifacts.vkBinSha256, 'Manifest verification key hash'),
      ) ||
      !equalBytes(config.contextHash, contextHash) ||
      !equalBytes(config.contextField, computeContextField(contextHash))
    ) {
      throw new Error('Private Balance contract configuration does not match the manifest');
    }
    if (tree.nextIndex !== meta.actionCount * 3) {
      throw new Error('Private Balance contract head is internally inconsistent');
    }
  }
}

function registryFingerprint(registry: PrivateAssetRegistryState): string {
  return JSON.stringify({
    adminAddress: registry.adminAddress,
    assets: registry.assets.map(asset => ({
      index: asset.index,
      contractId: asset.contractId,
      assetField: Array.from(asset.assetField, byte => byte.toString(16).padStart(2, '0')).join(''),
      status: asset.status,
    })),
  });
}

export async function readCorroboratedPrivateAssetRegistry(
  primary: PrivateBalanceArchiveClient,
  witness: PrivateBalanceArchiveClient,
): Promise<PrivateAssetRegistryState> {
  const [primaryRegistry, witnessRegistry] = await Promise.all([
    primary.readAssetRegistry(),
    witness.readAssetRegistry(),
  ]);
  if (registryFingerprint(primaryRegistry) !== registryFingerprint(witnessRegistry)) {
    throw new Error('Private Balance RPC views disagree on the asset registry');
  }
  return primaryRegistry;
}

export async function readCorroboratedPrivateAssetTokenMetadata(
  contractId: string,
  primary: PrivateBalanceArchiveClient,
  witness: PrivateBalanceArchiveClient,
): Promise<PrivateAssetTokenMetadata> {
  const [primaryMetadata, witnessMetadata] = await Promise.all([
    primary.readAssetTokenMetadata(contractId),
    witness.readAssetTokenMetadata(contractId),
  ]);
  if (JSON.stringify(primaryMetadata) !== JSON.stringify(witnessMetadata)) {
    throw new Error(`Private Balance RPC views disagree on metadata for ${contractId}`);
  }
  return primaryMetadata;
}
