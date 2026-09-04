import { StrKey } from '@stellar/stellar-sdk';

export const PRIVATE_RELAY_PROTOCOL_VERSION = 2 as const;
export const PRIVATE_RELAY_MAX_PLAINTEXT_BYTES = 24 * 1024;
export const PRIVATE_RELAY_MAX_ENCRYPTED_BYTES = 40 * 1024;
export const PRIVATE_RELAY_MAX_CLOCK_SKEW_SECONDS = 30;
export const PRIVATE_RELAY_MAX_TTL_SECONDS = 5 * 60;

const HEX_32 = /^[0-9a-f]{64}$/u;
const HEX_4 = /^[0-9a-f]{8}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,20})$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;

export type PrivateRelayActionKind = 'transfer' | 'withdraw';

export interface PrivateRelayRequest {
  version: 2;
  type: 'request';
  requestId: string;
  networkId: string;
  poolContractId: string;
  replyPubkey: string;
  nonce: string;
  expiresAt: number;
}

export interface PrivateRelayQuote {
  version: 2;
  type: 'quote';
  requestId: string;
  quoteId: string;
  peerPubkey: string;
  peerAccount: string;
  feeAtomic: string;
  /** Proof of account-key possession; never a claim about ledger signer thresholds. */
  accountSignature: string;
  nonce: string;
  expiresAt: number;
}

export type PrivateRelayUnsignedQuote = Omit<PrivateRelayQuote, 'accountSignature'>;

export interface PrivateRelaySelection {
  version: 2;
  type: 'selection';
  requestId: string;
  quoteId: string;
  actionKind: PrivateRelayActionKind;
  assetIndex: number;
  actionDiversifier: string;
  nonce: string;
  expiresAt: number;
}

export interface PrivateRelayPayout {
  version: 2;
  type: 'payout';
  requestId: string;
  quoteId: string;
  peerAccount: string;
  feeAtomic: string;
  privateFeeAddress: string;
  nonce: string;
  expiresAt: number;
}

export interface PrivateRelaySignJob {
  version: 2;
  type: 'sign-job';
  requestId: string;
  quoteId: string;
  transactionHash: string;
  unsignedEnvelopeXdr: string;
  nonce: string;
  expiresAt: number;
}

export interface PrivateRelayPrepareJob {
  version: 2;
  type: 'prepare-job';
  requestId: string;
  quoteId: string;
  prepareId: string;
  operationXdr: string;
  maxTime: number;
  classicFeeStroops: string;
  maximumResourceFeeStroops: string;
  nonce: string;
  expiresAt: number;
}

export interface PrivateRelayPreparedJob {
  version: 2;
  type: 'prepared-job';
  requestId: string;
  quoteId: string;
  prepareId: string;
  preparedEnvelopeXdr: string;
  accountSequence: string;
  simulationLedger: number;
  nonce: string;
  expiresAt: number;
}

export interface PrivateRelaySignedJob {
  version: 2;
  type: 'signed-job';
  requestId: string;
  quoteId: string;
  transactionHash: string;
  signedEnvelopeXdr: string;
  nonce: string;
  expiresAt: number;
}

export interface PrivateRelaySubmitJob {
  version: 2;
  type: 'submit-job';
  requestId: string;
  quoteId: string;
  transactionHash: string;
  signedEnvelopeXdr: string;
  nonce: string;
  expiresAt: number;
}

export interface PrivateRelaySubmitted {
  version: 2;
  type: 'submitted';
  requestId: string;
  quoteId: string;
  transactionHash: string;
  rpcStatus: 'PENDING' | 'DUPLICATE' | 'TRY_AGAIN_LATER' | 'ERROR';
  nonce: string;
  expiresAt: number;
}

export interface PrivateRelayRejected {
  version: 2;
  type: 'rejected';
  requestId: string;
  quoteId: string;
  reason: 'busy' | 'expired' | 'invalid' | 'policy' | 'simulation' | 'signing' | 'submission';
  nonce: string;
  expiresAt: number;
}

export type PrivateRelayMessage =
  | PrivateRelayRequest
  | PrivateRelayQuote
  | PrivateRelaySelection
  | PrivateRelayPayout
  | PrivateRelayPrepareJob
  | PrivateRelayPreparedJob
  | PrivateRelaySignJob
  | PrivateRelaySignedJob
  | PrivateRelaySubmitJob
  | PrivateRelaySubmitted
  | PrivateRelayRejected;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Private relay message must be an object');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('Private relay message contains unsupported fields');
  }
}

function text(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new Error(`Private relay ${name} is invalid`);
  }
  return value;
}

function hex32(value: unknown, name: string): string {
  const parsed = text(value, name, 64);
  if (!HEX_32.test(parsed)) throw new Error(`Private relay ${name} is invalid`);
  return parsed;
}

function expiry(value: unknown, nowSeconds: number): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error('Private relay expiry is invalid');
  }
  const expiresAt = value as number;
  if (expiresAt < nowSeconds - PRIVATE_RELAY_MAX_CLOCK_SKEW_SECONDS) {
    throw new Error('Private relay message expired');
  }
  if (expiresAt > nowSeconds + PRIVATE_RELAY_MAX_TTL_SECONDS) {
    throw new Error('Private relay message expiry is too far in the future');
  }
  return expiresAt;
}

function base(value: Record<string, unknown>, nowSeconds: number) {
  if (value.version !== PRIVATE_RELAY_PROTOCOL_VERSION) {
    throw new Error('Private relay protocol version is unsupported');
  }
  return {
    requestId: hex32(value.requestId, 'request ID'),
    nonce: hex32(value.nonce, 'nonce'),
    expiresAt: expiry(value.expiresAt, nowSeconds),
  };
}

function quoteId(value: unknown): string {
  return hex32(value, 'quote ID');
}

function decimal(value: unknown, name: string, allowZero = false): string {
  const parsed = text(value, name, 21);
  if (!DECIMAL.test(parsed) || (!allowZero && parsed === '0')) {
    throw new Error(`Private relay ${name} is invalid`);
  }
  return parsed;
}

function stellarAccount(value: unknown): string {
  const parsed = text(value, 'peer account', 56);
  if (!StrKey.isValidEd25519PublicKey(parsed)) {
    throw new Error('Private relay peer account is invalid');
  }
  return parsed;
}

function accountSignature(value: unknown): string {
  const parsed = text(value, 'account signature', 128);
  if (!/^[0-9a-f]{128}$/u.test(parsed)) {
    throw new Error('Private relay account signature is invalid');
  }
  return parsed;
}

function xdr(value: unknown, name: string): string {
  const parsed = text(value, name, PRIVATE_RELAY_MAX_PLAINTEXT_BYTES);
  if (!BASE64.test(parsed) || parsed.length % 4 !== 0) {
    throw new Error(`Private relay ${name} is invalid`);
  }
  return parsed;
}

function canonicalMessage(value: unknown, nowSeconds: number): PrivateRelayMessage {
  const source = object(value);
  const type = text(source.type, 'type', 20);
  const common = base(source, nowSeconds);

  switch (type) {
    case 'request': {
      exactKeys(source, ['version', 'type', 'requestId', 'networkId', 'poolContractId', 'replyPubkey', 'nonce', 'expiresAt']);
      const poolContractId = text(source.poolContractId, 'pool contract', 56);
      if (!StrKey.isValidContract(poolContractId)) throw new Error('Private relay pool contract is invalid');
      return {
        version: 2,
        type: 'request',
        requestId: common.requestId,
        networkId: hex32(source.networkId, 'network ID'),
        poolContractId,
        replyPubkey: hex32(source.replyPubkey, 'reply public key'),
        nonce: common.nonce,
        expiresAt: common.expiresAt,
      };
    }
    case 'quote':
      exactKeys(source, ['version', 'type', 'requestId', 'quoteId', 'peerPubkey', 'peerAccount', 'feeAtomic', 'accountSignature', 'nonce', 'expiresAt']);
      return {
        version: 2,
        type: 'quote',
        requestId: common.requestId,
        quoteId: quoteId(source.quoteId),
        peerPubkey: hex32(source.peerPubkey, 'peer public key'),
        peerAccount: stellarAccount(source.peerAccount),
        feeAtomic: decimal(source.feeAtomic, 'fee'),
        accountSignature: accountSignature(source.accountSignature),
        nonce: common.nonce,
        expiresAt: common.expiresAt,
      };
    case 'selection': {
      exactKeys(source, ['version', 'type', 'requestId', 'quoteId', 'actionKind', 'assetIndex', 'actionDiversifier', 'nonce', 'expiresAt']);
      if (source.actionKind !== 'transfer' && source.actionKind !== 'withdraw') {
        throw new Error('Private relay action kind is invalid');
      }
      if (!Number.isSafeInteger(source.assetIndex) || (source.assetIndex as number) < 0 || (source.assetIndex as number) > 255) {
        throw new Error('Private relay asset index is invalid');
      }
      const actionDiversifier = text(source.actionDiversifier, 'action diversifier', 8);
      if (!HEX_4.test(actionDiversifier) || actionDiversifier === '00000000') {
        throw new Error('Private relay action diversifier is invalid');
      }
      return {
        version: 2,
        type: 'selection',
        requestId: common.requestId,
        quoteId: quoteId(source.quoteId),
        actionKind: source.actionKind,
        assetIndex: source.assetIndex as number,
        actionDiversifier,
        nonce: common.nonce,
        expiresAt: common.expiresAt,
      };
    }
    case 'payout':
      exactKeys(source, ['version', 'type', 'requestId', 'quoteId', 'peerAccount', 'feeAtomic', 'privateFeeAddress', 'nonce', 'expiresAt']);
      return {
        version: 2,
        type: 'payout',
        requestId: common.requestId,
        quoteId: quoteId(source.quoteId),
        peerAccount: stellarAccount(source.peerAccount),
        feeAtomic: decimal(source.feeAtomic, 'fee'),
        privateFeeAddress: text(source.privateFeeAddress, 'private fee address', 256),
        nonce: common.nonce,
        expiresAt: common.expiresAt,
      };
    case 'sign-job':
      exactKeys(source, ['version', 'type', 'requestId', 'quoteId', 'transactionHash', 'unsignedEnvelopeXdr', 'nonce', 'expiresAt']);
      return {
        version: 2,
        type: 'sign-job',
        requestId: common.requestId,
        quoteId: quoteId(source.quoteId),
        transactionHash: hex32(source.transactionHash, 'transaction hash'),
        unsignedEnvelopeXdr: xdr(source.unsignedEnvelopeXdr, 'unsigned envelope'),
        nonce: common.nonce,
        expiresAt: common.expiresAt,
      };
    case 'prepare-job': {
      exactKeys(source, ['version', 'type', 'requestId', 'quoteId', 'prepareId', 'operationXdr', 'maxTime', 'classicFeeStroops', 'maximumResourceFeeStroops', 'nonce', 'expiresAt']);
      const maxTime = expiry(source.maxTime, nowSeconds);
      if (maxTime <= nowSeconds || maxTime > common.expiresAt) throw new Error('Private relay preparation time window is invalid');
      return {
        version: 2, type, requestId: common.requestId, quoteId: quoteId(source.quoteId),
        prepareId: hex32(source.prepareId, 'preparation ID'),
        operationXdr: xdr(source.operationXdr, 'operation'), maxTime,
        classicFeeStroops: decimal(source.classicFeeStroops, 'classic fee'),
        maximumResourceFeeStroops: decimal(source.maximumResourceFeeStroops, 'resource fee cap', true),
        nonce: common.nonce, expiresAt: common.expiresAt,
      };
    }
    case 'prepared-job': {
      exactKeys(source, ['version', 'type', 'requestId', 'quoteId', 'prepareId', 'preparedEnvelopeXdr', 'accountSequence', 'simulationLedger', 'nonce', 'expiresAt']);
      if (!Number.isSafeInteger(source.simulationLedger) || (source.simulationLedger as number) < 1 || (source.simulationLedger as number) > 0xffff_ffff) {
        throw new Error('Private relay simulation ledger is invalid');
      }
      const accountSequence = decimal(source.accountSequence, 'account sequence', true);
      if (BigInt(accountSequence) >= 0x7fff_ffff_ffff_ffffn) throw new Error('Private relay account sequence is invalid');
      return {
        version: 2, type, requestId: common.requestId, quoteId: quoteId(source.quoteId),
        prepareId: hex32(source.prepareId, 'preparation ID'),
        preparedEnvelopeXdr: xdr(source.preparedEnvelopeXdr, 'prepared envelope'),
        accountSequence, simulationLedger: source.simulationLedger as number,
        nonce: common.nonce, expiresAt: common.expiresAt,
      };
    }
    case 'signed-job':
    case 'submit-job': {
      const xdrKey = type === 'signed-job' ? 'signedEnvelopeXdr' : 'signedEnvelopeXdr';
      exactKeys(source, ['version', 'type', 'requestId', 'quoteId', 'transactionHash', xdrKey, 'nonce', 'expiresAt']);
      const result = {
        version: 2 as const,
        type,
        requestId: common.requestId,
        quoteId: quoteId(source.quoteId),
        transactionHash: hex32(source.transactionHash, 'transaction hash'),
        signedEnvelopeXdr: xdr(source.signedEnvelopeXdr, 'signed envelope'),
        nonce: common.nonce,
        expiresAt: common.expiresAt,
      };
      return result as PrivateRelaySignedJob | PrivateRelaySubmitJob;
    }
    case 'submitted': {
      exactKeys(source, ['version', 'type', 'requestId', 'quoteId', 'transactionHash', 'rpcStatus', 'nonce', 'expiresAt']);
      const statuses = ['PENDING', 'DUPLICATE', 'TRY_AGAIN_LATER', 'ERROR'];
      if (typeof source.rpcStatus !== 'string' || !statuses.includes(source.rpcStatus)) {
        throw new Error('Private relay RPC status is invalid');
      }
      return {
        version: 2,
        type: 'submitted',
        requestId: common.requestId,
        quoteId: quoteId(source.quoteId),
        transactionHash: hex32(source.transactionHash, 'transaction hash'),
        rpcStatus: source.rpcStatus as PrivateRelaySubmitted['rpcStatus'],
        nonce: common.nonce,
        expiresAt: common.expiresAt,
      };
    }
    case 'rejected': {
      exactKeys(source, ['version', 'type', 'requestId', 'quoteId', 'reason', 'nonce', 'expiresAt']);
      const reasons = ['busy', 'expired', 'invalid', 'policy', 'simulation', 'signing', 'submission'];
      if (typeof source.reason !== 'string' || !reasons.includes(source.reason)) {
        throw new Error('Private relay rejection reason is invalid');
      }
      return {
        version: 2,
        type: 'rejected',
        requestId: common.requestId,
        quoteId: quoteId(source.quoteId),
        reason: source.reason as PrivateRelayRejected['reason'],
        nonce: common.nonce,
        expiresAt: common.expiresAt,
      };
    }
    default:
      throw new Error('Private relay message type is unsupported');
  }
}

export function encodePrivateRelayMessage(
  message: PrivateRelayMessage | Record<string, unknown>,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const encoded = JSON.stringify(canonicalMessage(message, nowSeconds));
  if (new TextEncoder().encode(encoded).byteLength > PRIVATE_RELAY_MAX_PLAINTEXT_BYTES) {
    throw new Error('Private relay message is too large');
  }
  return encoded;
}

export function decodePrivateRelayMessage(
  encoded: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): PrivateRelayMessage {
  if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).byteLength > PRIVATE_RELAY_MAX_PLAINTEXT_BYTES) {
    throw new Error('Private relay message is too large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error('Private relay message is not valid JSON');
  }
  return canonicalMessage(parsed, nowSeconds);
}

export function createPrivateRelayId(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export class PrivateRelayReplayGuard {
  private readonly entries = new Map<string, number>();
  private readonly capacity: number;

  constructor(capacity = 512) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 4096) {
      throw new Error('Private relay replay capacity is invalid');
    }
    this.capacity = capacity;
  }

  consume(id: string, expiresAt: number, nowSeconds = Math.floor(Date.now() / 1000)): void {
    hex32(id, 'replay ID');
    for (const [key, expiryTime] of this.entries) {
      if (expiryTime < nowSeconds) this.entries.delete(key);
    }
    if (this.entries.has(id)) throw new Error('Private relay replay rejected');
    if (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest) this.entries.delete(oldest);
    }
    this.entries.set(id, expiry(expiresAt, nowSeconds));
  }

  clear(): void {
    this.entries.clear();
  }
}

export function redactPrivateRelayError(cause: unknown): string {
  void cause;
  return 'The privacy relay stopped safely. Try another peer or choose direct submission.';
}
