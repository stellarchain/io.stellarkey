import type { Event } from 'nostr-tools/pure';
import {
  createPrivateRelayEphemeralIdentity,
  decryptPrivateRelayPayload,
  encryptPrivateRelayPayload,
  signPrivateRelayEvent,
  verifyPrivateRelayEvent,
  type PrivateRelayEphemeralIdentity,
} from './crypto';
import {
  createPrivateRelayId,
  decodePrivateRelayMessage,
  encodePrivateRelayMessage,
  PRIVATE_RELAY_MAX_PLAINTEXT_BYTES,
  PRIVATE_RELAY_MAX_TTL_SECONDS,
  PrivateRelayReplayGuard,
  type PrivateRelayMessage,
  type PrivateRelayPayout,
  type PrivateRelayPrepareJob,
  type PrivateRelayPreparedJob,
  type PrivateRelayQuote,
  type PrivateRelayUnsignedQuote,
  type PrivateRelayRejected,
  type PrivateRelayRequest,
  type PrivateRelaySelection,
  type PrivateRelaySignJob,
  type PrivateRelaySignedJob,
  type PrivateRelaySubmitJob,
  type PrivateRelaySubmitted,
} from './protocol';
import {
  PRIVATE_RELAY_EVENT_KIND,
  PRIVATE_RELAY_TOPIC,
  NostrPrivateRelayAdapter,
} from './nostr';
import {
  BoundedPrivateRelayTransport,
  type PrivateRelaySubscription,
} from './transport';
import { rankPrivateRelayQuotes } from './availability';
import { verifyPrivateRelayQuoteAuthorization } from './account-authorization';

const DEFAULT_MESSAGE_TTL_SECONDS = PRIVATE_RELAY_MAX_TTL_SECONDS;
const DEFAULT_RESPONSE_TIMEOUT_MS = 20_000;
const DEFAULT_QUOTE_SETTLE_MS = 700;
const MAX_QUOTE_WINDOW_MS = 20_000;
const MAX_RELAY_QUOTES = 32;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function abortError(): DOMException {
  return new DOMException('Private relay cancelled.', 'AbortError');
}

function topic(event: Event): boolean {
  return event.tags.some(tag => tag[0] === 't' && tag[1] === PRIVATE_RELAY_TOPIC);
}

function recipient(event: Event): string | null {
  return event.tags.find(tag => tag[0] === 'p')?.[1] ?? null;
}

export interface ReceivedPrivateRelayMessage {
  event: Event;
  message: PrivateRelayMessage;
}

export class PrivateRelayMessenger {
  public readonly publicKey: string;
  private readonly replay = new PrivateRelayReplayGuard();
  private readonly pendingWaits = new Set<() => void>();
  private closed = false;
  private readonly identity: PrivateRelayEphemeralIdentity;
  private readonly transport: BoundedPrivateRelayTransport;

  private constructor(
    identity: PrivateRelayEphemeralIdentity,
    transport: BoundedPrivateRelayTransport,
  ) {
    this.identity = identity;
    this.transport = transport;
    this.publicKey = identity.publicKey;
  }

  static async create(
    relayUrls: readonly string[],
    transport?: BoundedPrivateRelayTransport,
  ): Promise<PrivateRelayMessenger> {
    const identity = await createPrivateRelayEphemeralIdentity();
    return new PrivateRelayMessenger(
      identity,
      transport ?? new BoundedPrivateRelayTransport(relayUrls, new NostrPrivateRelayAdapter()),
    );
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Private relay session is closed');
  }

  async publish(
    message: PrivateRelayMessage,
    peerPublicKey?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertOpen();
    if (signal?.aborted) throw abortError();
    if (message.type !== 'request' && !peerPublicKey) {
      throw new Error('Private relay replies require an encrypted recipient');
    }
    const encoded = encodePrivateRelayMessage(message);
    // One bounded size for every encrypted class (including short rejects and
    // quotes). JSON whitespace is inside authenticated encryption. This hides
    // content length, not message count, timing, or Nostr routing metadata.
    const padded = peerPublicKey
      ? encoded + ' '.repeat(PRIVATE_RELAY_MAX_PLAINTEXT_BYTES - new TextEncoder().encode(encoded).byteLength)
      : encoded;
    const content = peerPublicKey
      ? await encryptPrivateRelayPayload(this.identity.secretKey, peerPublicKey, padded)
      : encoded;
    const tags = [
      ['t', PRIVATE_RELAY_TOPIC],
      ['expiration', String(message.expiresAt)],
      ...(peerPublicKey ? [['p', peerPublicKey]] : []),
    ];
    const event = await signPrivateRelayEvent(this.identity.secretKey, {
      kind: PRIVATE_RELAY_EVENT_KIND,
      created_at: nowSeconds(),
      tags,
      content,
    });
    this.assertOpen();
    if (signal?.aborted) throw abortError();
    if (message.expiresAt <= nowSeconds()) throw new Error('Private relay message expired before publication');
    await this.transport.publish(event, signal);
  }

  subscribe(
    input: {
      encrypted: boolean;
      onMessage(received: ReceivedPrivateRelayMessage): void;
      peerPublicKey?: string;
      sinceSeconds?: number;
    },
    signal?: AbortSignal,
  ): PrivateRelaySubscription {
    this.assertOpen();
    const filter = {
      kinds: [PRIVATE_RELAY_EVENT_KIND],
      '#t': [PRIVATE_RELAY_TOPIC],
      since: input.sinceSeconds ?? nowSeconds() - 30,
      ...(input.encrypted ? { '#p': [this.publicKey] } : {}),
    };
    return this.transport.subscribe([filter], event => {
      void this.receive(event, input).catch(() => undefined);
    }, signal);
  }

  waitUntilConnected(signal?: AbortSignal) {
    this.assertOpen();
    return this.transport.waitUntilConnected(signal);
  }

  connectionStatus() {
    this.assertOpen();
    return this.transport.connectionStatus();
  }

  private async receive(
    event: Event,
    input: {
      encrypted: boolean;
      onMessage(received: ReceivedPrivateRelayMessage): void;
      peerPublicKey?: string;
    },
  ): Promise<void> {
    if (this.closed || event.kind !== PRIVATE_RELAY_EVENT_KIND || !topic(event)) return;
    if (input.peerPublicKey && event.pubkey !== input.peerPublicKey) return;
    if (!(await verifyPrivateRelayEvent(event))) return;
    const addressedTo = recipient(event);
    if (input.encrypted ? addressedTo !== this.publicKey : addressedTo !== null) return;
    this.replay.consume(event.id, nowSeconds() + DEFAULT_MESSAGE_TTL_SECONDS);
    const plaintext = input.encrypted
      ? await decryptPrivateRelayPayload(this.identity.secretKey, event.pubkey, event.content)
      : event.content;
    const message = decodePrivateRelayMessage(plaintext);
    if (message.type === 'request' && message.replyPubkey !== event.pubkey) return;
    if (message.type === 'quote' && message.peerPubkey !== event.pubkey) return;
    input.onMessage({ event, message });
  }

  async waitFor(
    input: {
      peerPublicKey: string;
      requestId: string;
      quoteId: string;
      prepareId?: string;
      types: readonly PrivateRelayMessage['type'][];
      timeoutMs?: number;
      /** Human approval uses the existing absolute quote/payout deadline, never a renewed timeout. */
      deadlineSeconds?: number;
      publish(): Promise<void>;
    },
    signal?: AbortSignal,
  ): Promise<PrivateRelayMessage> {
    this.assertOpen();
    if (signal?.aborted) throw abortError();
    const deadline = input.deadlineSeconds;
    const timeoutMs = deadline === undefined ? input.timeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS : deadline * 1000 - Date.now();
    if (deadline !== undefined && (!Number.isSafeInteger(deadline) || timeoutMs <= 0 ||
      deadline > nowSeconds() + PRIVATE_RELAY_MAX_TTL_SECONDS)) {
      throw new Error('Private relay approval deadline is invalid or expired');
    }
    if (deadline === undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000)) {
      throw new Error('Private relay response timeout is invalid');
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let subscription: PrivateRelaySubscription | undefined;
      const controller = new AbortController();
      const expired = () => new Error(deadline === undefined
        ? 'Privacy relay peer did not respond in time'
        : 'Private relay approval expired before a signed response.');
      const timer = setTimeout(() => fail(expired()), timeoutMs);
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.pendingWaits.delete(abort);
        controller.abort();
        subscription?.close();
      };
      const fail = (cause: unknown) => {
        if (settled) return;
        cleanup();
        reject(cause);
      };
      const abort = () => fail(abortError());
      this.pendingWaits.add(abort);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        subscription = this.subscribe({
          encrypted: true,
          peerPublicKey: input.peerPublicKey,
          onMessage: ({ message }) => {
            if (settled) return;
            if (deadline !== undefined && Date.now() >= deadline * 1000) { fail(expired()); return; }
            if (
              message.requestId !== input.requestId ||
              !('quoteId' in message) ||
              message.quoteId !== input.quoteId ||
              (message.type === 'prepared-job' && message.prepareId !== input.prepareId) ||
              !input.types.includes(message.type)
            ) return;
            cleanup();
            resolve(message);
          },
        }, controller.signal);
        if (signal?.aborted || this.closed) abort();
        if (settled) subscription.close();
        else input.publish().catch(fail);
      } catch (cause) { fail(cause); }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const abort of this.pendingWaits) abort();
    this.replay.clear();
    this.transport.close();
    this.identity.secretKey.fill(0);
  }
}

export class PrivateRelaySenderSession {
  private readonly messenger: PrivateRelayMessenger;

  private constructor(messenger: PrivateRelayMessenger) {
    this.messenger = messenger;
  }

  static async create(relayUrls: readonly string[]): Promise<PrivateRelaySenderSession> {
    return new PrivateRelaySenderSession(await PrivateRelayMessenger.create(relayUrls));
  }

  get publicKey(): string {
    return this.messenger.publicKey;
  }

  async requestQuotes(input: {
    networkId: string;
    poolContractId: string;
    actionKind: 'transfer' | 'withdraw';
    quoteWindowMs?: number;
    settleWindowMs?: number;
    excludePeerAccounts?: readonly string[];
    onQuotes?: (quotes: readonly PrivateRelayQuote[], request: PrivateRelayRequest) => void;
    onIneligiblePeerAccounts?: (count: number) => void;
  }, signal?: AbortSignal): Promise<{
    request: PrivateRelayRequest;
    quotes: PrivateRelayQuote[];
    ineligiblePeerAccounts: number;
  }> {
    const quoteWindowMs = input.quoteWindowMs ?? 6_000;
    if (!Number.isSafeInteger(quoteWindowMs) || quoteWindowMs < 1_000 || quoteWindowMs > MAX_QUOTE_WINDOW_MS) {
      throw new Error('Private relay quote window is invalid');
    }
    const settleWindowMs = input.settleWindowMs ?? DEFAULT_QUOTE_SETTLE_MS;
    if (
      !Number.isSafeInteger(settleWindowMs) ||
      settleWindowMs < 25 ||
      settleWindowMs > quoteWindowMs
    ) {
      throw new Error('Private relay quote settle window is invalid');
    }
    const request: PrivateRelayRequest = {
      version: 2,
      type: 'request',
      requestId: createPrivateRelayId(),
      networkId: input.networkId,
      poolContractId: input.poolContractId,
      replyPubkey: this.publicKey,
      nonce: createPrivateRelayId(),
      expiresAt: nowSeconds() + PRIVATE_RELAY_MAX_TTL_SECONDS,
    };
    const quotes = new Map<string, PrivateRelayQuote>();
    const excludedPeerAccounts = new Set(input.excludePeerAccounts ?? []);
    const ineligiblePeerAccounts = new Set<string>();
    const controller = new AbortController();
    const abort = () => controller.abort();
    let hardDeadline: ReturnType<typeof setTimeout> | null = null;
    let settleDeadline: ReturnType<typeof setTimeout> | null = null;
    let settleDiscovery: (() => void) | null = null;
    let rejectDiscovery: ((cause: unknown) => void) | null = null;
    const discovery = new Promise<void>((resolve, reject) => {
      settleDiscovery = resolve;
      rejectDiscovery = reject;
    });
    const finishDiscovery = () => {
      settleDiscovery?.();
      settleDiscovery = null;
      rejectDiscovery = null;
    };
    const abortDiscovery = () => {
      rejectDiscovery?.(abortError());
      settleDiscovery = null;
      rejectDiscovery = null;
    };
    controller.signal.addEventListener('abort', abortDiscovery, { once: true });
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, { once: true });
    hardDeadline = setTimeout(finishDiscovery, quoteWindowMs);
    const subscription = this.messenger.subscribe({
      encrypted: true,
      onMessage: ({ event, message }) => {
        if (message.type !== 'quote' || message.requestId !== request.requestId) return;
        if (
          controller.signal.aborted || event.pubkey !== message.peerPubkey ||
          !verifyPrivateRelayQuoteAuthorization(request, message)
        ) return;
        if (excludedPeerAccounts.has(message.peerAccount)) {
          const previousSize = ineligiblePeerAccounts.size;
          ineligiblePeerAccounts.add(message.peerAccount);
          if (ineligiblePeerAccounts.size !== previousSize) {
            try {
              input.onIneligiblePeerAccounts?.(ineligiblePeerAccounts.size);
            } catch {
              // UI observers cannot interfere with the authenticated relay session.
            }
          }
          return;
        }
        const existing = quotes.get(message.peerAccount);
        if (!existing && quotes.size >= MAX_RELAY_QUOTES) return;
        if (existing && BigInt(message.feeAtomic) >= BigInt(existing.feeAtomic)) return;
        quotes.set(message.peerAccount, message);
        const ranked = rankPrivateRelayQuotes(
          [...quotes.values()],
          nowSeconds(),
          input.excludePeerAccounts,
        );
        try {
          // Live selection needs the authenticated context, but observers must
          // not be able to change the retained request or fee snapshots.
          input.onQuotes?.(ranked.map(quote => ({ ...quote })), { ...request });
        } catch {
          // UI observers cannot interfere with the authenticated relay session.
        }
        if (settleDeadline) clearTimeout(settleDeadline);
        settleDeadline = setTimeout(finishDiscovery, settleWindowMs);
      },
    }, controller.signal);
    try {
      await Promise.all([
        this.messenger.publish(request, undefined, controller.signal),
        discovery,
      ]);
      return {
        request,
        quotes: rankPrivateRelayQuotes(
          [...quotes.values()],
          nowSeconds(),
          input.excludePeerAccounts,
        ),
        ineligiblePeerAccounts: ineligiblePeerAccounts.size,
      };
    } finally {
      if (hardDeadline) clearTimeout(hardDeadline);
      if (settleDeadline) clearTimeout(settleDeadline);
      controller.signal.removeEventListener('abort', abortDiscovery);
      controller.abort();
      subscription.close();
      signal?.removeEventListener('abort', abort);
    }
  }

  async selectQuote(input: {
    request: PrivateRelayRequest;
    quote: PrivateRelayQuote;
    actionKind: 'transfer' | 'withdraw';
    assetIndex: number;
    actionDiversifier: string;
  }, signal?: AbortSignal): Promise<PrivateRelayPayout> {
    // Copy the authenticated context so callers cannot replace it while an
    // asynchronous response subscription or encrypted publication is pending.
    const request = { ...input.request };
    const quote = { ...input.quote };
    const assertAuthenticated = () => {
      if (
        request.replyPubkey !== this.publicKey ||
        !verifyPrivateRelayQuoteAuthorization(request, quote)
      ) throw new Error('Private relay account authentication context is invalid or expired');
    };
    assertAuthenticated();
    const selection: PrivateRelaySelection = {
      version: 2,
      type: 'selection',
      requestId: request.requestId,
      quoteId: quote.quoteId,
      actionKind: input.actionKind,
      assetIndex: input.assetIndex,
      actionDiversifier: input.actionDiversifier,
      nonce: createPrivateRelayId(),
      expiresAt: Math.min(quote.expiresAt, nowSeconds() + DEFAULT_MESSAGE_TTL_SECONDS),
    };
    const response = await this.messenger.waitFor({
      peerPublicKey: quote.peerPubkey,
      requestId: request.requestId,
      quoteId: quote.quoteId,
      types: ['payout', 'rejected'],
      publish: () => {
        assertAuthenticated();
        return this.messenger.publish(selection, quote.peerPubkey, signal);
      },
    }, signal);
    if (response.type === 'rejected') throw new Error(`Privacy relay rejected the selection: ${response.reason}`);
    if (response.type !== 'payout') throw new Error('Privacy relay returned the wrong selection response');
    if (response.peerAccount !== quote.peerAccount || response.feeAtomic !== quote.feeAtomic) {
      throw new Error('Privacy relay changed its quoted account or fee');
    }
    return response;
  }

  async requestPreparation(input: {
    quote: PrivateRelayQuote;
    payout: PrivateRelayPayout;
    operationXdr: string;
    maxTime: number;
    classicFeeStroops: string;
    maximumResourceFeeStroops: string;
  }, signal?: AbortSignal): Promise<PrivateRelayPreparedJob> {
    if (input.quote.requestId !== input.payout.requestId || input.quote.quoteId !== input.payout.quoteId ||
      input.quote.peerAccount !== input.payout.peerAccount || input.quote.feeAtomic !== input.payout.feeAtomic ||
      input.maxTime > Math.min(input.quote.expiresAt, input.payout.expiresAt)) {
      throw new Error('Private relay preparation context changed');
    }
    const job: PrivateRelayPrepareJob = {
      version: 2, type: 'prepare-job', requestId: input.quote.requestId, quoteId: input.quote.quoteId,
      prepareId: createPrivateRelayId(), operationXdr: input.operationXdr, maxTime: input.maxTime,
      classicFeeStroops: input.classicFeeStroops, maximumResourceFeeStroops: input.maximumResourceFeeStroops,
      nonce: createPrivateRelayId(), expiresAt: input.maxTime,
    };
    const response = await this.messenger.waitFor({
      peerPublicKey: input.quote.peerPubkey, requestId: job.requestId, quoteId: job.quoteId,
      prepareId: job.prepareId, types: ['prepared-job', 'rejected'], timeoutMs: 60_000,
      publish: () => this.messenger.publish(job, input.quote.peerPubkey, signal),
    }, signal);
    if (response.type === 'rejected') throw new Error(`Privacy relay preparation rejected: ${response.reason}`);
    if (response.type !== 'prepared-job' || response.prepareId !== job.prepareId) {
      throw new Error('Private relay preparation response does not match');
    }
    return response;
  }

  async requestSignature(input: {
    quote: PrivateRelayQuote;
    payout: PrivateRelayPayout;
    unsignedEnvelopeXdr: string;
    transactionHash: string;
  }, signal?: AbortSignal): Promise<PrivateRelaySignedJob> {
    const quote = { ...input.quote };
    const payout = { ...input.payout };
    if (quote.requestId !== payout.requestId || quote.quoteId !== payout.quoteId ||
      quote.peerAccount !== payout.peerAccount || quote.feeAtomic !== payout.feeAtomic) {
      throw new Error('Private relay signature context changed');
    }
    if ([quote.expiresAt, payout.expiresAt].some(expiry => !Number.isSafeInteger(expiry) ||
      expiry <= nowSeconds() || expiry > nowSeconds() + PRIVATE_RELAY_MAX_TTL_SECONDS)) {
      throw new Error('Private relay approval deadline is invalid or expired');
    }
    const job: PrivateRelaySignJob = {
      version: 2,
      type: 'sign-job',
      requestId: payout.requestId,
      quoteId: payout.quoteId,
      unsignedEnvelopeXdr: input.unsignedEnvelopeXdr,
      transactionHash: input.transactionHash,
      nonce: createPrivateRelayId(),
      expiresAt: Math.min(quote.expiresAt, payout.expiresAt),
    };
    const response = await this.messenger.waitFor({
      peerPublicKey: quote.peerPubkey,
      requestId: job.requestId,
      quoteId: job.quoteId,
      types: ['signed-job', 'rejected'],
      deadlineSeconds: job.expiresAt,
      publish: () => this.messenger.publish(job, quote.peerPubkey, signal),
    }, signal);
    if (response.type === 'rejected') throw new Error(`Privacy relay rejected signing: ${response.reason}`);
    if (response.type !== 'signed-job' || response.transactionHash !== job.transactionHash ||
      !Number.isSafeInteger(response.expiresAt) || response.expiresAt <= nowSeconds() || response.expiresAt > job.expiresAt) {
      throw new Error('Privacy relay signed response does not match the reviewed transaction');
    }
    return response;
  }

  async requestSubmission(input: {
    quote: PrivateRelayQuote;
    signed: PrivateRelaySignedJob;
  }, signal?: AbortSignal): Promise<PrivateRelaySubmitted> {
    const job: PrivateRelaySubmitJob = {
      version: 2,
      type: 'submit-job',
      requestId: input.signed.requestId,
      quoteId: input.signed.quoteId,
      transactionHash: input.signed.transactionHash,
      signedEnvelopeXdr: input.signed.signedEnvelopeXdr,
      nonce: createPrivateRelayId(),
      expiresAt: Math.min(input.signed.expiresAt, nowSeconds() + DEFAULT_MESSAGE_TTL_SECONDS),
    };
    const response = await this.messenger.waitFor({
      peerPublicKey: input.quote.peerPubkey,
      requestId: input.signed.requestId,
      quoteId: input.signed.quoteId,
      types: ['submitted', 'rejected'],
      publish: () => this.messenger.publish(job, input.quote.peerPubkey, signal),
    }, signal);
    if (response.type === 'rejected') throw new Error(`Privacy relay rejected submission: ${response.reason}`);
    if (response.type !== 'submitted' || response.transactionHash !== input.signed.transactionHash) {
      throw new Error('Privacy relay submission response does not match the reviewed transaction');
    }
    return response;
  }

  close(): void {
    this.messenger.close();
  }
}

export class PrivateRelayHelperSession {
  private readonly quotes = new Map<string, PrivateRelayQuote>();
  private closed = false;
  private readonly senderByQuote = new Map<string, string>();
  private readonly quoteExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly messenger: PrivateRelayMessenger;

  private constructor(messenger: PrivateRelayMessenger) {
    this.messenger = messenger;
  }

  static async create(relayUrls: readonly string[]): Promise<PrivateRelayHelperSession> {
    return new PrivateRelayHelperSession(await PrivateRelayMessenger.create(relayUrls));
  }

  get publicKey(): string {
    return this.messenger.publicKey;
  }

  waitUntilConnected(signal?: AbortSignal) {
    return this.messenger.waitUntilConnected(signal);
  }

  connectionStatus() {
    return this.messenger.connectionStatus();
  }

  private forgetQuote(quoteId: string): void {
    this.quotes.delete(quoteId);
    this.senderByQuote.delete(quoteId);
    const timer = this.quoteExpiryTimers.get(quoteId);
    if (timer) clearTimeout(timer);
    this.quoteExpiryTimers.delete(quoteId);
  }

  private rememberQuote(quote: PrivateRelayQuote, request: PrivateRelayRequest): void {
    if (this.closed) throw new Error('Private relay helper is closed');
    this.forgetQuote(quote.quoteId);
    this.quotes.set(quote.quoteId, quote);
    this.senderByQuote.set(quote.quoteId, request.replyPubkey);
    const remainingMs = Math.max(0, quote.expiresAt * 1_000 - Date.now());
    this.quoteExpiryTimers.set(
      quote.quoteId,
      setTimeout(() => this.forgetQuote(quote.quoteId), remainingMs),
    );
  }

  listenForRequests(
    onRequest: (request: PrivateRelayRequest) => void,
    signal?: AbortSignal,
  ): PrivateRelaySubscription {
    return this.messenger.subscribe({
      encrypted: false,
      onMessage: ({ message }) => {
        if (message.type === 'request') onRequest(message);
      },
    }, signal);
  }

  listenForPrivateMessages(
    onMessage: (
      message: PrivateRelaySelection | PrivateRelayPrepareJob | PrivateRelaySignJob | PrivateRelaySubmitJob,
      quote: PrivateRelayQuote,
    ) => void,
    signal?: AbortSignal,
  ): PrivateRelaySubscription {
    return this.messenger.subscribe({
      encrypted: true,
      onMessage: ({ event, message }) => {
        if (
          message.type !== 'selection' &&
          message.type !== 'prepare-job' &&
          message.type !== 'sign-job' &&
          message.type !== 'submit-job'
        ) return;
        const quote = this.quotes.get(message.quoteId);
        const senderPublicKey = this.senderByQuote.get(message.quoteId);
        if (this.closed || !quote || quote.requestId !== message.requestId || event.pubkey !== senderPublicKey ||
          quote.expiresAt <= nowSeconds() || message.expiresAt > quote.expiresAt || message.expiresAt <= nowSeconds()) return;
        onMessage(message, quote);
      },
    }, signal);
  }

  async offerQuote(input: {
    request: PrivateRelayRequest;
    peerAccount: string;
    feeAtomic: string;
    signAccountQuote(request: PrivateRelayRequest, quote: PrivateRelayUnsignedQuote): Promise<string>;
  }, signal?: AbortSignal): Promise<PrivateRelayQuote> {
    if (this.closed || this.quotes.size >= MAX_RELAY_QUOTES) throw new Error('Private relay helper is unavailable');
    const request = { ...input.request };
    const unsignedQuote: PrivateRelayUnsignedQuote = {
      version: 2,
      type: 'quote',
      requestId: request.requestId,
      quoteId: createPrivateRelayId(),
      peerPubkey: this.publicKey,
      peerAccount: input.peerAccount,
      feeAtomic: input.feeAtomic,
      nonce: createPrivateRelayId(),
      expiresAt: Math.min(request.expiresAt, nowSeconds() + DEFAULT_MESSAGE_TTL_SECONDS),
    };
    if (signal?.aborted) throw abortError();
    const quote: PrivateRelayQuote = {
      ...unsignedQuote,
      accountSignature: await input.signAccountQuote({ ...request }, { ...unsignedQuote }),
    };
    if (signal?.aborted) throw abortError();
    if (!verifyPrivateRelayQuoteAuthorization(request, quote)) {
      throw new Error('Private relay quote account authentication failed');
    }
    this.rememberQuote(quote, request);
    try {
      await this.messenger.publish(quote, request.replyPubkey, signal);
      if (this.closed || signal?.aborted) throw abortError();
      return quote;
    } catch (cause) {
      this.forgetQuote(quote.quoteId);
      throw cause;
    }
  }

  async sendPayout(input: {
    selection: PrivateRelaySelection;
    quote: PrivateRelayQuote;
    privateFeeAddress: string;
  }, signal?: AbortSignal): Promise<PrivateRelayPayout> {
    const payout: PrivateRelayPayout = {
      version: 2,
      type: 'payout',
      requestId: input.selection.requestId,
      quoteId: input.selection.quoteId,
      peerAccount: input.quote.peerAccount,
      feeAtomic: input.quote.feeAtomic,
      privateFeeAddress: input.privateFeeAddress,
      nonce: createPrivateRelayId(),
      expiresAt: Math.min(input.selection.expiresAt, nowSeconds() + DEFAULT_MESSAGE_TTL_SECONDS),
    };
    const senderPublicKey = this.senderByQuote.get(input.quote.quoteId);
    if (!senderPublicKey) throw new Error('Private relay sender key is unavailable');
    await this.messenger.publish(payout, senderPublicKey, signal);
    return payout;
  }

  async sendPrepared(input: {
    job: PrivateRelayPrepareJob;
    preparedEnvelopeXdr: string;
    accountSequence: string;
    simulationLedger: number;
  }, signal?: AbortSignal): Promise<PrivateRelayPreparedJob> {
    const senderPublicKey = this.senderByQuote.get(input.job.quoteId);
    if (!senderPublicKey) throw new Error('Private relay sender key is unavailable');
    const response: PrivateRelayPreparedJob = {
      version: 2, type: 'prepared-job', requestId: input.job.requestId, quoteId: input.job.quoteId,
      prepareId: input.job.prepareId, preparedEnvelopeXdr: input.preparedEnvelopeXdr,
      accountSequence: input.accountSequence, simulationLedger: input.simulationLedger,
      nonce: createPrivateRelayId(), expiresAt: input.job.expiresAt,
    };
    await this.messenger.publish(response, senderPublicKey, signal);
    return response;
  }

  async sendSigned(input: {
    job: PrivateRelaySignJob;
    quote: PrivateRelayQuote;
    signedEnvelopeXdr: string;
    /** Register exact authorization synchronously: delivery can precede the relay's publication acknowledgement. */
    onBeforePublish?(response: Readonly<PrivateRelaySignedJob>): void;
  }, signal?: AbortSignal): Promise<PrivateRelaySignedJob> {
    if (this.closed || signal?.aborted) throw abortError();
    if (input.job.requestId !== input.quote.requestId || input.job.quoteId !== input.quote.quoteId ||
      input.job.expiresAt <= nowSeconds() || input.job.expiresAt > input.quote.expiresAt) {
      throw new Error('Private relay signed job context changed or expired');
    }
    const response: PrivateRelaySignedJob = Object.freeze({
      version: 2,
      type: 'signed-job',
      requestId: input.job.requestId,
      quoteId: input.job.quoteId,
      transactionHash: input.job.transactionHash,
      signedEnvelopeXdr: input.signedEnvelopeXdr,
      nonce: createPrivateRelayId(),
      expiresAt: Math.min(input.job.expiresAt, nowSeconds() + DEFAULT_MESSAGE_TTL_SECONDS),
    });
    const senderPublicKey = this.senderByQuote.get(input.quote.quoteId);
    if (!senderPublicKey) throw new Error('Private relay sender key is unavailable');
    input.onBeforePublish?.(response);
    await this.messenger.publish(response, senderPublicKey, signal);
    return response;
  }

  async sendSubmitted(input: {
    job: PrivateRelaySubmitJob;
    quote: PrivateRelayQuote;
    rpcStatus: PrivateRelaySubmitted['rpcStatus'];
  }, signal?: AbortSignal): Promise<PrivateRelaySubmitted> {
    const response: PrivateRelaySubmitted = {
      version: 2,
      type: 'submitted',
      requestId: input.job.requestId,
      quoteId: input.job.quoteId,
      transactionHash: input.job.transactionHash,
      rpcStatus: input.rpcStatus,
      nonce: createPrivateRelayId(),
      expiresAt: Math.min(input.job.expiresAt, nowSeconds() + DEFAULT_MESSAGE_TTL_SECONDS),
    };
    const senderPublicKey = this.senderByQuote.get(input.quote.quoteId);
    if (!senderPublicKey) throw new Error('Private relay sender key is unavailable');
    await this.messenger.publish(response, senderPublicKey, signal);
    return response;
  }

  async reject(input: {
    requestId: string;
    quoteId: string;
    senderPublicKey: string;
    reason: PrivateRelayRejected['reason'];
    expiresAt: number;
  }, signal?: AbortSignal): Promise<void> {
    await this.messenger.publish({
      version: 2,
      type: 'rejected',
      requestId: input.requestId,
      quoteId: input.quoteId,
      reason: input.reason,
      nonce: createPrivateRelayId(),
      expiresAt: Math.min(input.expiresAt, nowSeconds() + DEFAULT_MESSAGE_TTL_SECONDS),
    }, input.senderPublicKey, signal);
  }

  async rejectForQuote(input: {
    requestId: string;
    quoteId: string;
    reason: PrivateRelayRejected['reason'];
    expiresAt: number;
  }, signal?: AbortSignal): Promise<void> {
    const senderPublicKey = this.senderByQuote.get(input.quoteId);
    if (!senderPublicKey) return;
    await this.reject({ ...input, senderPublicKey }, signal);
  }

  close(): void {
    this.closed = true;
    for (const timer of this.quoteExpiryTimers.values()) clearTimeout(timer);
    this.quoteExpiryTimers.clear();
    this.quotes.clear();
    this.senderByQuote.clear();
    this.messenger.close();
  }
}
