import { StrKey } from '@stellar/stellar-sdk';
import { getHorizonJson } from '../../../lib/horizon';
import { amountToStroops } from '../../../lib/stellar-domain';
import { getAccountHistoryHorizonUrl } from '../../../lib/stellar-endpoints';
import type { StealthNetwork } from '@stellarkey/private-balance';
import type {
  StealthAnnouncement,
  StealthAnnouncementPage,
  StealthAnnouncementReader,
} from './stealth-sync';

const ANNOUNCEMENT_AMOUNT = '0.0000001';
const OPERATION_LOOKUP_CONCURRENCY = 8;
const HEX_32 = /^[0-9a-f]{64}$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;

type HorizonRequest = (url: string) => Promise<unknown>;

interface RawTransaction {
  successful?: unknown;
  memo_type?: unknown;
  memo?: unknown;
}

interface RawPayment {
  type?: unknown;
  transaction_hash?: unknown;
  transaction_successful?: unknown;
  created_at?: unknown;
  paging_token?: unknown;
  from?: unknown;
  to?: unknown;
  asset_type?: unknown;
  amount?: unknown;
  transaction?: RawTransaction;
}

interface RawOperation {
  type?: unknown;
  transaction_successful?: unknown;
  funder?: unknown;
  account?: unknown;
  starting_balance?: unknown;
  from?: unknown;
  to?: unknown;
  asset_type?: unknown;
  amount?: unknown;
}

interface HorizonPage<T> {
  _embedded?: { records?: T[] };
}

interface RawLedger {
  sequence?: unknown;
  closed_at?: unknown;
}

export interface HorizonStealthAnnouncementReaderOptions {
  network: StealthNetwork;
  announcerPublicKey: string;
  request?: HorizonRequest;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && POSITIVE_DECIMAL.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function highWaterCursor(ledger: number): string {
  if (!Number.isSafeInteger(ledger) || ledger < 0) throw new Error('Horizon ledger cursor is invalid');
  return ((BigInt(ledger) << 32n) | 0xffffffffn).toString();
}

function ledgerFromPagingToken(token: string): number | null {
  if (!POSITIVE_DECIMAL.test(token)) return null;
  const ledger = Number(BigInt(token) >> 32n);
  return Number.isSafeInteger(ledger) && ledger > 0 ? ledger : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function decodeHashMemo(transaction: RawTransaction | undefined): Uint8Array | null {
  if (
    transaction?.successful === false ||
    transaction?.memo_type !== 'hash' ||
    typeof transaction.memo !== 'string'
  ) {
    return null;
  }
  try {
    const binary = atob(transaction.memo);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (bytes.length !== 32 || btoa(String.fromCharCode(...bytes)).replace(/=+$/u, '') !== transaction.memo.replace(/=+$/u, '')) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}

function isAnnouncementPayment(record: RawPayment, announcer: string): boolean {
  return record.type === 'payment' &&
    record.transaction_successful !== false &&
    record.to === announcer &&
    typeof record.from === 'string' &&
    StrKey.isValidEd25519PublicKey(record.from) &&
    record.asset_type === 'native' &&
    record.amount === ANNOUNCEMENT_AMOUNT &&
    typeof record.transaction_hash === 'string' &&
    HEX_32.test(record.transaction_hash) &&
    typeof record.paging_token === 'string' &&
    POSITIVE_DECIMAL.test(record.paging_token) &&
    timestamp(record.created_at) !== null &&
    decodeHashMemo(record.transaction) !== null;
}

function parseTransactionShape(
  record: RawPayment,
  operations: RawOperation[],
  announcer: string,
): StealthAnnouncement | null {
  if (!isAnnouncementPayment(record, announcer) || operations.length !== 3) return null;
  const source = record.from as string;
  const createOperations = operations.filter(operation => operation.type === 'create_account');
  const paymentOperations = operations.filter(operation => operation.type === 'payment');
  if (createOperations.length !== 1 || paymentOperations.length !== 2) return null;
  if (operations.some(operation => operation.transaction_successful === false)) return null;

  const create = createOperations[0];
  if (
    create.funder !== source ||
    typeof create.account !== 'string' ||
    !StrKey.isValidEd25519PublicKey(create.account) ||
    typeof create.starting_balance !== 'string'
  ) {
    return null;
  }
  try {
    if (amountToStroops(create.starting_balance) <= 0n) return null;
  } catch {
    return null;
  }

  const announcement = paymentOperations.find(operation =>
    operation.from === source &&
    operation.to === announcer &&
    operation.asset_type === 'native' &&
    operation.amount === ANNOUNCEMENT_AMOUNT);
  const valuePayment = paymentOperations.find(operation => operation !== announcement);
  if (
    !announcement ||
    !valuePayment ||
    valuePayment.from !== source ||
    valuePayment.to !== create.account ||
    valuePayment.asset_type !== 'native' ||
    typeof valuePayment.amount !== 'string'
  ) {
    return null;
  }

  let amountStroops: bigint;
  try {
    amountStroops = amountToStroops(valuePayment.amount);
    if (amountStroops <= 0n) return null;
  } catch {
    return null;
  }
  const ephemeralPublicKey = decodeHashMemo(record.transaction);
  const createdAt = timestamp(record.created_at);
  const pagingToken = record.paging_token as string;
  const ledger = ledgerFromPagingToken(pagingToken);
  if (!ephemeralPublicKey || createdAt === null || ledger === null) return null;
  return {
    pagingToken,
    transactionHash: record.transaction_hash as string,
    ephemeralPublicKey,
    destinationPublicKey: StrKey.decodeEd25519PublicKey(create.account),
    amountStroops: amountStroops.toString(),
    ledger,
    createdAt,
  };
}

function records<T>(value: unknown): T[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const page = value as HorizonPage<T>;
  return Array.isArray(page._embedded?.records) ? page._embedded.records : [];
}

export class HorizonStealthAnnouncementReader implements StealthAnnouncementReader {
  readonly #announcerPublicKey: string;
  readonly #baseUrl: string;
  readonly #request: HorizonRequest;

  public constructor(options: HorizonStealthAnnouncementReaderOptions) {
    if (!StrKey.isValidEd25519PublicKey(options.announcerPublicKey)) {
      throw new Error('Stealth announcer account is invalid');
    }
    this.#announcerPublicKey = options.announcerPublicKey;
    this.#baseUrl = getAccountHistoryHorizonUrl(options.network);
    this.#request = options.request ?? (url => getHorizonJson<unknown>(url));
  }

  async #latestLedger(): Promise<{ sequence: number; closedAt: number }> {
    const url = new URL(`${this.#baseUrl}/ledgers`);
    url.searchParams.set('order', 'desc');
    url.searchParams.set('limit', '1');
    const latest = records<RawLedger>(await this.#request(url.toString()))[0];
    const sequence = positiveInteger(latest?.sequence);
    const closedAt = timestamp(latest?.closed_at);
    if (sequence === null || closedAt === null) {
      throw new Error('Horizon did not return a valid latest ledger for stealth discovery');
    }
    return { sequence, closedAt };
  }

  async #earliestLedger(): Promise<{ sequence: number; closedAt: number }> {
    const url = new URL(`${this.#baseUrl}/ledgers`);
    url.searchParams.set('order', 'asc');
    url.searchParams.set('limit', '1');
    const earliest = records<RawLedger>(await this.#request(url.toString()))[0];
    const sequence = positiveInteger(earliest?.sequence);
    const closedAt = timestamp(earliest?.closed_at);
    if (sequence === null || closedAt === null) {
      throw new Error('Horizon did not return a valid earliest ledger for stealth discovery');
    }
    return { sequence, closedAt };
  }

  async #ledgerClosedAt(sequence: number): Promise<number> {
    const ledger = await this.#request(`${this.#baseUrl}/ledgers/${sequence}`) as RawLedger;
    if (positiveInteger(ledger.sequence) !== sequence) {
      throw new Error('Horizon returned the wrong ledger during stealth discovery');
    }
    const closedAt = timestamp(ledger.closed_at);
    if (closedAt === null) throw new Error('Horizon ledger close time is invalid');
    return closedAt;
  }

  async #lowerBoundCursor(lowerBoundCreatedAt: number, latest: { sequence: number; closedAt: number }): Promise<string> {
    if (!Number.isFinite(lowerBoundCreatedAt) || lowerBoundCreatedAt < 0) {
      throw new Error('Stealth discovery lower bound is invalid');
    }
    if (latest.closedAt < lowerBoundCreatedAt) return highWaterCursor(latest.sequence);
    const earliest = await this.#earliestLedger();
    if (earliest.sequence > latest.sequence || earliest.closedAt > latest.closedAt) {
      throw new Error('Horizon returned an invalid retained ledger range for stealth discovery');
    }
    if (earliest.closedAt >= lowerBoundCreatedAt) {
      return highWaterCursor(Math.max(0, earliest.sequence - 1));
    }
    let low = earliest.sequence;
    let high = latest.sequence;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (await this.#ledgerClosedAt(middle) < lowerBoundCreatedAt) low = middle + 1;
      else high = middle;
    }
    return highWaterCursor(Math.max(0, low - 1));
  }

  async #operations(transactionHash: string): Promise<RawOperation[]> {
    const url = new URL(`${this.#baseUrl}/transactions/${transactionHash}/operations`);
    url.searchParams.set('order', 'asc');
    url.searchParams.set('limit', '200');
    return records<RawOperation>(await this.#request(url.toString()));
  }

  public async readPage(input: {
    cursor: string | null;
    lowerBoundCreatedAt: number;
    limit: number;
  }): Promise<StealthAnnouncementPage> {
    const limit = Math.min(Math.max(Math.floor(input.limit), 1), 200);
    const latest = await this.#latestLedger();
    const startCursor = input.cursor ?? await this.#lowerBoundCursor(
      input.lowerBoundCreatedAt,
      latest,
    );
    if (!POSITIVE_DECIMAL.test(startCursor)) throw new Error('Stealth discovery cursor is invalid');

    const url = new URL(`${this.#baseUrl}/accounts/${this.#announcerPublicKey}/payments`);
    url.searchParams.set('order', 'asc');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('cursor', startCursor);
    url.searchParams.set('join', 'transactions');
    const rawPayments = records<RawPayment>(await this.#request(url.toString()));
    if (rawPayments.length > limit) throw new Error('Horizon returned too many stealth announcements');
    for (let index = 1; index < rawPayments.length; index += 1) {
      const prior = rawPayments[index - 1].paging_token;
      const current = rawPayments[index].paging_token;
      if (
        typeof prior !== 'string' ||
        typeof current !== 'string' ||
        !POSITIVE_DECIMAL.test(prior) ||
        !POSITIVE_DECIMAL.test(current) ||
        BigInt(current) <= BigInt(prior)
      ) {
        throw new Error('Horizon stealth announcement page is not ordered');
      }
    }

    const announcements: StealthAnnouncement[] = [];
    for (let offset = 0; offset < rawPayments.length; offset += OPERATION_LOOKUP_CONCURRENCY) {
      const batch = rawPayments.slice(offset, offset + OPERATION_LOOKUP_CONCURRENCY);
      const resolved = await Promise.all(batch.map(async record => {
        if (!isAnnouncementPayment(record, this.#announcerPublicKey)) return null;
        const operations = await this.#operations(record.transaction_hash as string);
        return parseTransactionShape(record, operations, this.#announcerPublicKey);
      }));
      announcements.push(...resolved.filter(item => item !== null));
    }

    const hasMore = rawPayments.length === limit;
    const rawCursor = rawPayments.at(-1)?.paging_token;
    const nextCursor = hasMore
      ? typeof rawCursor === 'string' && POSITIVE_DECIMAL.test(rawCursor)
        ? rawCursor
        : (() => { throw new Error('Horizon stealth announcement cursor is invalid'); })()
      : highWaterCursor(latest.sequence);
    return {
      announcements,
      nextCursor,
      latestLedger: latest.sequence,
      hasMore,
    };
  }
}
