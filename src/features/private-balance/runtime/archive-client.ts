import {
  Address,
  StrKey,
  rpc as SorobanRpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {
  computeContextField,
  computeContextHash,
  type ArchiveRecordModel,
} from '@stellarkey/private-balance';
import type { PrivateBalanceManifest } from '../../../lib/private-balance-manifest';

// One getLedgers range read covers at most this many ledgers (the RPC's own
// per-request page cap); sequences further apart start a fresh batch.
const MAX_LEDGER_CLOSE_TIME_BATCH_SPAN = 200;
export const MAX_ARCHIVE_RECORD_BATCH = 200;

interface ArchiveManifest extends Pick<
  PrivateBalanceManifest,
  | 'protocolVersion'
  | 'networkPassphrase'
  | 'networkId'
  | 'realmId'
  | 'poolContractId'
  | 'deploymentBindingHash'
> {
  constants: Pick<PrivateBalanceManifest['constants'], 'treeDepth' | 'pageCapacity'>;
}

interface ArchiveRpc {
  getLatestLedger(): Promise<{ sequence: number }>;
  queryContract<T>(
    contractId: string,
    method: string,
    args?: Record<string, unknown>,
    networkPassphrase?: string,
  ): Promise<{ result: T; isReadCall: boolean }>;
  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<{
    entries: Array<{ val: xdr.LedgerEntryData; liveUntilLedgerSeq?: number }>;
    latestLedger: number;
  }>;
  getLedgers(request: {
    startLedger: number;
    pagination?: { limit?: number };
  }): Promise<{
    ledgers: Array<{ sequence: number; ledgerCloseTime: string }>;
  }>;
}

interface PoolConfigState {
  protocolVersion: number;
  networkId: Uint8Array;
  realmId: Uint8Array;
  guardian: string;
  poseidon2ParameterHash: Uint8Array;
  circuitHash: Uint8Array;
  verificationKeyHash: Uint8Array;
  treeDepth: number;
  rootWindowLedgers: number;
  pageCapacity: number;
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
  };
}

function decodeRecord(value: unknown, name: string): ArchiveRecordModel {
  const record = object(value, name);
  const actionKind = u32(record.action_kind, `${name}.action_kind`);
  if (actionKind < 1 || actionKind > 3) throw new Error(`${name}.action_kind is invalid`);
  const asset = addressPayload(record.asset, `${name}.asset`);
  if (!asset || asset.kind !== 1) throw new Error(`${name}.asset must be a contract address`);
  return {
    actionIndex: u32(record.action_index, `${name}.action_index`),
    ledgerSequence: u32(record.ledger_sequence, `${name}.ledger_sequence`),
    startingLeafIndex: u32(record.starting_leaf_index, `${name}.starting_leaf_index`),
    actionKind,
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
    ],
    publicValue: u64(record.public_value, `${name}.public_value`),
    relayerFee: u64(record.relayer_fee, `${name}.relayer_fee`),
    relayer: addressPayload(record.relayer, `${name}.relayer`),
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
    poseidon2ParameterHash: bytes(config.poseidon2_parameter_hash, 32, 'Pool config poseidon2_parameter_hash'),
    circuitHash: bytes(config.circuit_hash, 32, 'Pool config circuit_hash'),
    verificationKeyHash: bytes(config.verification_key_hash, 32, 'Pool config verification_key_hash'),
    treeDepth: u32(config.tree_depth, 'Pool config tree_depth'),
    rootWindowLedgers: u32(config.root_window_ledgers, 'Pool config root_window_ledgers'),
    pageCapacity: u32(config.page_capacity, 'Pool config page_capacity'),
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
  if (!Array.isArray(tree.frontier) || tree.frontier.length !== 32) {
    throw new Error('Archive tree frontier is invalid');
  }
  return {
    nextIndex: Number(nextIndex),
    frontier: tree.frontier.map((node, index) => bytes(node, 32, `Archive tree frontier ${index}`)),
    currentRoot: bytes(tree.current_root, 32, 'Archive tree current_root'),
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
  }

  public async readHead(): Promise<ArchiveHeadState> {
    const [latest, configCall, metaCall, treeCall] = await Promise.all([
      this.server.getLatestLedger(),
      this.server.queryContract<unknown>(
        this.manifest.poolContractId,
        'config',
        undefined,
        this.manifest.networkPassphrase,
      ),
      this.server.queryContract<unknown>(
        this.manifest.poolContractId,
        'archive_meta',
        undefined,
        this.manifest.networkPassphrase,
      ),
      this.server.queryContract<unknown>(
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
    const call = await this.server.queryContract<unknown>(
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

  public async readAssetBalance(assetContractId: string, accountPublicKey: string): Promise<bigint> {
    if (!StrKey.isValidContract(assetContractId)) {
      throw new Error('Private Balance asset contract is invalid');
    }
    const call = await this.server.queryContract<unknown>(
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
   * Near-contiguous sequences batch into single getLedgers range reads, so a
   * page's worth of records costs a handful of round-trips instead of one
   * per record. Sequences outside RPC retention (or missing from a short
   * range response) are silently omitted so callers keep their
   * zero-timestamp fallback for them.
   */
  public async readLedgerCloseTimes(
    sequences: readonly number[],
  ): Promise<Record<number, number>> {
    const unique = [...new Set(sequences.map(sequence => u32(sequence, 'Ledger sequence')))]
      .sort((left, right) => left - right);
    const closedAt: Record<number, number> = {};
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
      const wanted = new Set(unique.slice(index, end + 1));
      try {
        const response = await this.server.getLedgers({
          startLedger: start,
          pagination: { limit: unique[end] - start + 1 },
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
      index = end + 1;
    }
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
    const response = await this.server.getLedgerEntries(
      ...Array.from({ length: validCount }, (_, offset) =>
        deriveArchiveRecordLedgerKey(this.manifest.poolContractId, start + offset)),
    );
    if (response.entries.length !== validCount) {
      throw new ArchiveRecordUnavailableError(start + response.entries.length, response.latestLedger);
    }
    const records = response.entries.map((entry, offset) => {
      if (entry.val.type !== 'contractData') {
        throw new Error('RPC returned a non-contract archive entry');
      }
      const record = decodeRecord(
        scValToNative(entry.val.contractData.val),
        `Archive record ${start + offset}`,
      );
      if (record.actionIndex !== start + offset) {
        throw new Error('RPC returned archive records out of sequence');
      }
      return record;
    });
    return records;
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
      config.pageCapacity !== this.manifest.constants.pageCapacity ||
      !equalBytes(
        config.deploymentBindingHash,
        hex32(this.manifest.deploymentBindingHash, 'Manifest deployment binding hash'),
      ) ||
      !equalBytes(config.contextHash, contextHash) ||
      !equalBytes(config.contextField, computeContextField(contextHash))
    ) {
      throw new Error('Private Balance contract configuration does not match the manifest');
    }
    if (tree.nextIndex !== meta.actionCount * 2) {
      throw new Error('Private Balance contract head is internally inconsistent');
    }
  }
}
