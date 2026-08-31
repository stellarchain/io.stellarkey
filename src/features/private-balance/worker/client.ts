import { StrKey } from '@stellar/stellar-sdk';
import {
  computeContextField,
  computeContextHash,
  decodePrivateAddress,
  type ArchiveRecordModel,
  type MerkleTree,
} from '@stellarkey/private-balance';
import type { PrivateBalanceManifest } from '../../../lib/private-balance-manifest';
import { validateManifest } from '../../../lib/private-balance-manifest';
import type { ShieldedActivityRecord, ShieldedNoteRecord } from '../runtime/types';
import type { BuildActionIntent } from './action-builder';
import {
  PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
  type ProofData,
  type WorkerRequest,
  type WorkerResponse,
} from './messages';

const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
const MAX_PENDING_REQUESTS = 4;
// Watchdog caps. A wedged worker (script that never loaded, fatal error that
// only surfaced as an 'error' event) must reject its callers instead of
// hanging the runtime mutex forever; proving gets a generous ceiling.
const WORKER_REQUEST_TIMEOUT_MS = 60_000;
const WORKER_PROVING_TIMEOUT_MS = 5 * 60_000;

function abortError(): Error {
  return new DOMException('Private action cancelled.', 'AbortError');
}

function hex32(value: string): Uint8Array {
  return Uint8Array.from(
    value.match(/../g) ?? [],
    (byte) => Number.parseInt(byte, 16),
  );
}

function zeroAttachedBuffer(buffer: ArrayBuffer): void {
  if (buffer.byteLength === 0) return;
  new Uint8Array(buffer).fill(0);
}

export class PrivateBalanceWorkerClient {
  private worker: Worker | null = null;
  private sessionId: string | null = null;
  private addressPrefix: 'tks' | 'sks' | null = null;
  private currentAddress: string | null = null;
  private nextOperation = 0;
  private dead = false;
  private failure: Error | null = null;
  private readonly requestTimeoutMs: number;
  private readonly provingTimeoutMs: number;
  private pendingRequests = new Map<
    string,
    {
      sessionId: string;
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
      onProgress?: (percentage: number) => void;
      cleanup?: () => void;
    }
  >();

  constructor(
    workerInstance?: Worker,
    options: { requestTimeoutMs?: number; provingTimeoutMs?: number } = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? WORKER_REQUEST_TIMEOUT_MS;
    this.provingTimeoutMs = options.provingTimeoutMs ?? WORKER_PROVING_TIMEOUT_MS;
    if (workerInstance) {
      this.worker = workerInstance;
      this.initListener();
    }
  }

  /**
   * True once the worker crashed, failed to load, or stopped responding. A
   * failed client never hangs a caller — every request rejects immediately —
   * and the provider rebuilds the worker session on its next sync.
   */
  public get failed(): boolean {
    return this.dead;
  }

  private assertNotFailed(): void {
    if (this.dead) {
      throw this.failure ?? new Error('Private Balance worker is unavailable.');
    }
  }

  private failWith(message: string): void {
    if (this.dead) return;
    this.dead = true;
    this.failure = new Error(message);
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.sessionId = null;
    this.addressPrefix = null;
    this.currentAddress = null;
    for (const pending of this.pendingRequests.values()) {
      pending.cleanup?.();
      pending.reject(this.failure);
    }
    this.pendingRequests.clear();
  }

  private initListener() {
    if (!this.worker) return;
    // A worker that crashes or never loads surfaces only as an 'error' or
    // 'messageerror' event; without these handlers every pending request
    // would hang forever with the runtime mutex held.
    this.worker.onerror = () => {
      this.failWith('Private Balance worker crashed. Sync again to restart it.');
    };
    this.worker.onmessageerror = () => {
      this.failWith('Private Balance worker returned an unreadable message.');
    };
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const resp = event.data;
      const pending = this.pendingRequests.get(resp.id);
      if (!pending) return;

      if (
        resp.messageVersion !== PRIVATE_BALANCE_WORKER_MESSAGE_VERSION ||
        resp.sessionId !== pending.sessionId ||
        resp.sessionId !== this.sessionId
      ) {
        this.pendingRequests.delete(resp.id);
        pending.cleanup?.();
        pending.reject(new Error('Private Balance worker returned a stale or invalid response.'));
        return;
      }
      if (resp.type === 'PROOF_PROGRESS') {
        pending.onProgress?.(resp.percentage);
        return;
      }
      this.pendingRequests.delete(resp.id);
      pending.cleanup?.();
      if (resp.type === 'ERROR') {
        pending.reject(new Error(resp.error));
      } else if (resp.type === 'CANCELLED') {
        pending.reject(abortError());
      } else {
        pending.resolve(resp);
      }
    };
  }

  private createId(prefix: 'session' | 'operation'): string {
    this.nextOperation += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.nextOperation.toString(36)}`;
  }

  private request<T extends WorkerResponse>(
    req: WorkerRequest,
    transfer: Transferable[] = [],
    options: {
      signal?: AbortSignal;
      onProgress?: (percentage: number) => void;
    } = {},
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.dead) {
        for (const item of transfer) {
          if (item instanceof ArrayBuffer) zeroAttachedBuffer(item);
        }
        reject(this.failure ?? new Error('Private Balance worker is unavailable.'));
        return;
      }
      if (!this.worker) {
        for (const item of transfer) {
          if (item instanceof ArrayBuffer) zeroAttachedBuffer(item);
        }
        reject(new Error('Worker not initialized'));
        return;
      }
      if (options.signal?.aborted) {
        for (const item of transfer) {
          if (item instanceof ArrayBuffer) zeroAttachedBuffer(item);
        }
        reject(abortError());
        return;
      }
      if (this.pendingRequests.size >= MAX_PENDING_REQUESTS) {
        for (const item of transfer) {
          if (item instanceof ArrayBuffer) zeroAttachedBuffer(item);
        }
        reject(new Error('Private Balance worker request queue is full.'));
        return;
      }
      const abort = () => {
        const pending = this.pendingRequests.get(req.id);
        if (!pending || !this.worker) return;
        // Cancel only this operation. The worker drops the cancelled proof
        // and keeps its session key, so the shared client stays usable for
        // later scans and builds without a full resync.
        this.worker.postMessage({
          messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
          id: this.createId('operation'),
          sessionId: req.sessionId,
          type: 'CANCEL',
          targetOperationId: req.id,
        } satisfies WorkerRequest);
        this.pendingRequests.delete(req.id);
        pending.cleanup?.();
        pending.reject(abortError());
      };
      // Per-request watchdog: a hung request means the worker is wedged, so
      // fail the whole client — every queued caller (and the mutex holder
      // awaiting this call) exits via rejection, and the provider rebuilds
      // the worker lazily on its next sync.
      const timeoutMs = req.type === 'GENERATE_PROOF'
        ? this.provingTimeoutMs
        : this.requestTimeoutMs;
      const watchdog = setTimeout(() => {
        if (!this.pendingRequests.has(req.id)) return;
        this.failWith('Private Balance worker stopped responding. Sync again to restart it.');
      }, timeoutMs);
      const removeAbortListener = options.signal
        ? () => options.signal?.removeEventListener('abort', abort)
        : undefined;
      const cleanup = () => {
        clearTimeout(watchdog);
        removeAbortListener?.();
      };
      this.pendingRequests.set(req.id, {
        sessionId: req.sessionId,
        resolve: value => resolve(value as T),
        reject,
        onProgress: options.onProgress,
        cleanup,
      });
      options.signal?.addEventListener('abort', abort, { once: true });
      try {
        this.worker.postMessage(req, transfer);
      } catch (error) {
        for (const item of transfer) {
          if (item instanceof ArrayBuffer) zeroAttachedBuffer(item);
        }
        this.pendingRequests.delete(req.id);
        cleanup?.();
        reject(error);
      }
    });
  }

  public async initSession(
    manifest: PrivateBalanceManifest,
    accountPublicKey: string,
    sessionRoot: Uint8Array,
    currentAddress?: string,
  ): Promise<{ ownerCommitmentHex: string; address: string }> {
    this.assertNotFailed();
    if (
      sessionRoot.length !== 64 ||
      sessionRoot.byteOffset !== 0 ||
      !(sessionRoot.buffer instanceof ArrayBuffer) ||
      sessionRoot.buffer.byteLength !== 64
    ) {
      throw new Error('Privacy session root must use a standalone 64-byte buffer.');
    }
    const parsedManifest = validateManifest(manifest);
    const networkId = hex32(parsedManifest.networkId);
    const realmId = hex32(parsedManifest.realmId);
    const poolId = new Uint8Array(StrKey.decodeContract(parsedManifest.poolContractId));
    const accountPublicKeyBytes = new Uint8Array(
      StrKey.decodeEd25519PublicKey(accountPublicKey),
    );
    const contextHash = computeContextHash(
      parsedManifest.protocolVersion,
      networkId,
      realmId,
      poolId,
    );
    const addressPrefix = parsedManifest.networkPassphrase === MAINNET_PASSPHRASE
      ? 'sks'
      : 'tks';
    const addressDiversifier = currentAddress
      ? (await decodePrivateAddress(currentAddress, addressPrefix)).diversifier
      : undefined;
    const transferredRoot = sessionRoot.buffer;
    const sessionId = this.createId('session');
    const id = this.createId('operation');
    const req: WorkerRequest = {
      messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
      id,
      sessionId,
      type: 'INIT_SESSION',
      keyContext: {
        protocolVersion: parsedManifest.protocolVersion,
        networkId,
        realmId,
        poolId,
        accountPublicKey: accountPublicKeyBytes,
        contextField: computeContextField(contextHash),
        addressPrefix,
      },
      sessionRoot: transferredRoot,
      addressDiversifier,
    };
    this.sessionId = sessionId;
    try {
      const response = await this.request<Extract<WorkerResponse, { type: 'INIT_OK' }>>(
        req,
        [transferredRoot],
      );
      const decoded = await decodePrivateAddress(response.address, addressPrefix);
      if (
        addressDiversifier &&
        decoded.diversifier.some((byte, index) => byte !== addressDiversifier[index])
      ) {
        throw new Error('Private Balance worker restored the wrong receive address.');
      }
      this.addressPrefix = addressPrefix;
      this.currentAddress = response.address;
      return { ownerCommitmentHex: response.ownerCommitmentHex, address: response.address };
    } catch (error) {
      if (this.sessionId === sessionId) this.sessionId = null;
      this.addressPrefix = null;
      this.currentAddress = null;
      throw error;
    }
  }

  public async generateAddress(): Promise<{ ownerCommitmentHex: string; address: string }> {
    this.assertNotFailed();
    if (!this.sessionId || !this.addressPrefix) {
      throw new Error('Private Balance worker session is not initialized.');
    }
    const req: WorkerRequest = {
      messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
      id: this.createId('operation'),
      sessionId: this.sessionId,
      type: 'GENERATE_ADDRESS',
    };
    const response = await this.request<Extract<WorkerResponse, { type: 'ADDRESS_OK' }>>(req);
    await decodePrivateAddress(response.address, this.addressPrefix);
    if (response.address === this.currentAddress) {
      throw new Error('Private Balance worker returned the current receive address.');
    }
    this.currentAddress = response.address;
    return { ownerCommitmentHex: response.ownerCommitmentHex, address: response.address };
  }

  public async scanPage(input: {
    records: ArchiveRecordModel[];
    expectedPriorRecordHash: Uint8Array;
    initialTree?: MerkleTree;
    existingNotes?: ShieldedNoteRecord[];
    ledgerClosedAt?: Readonly<Record<number, number>>;
  }): Promise<{
    notes: ShieldedNoteRecord[];
    activities: ShieldedActivityRecord[];
    tree: MerkleTree;
    lastRecordHash: Uint8Array;
    spentNullifierHexes: string[];
    nullifiersByCommitment: Map<string, string>;
  }> {
    this.assertNotFailed();
    if (!this.sessionId) throw new Error('Private Balance worker session is not initialized.');
    const req: WorkerRequest = {
      messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
      id: this.createId('operation'),
      sessionId: this.sessionId,
      type: 'SCAN_PAGE',
      ...input,
    };
    const response = await this.request<Extract<WorkerResponse, { type: 'SCAN_OK' }>>(req);
    return {
      notes: response.notes,
      activities: response.activities,
      tree: response.tree,
      lastRecordHash: response.lastRecordHash,
      spentNullifierHexes: response.spentNullifierHexes,
      nullifiersByCommitment: new Map(response.nullifiersByCommitment),
    };
  }

  public async generateProof(
    preparedActionId: string,
    wasmBuffer: ArrayBuffer,
    zkeyBuffer: ArrayBuffer,
    verificationKey: Record<string, unknown>,
    options: {
      signal?: AbortSignal;
      onProgress?: (percentage: number) => void;
    } = {},
  ): Promise<{ proof: ProofData; publicSignals: string[]; sorobanProofHex: string }> {
    this.assertNotFailed();
    if (!this.sessionId) throw new Error('Private Balance worker session is not initialized.');
    const id = this.createId('operation');
    const req: WorkerRequest = {
      messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
      id,
      sessionId: this.sessionId,
      type: 'GENERATE_PROOF',
      preparedActionId,
      wasmBuffer,
      zkeyBuffer,
      verificationKey,
    };

    const response = await this.request<Extract<WorkerResponse, { type: 'PROOF_OK' }>>(
      req,
      [wasmBuffer, zkeyBuffer],
      options,
    );
    return {
      proof: response.proof,
      publicSignals: response.publicSignals,
      sorobanProofHex: response.sorobanProofHex,
    };
  }

  public async buildAction(
    reservationId: string,
    intent: BuildActionIntent,
    commitments: Uint8Array[],
    availableNotes: ShieldedNoteRecord[],
  ): Promise<Extract<WorkerResponse, { type: 'ACTION_PREPARED' }>> {
    this.assertNotFailed();
    if (!this.sessionId) throw new Error('Private Balance worker session is not initialized.');
    const req: WorkerRequest = {
      messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
      id: this.createId('operation'),
      sessionId: this.sessionId,
      type: 'BUILD_ACTION',
      reservationId,
      intent,
      commitments,
      availableNotes,
    };
    return this.request<Extract<WorkerResponse, { type: 'ACTION_PREPARED' }>>(req);
  }

  public terminate(): void {
    if (this.worker) {
      if (this.sessionId) {
        this.worker.postMessage({
          messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
          id: this.createId('operation'),
          sessionId: this.sessionId,
          type: 'LOCK',
        } satisfies WorkerRequest);
      }
      this.worker.terminate();
      this.worker = null;
    }
    this.sessionId = null;
    this.addressPrefix = null;
    this.currentAddress = null;
    for (const pending of this.pendingRequests.values()) {
      pending.cleanup?.();
      pending.reject(new Error('Private Balance worker terminated.'));
    }
    this.pendingRequests.clear();
  }
}
