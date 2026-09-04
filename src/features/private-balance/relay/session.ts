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
  PrivateRelayReplayGuard,
  type PrivateRelayMessage,
  type PrivateRelayPayout,
  type PrivateRelayQuote,
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

const DEFAULT_MESSAGE_TTL_SECONDS = 120;
const DEFAULT_RESPONSE_TIMEOUT_MS = 20_000;
const MAX_QUOTE_WINDOW_MS = 20_000;

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
    const encoded = encodePrivateRelayMessage(message);
    const content = peerPublicKey
      ? await encryptPrivateRelayPayload(this.identity.secretKey, peerPublicKey, encoded)
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
      types: readonly PrivateRelayMessage['type'][];
      timeoutMs?: number;
      publish(): Promise<void>;
    },
    signal?: AbortSignal,
  ): Promise<PrivateRelayMessage> {
    this.assertOpen();
    if (signal?.aborted) throw abortError();
    const timeoutMs = input.timeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
      throw new Error('Private relay response timeout is invalid');
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const controller = new AbortController();
      const timer = setTimeout(() => fail(new Error('Privacy relay peer did not respond in time')), timeoutMs);
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        controller.abort();
      };
      const fail = (cause: unknown) => {
        cleanup();
        reject(cause);
      };
      const abort = () => fail(abortError());
      const subscription = this.subscribe({
        encrypted: true,
        peerPublicKey: input.peerPublicKey,
        onMessage: ({ message }) => {
          if (
            message.requestId !== input.requestId ||
            !('quoteId' in message) ||
            message.quoteId !== input.quoteId ||
            !input.types.includes(message.type)
          ) return;
          cleanup();
          resolve(message);
        },
      }, controller.signal);
      signal?.addEventListener('abort', abort, { once: true });
      input.publish().catch(fail);
      if (settled) subscription.close();
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
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
    excludePeerAccounts?: readonly string[];
  }, signal?: AbortSignal): Promise<{ request: PrivateRelayRequest; quotes: PrivateRelayQuote[] }> {
    const quoteWindowMs = input.quoteWindowMs ?? 6_000;
    if (!Number.isSafeInteger(quoteWindowMs) || quoteWindowMs < 1_000 || quoteWindowMs > MAX_QUOTE_WINDOW_MS) {
      throw new Error('Private relay quote window is invalid');
    }
    const request: PrivateRelayRequest = {
      version: 1,
      type: 'request',
      requestId: createPrivateRelayId(),
      networkId: input.networkId,
      poolContractId: input.poolContractId,
      actionKind: input.actionKind,
      replyPubkey: this.publicKey,
      nonce: createPrivateRelayId(),
      expiresAt: nowSeconds() + Math.ceil(quoteWindowMs / 1_000) + 30,
    };
    const quotes = new Map<string, PrivateRelayQuote>();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const subscription = this.messenger.subscribe({
      encrypted: true,
      onMessage: ({ message }) => {
        if (message.type !== 'quote' || message.requestId !== request.requestId) return;
        quotes.set(message.quoteId, message);
      },
    }, controller.signal);
    try {
      await this.messenger.publish(request, undefined, signal);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, quoteWindowMs);
        const abortWait = () => {
          clearTimeout(timer);
          reject(abortError());
        };
        if (signal?.aborted) abortWait();
        else signal?.addEventListener('abort', abortWait, { once: true });
      });
      return {
        request,
        quotes: rankPrivateRelayQuotes(
          [...quotes.values()],
          nowSeconds(),
          input.excludePeerAccounts,
        ),
      };
    } finally {
      controller.abort();
      subscription.close();
      signal?.removeEventListener('abort', abort);
    }
  }

  async selectQuote(input: {
    request: PrivateRelayRequest;
    quote: PrivateRelayQuote;
    assetIndex: number;
    actionDiversifier: string;
  }, signal?: AbortSignal): Promise<PrivateRelayPayout> {
    const selection: PrivateRelaySelection = {
      version: 1,
      type: 'selection',
      requestId: input.request.requestId,
      quoteId: input.quote.quoteId,
      assetIndex: input.assetIndex,
      actionDiversifier: input.actionDiversifier,
      nonce: createPrivateRelayId(),
      expiresAt: Math.min(input.quote.expiresAt, nowSeconds() + DEFAULT_MESSAGE_TTL_SECONDS),
    };
    const response = await this.messenger.waitFor({
      peerPublicKey: input.quote.peerPubkey,
      requestId: input.request.requestId,
      quoteId: input.quote.quoteId,
      types: ['payout', 'rejected'],
      publish: () => this.messenger.publish(selection, input.quote.peerPubkey, signal),
    }, signal);
    if (response.type === 'rejected') throw new Error(`Privacy relay rejected the selection: ${response.reason}`);
    if (response.type !== 'payout') throw new Error('Privacy relay returned the wrong selection response');
    if (response.peerAccount !== input.quote.peerAccount || response.feeAtomic !== input.quote.feeAtomic) {
      throw new Error('Privacy relay changed its quoted account or fee');
    }
    return response;
  }

  async requestSignature(input: {
    quote: PrivateRelayQuote;
    payout: PrivateRelayPayout;
    unsignedEnvelopeXdr: string;
    transactionHash: string;
  }, signal?: AbortSignal): Promise<PrivateRelaySignedJob> {
    const job: PrivateRelaySignJob = {
      version: 1,
      type: 'sign-job',
      requestId: input.payout.requestId,
      quoteId: input.payout.quoteId,
      unsignedEnvelopeXdr: input.unsignedEnvelopeXdr,
      transactionHash: input.transactionHash,
      nonce: createPrivateRelayId(),
      expiresAt: Math.min(input.payout.expiresAt, nowSeconds() + DEFAULT_MESSAGE_TTL_SECONDS),
    };
    const response = await this.messenger.waitFor({
      peerPublicKey: input.quote.peerPubkey,
      requestId: input.payout.requestId,
      quoteId: input.payout.quoteId,
      types: ['signed-job', 'rejected'],
      publish: () => this.messenger.publish(job, input.quote.peerPubkey, signal),
    }, signal);
    if (response.type === 'rejected') throw new Error(`Privacy relay rejected signing: ${response.reason}`);
    if (response.type !== 'signed-job' || response.transactionHash !== input.transactionHash) {
      throw new Error('Privacy relay signed response does not match the reviewed transaction');
    }
    return response;
  }

  async requestSubmission(input: {
    quote: PrivateRelayQuote;
    signed: PrivateRelaySignedJob;
  }, signal?: AbortSignal): Promise<PrivateRelaySubmitted> {
    const job: PrivateRelaySubmitJob = {
      version: 1,
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
  private readonly senderByQuote = new Map<string, string>();
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
      message: PrivateRelaySelection | PrivateRelaySignJob | PrivateRelaySubmitJob,
      quote: PrivateRelayQuote,
    ) => void,
    signal?: AbortSignal,
  ): PrivateRelaySubscription {
    return this.messenger.subscribe({
      encrypted: true,
      onMessage: ({ event, message }) => {
        if (
          message.type !== 'selection' &&
          message.type !== 'sign-job' &&
          message.type !== 'submit-job'
        ) return;
        const quote = this.quotes.get(message.quoteId);
        const senderPublicKey = this.senderByQuote.get(message.quoteId);
        if (!quote || quote.requestId !== message.requestId || event.pubkey !== senderPublicKey) return;
        onMessage(message, quote);
      },
    }, signal);
  }

  async offerQuote(input: {
    request: PrivateRelayRequest;
    peerAccount: string;
    feeAtomic: string;
  }, signal?: AbortSignal): Promise<PrivateRelayQuote> {
    const quote: PrivateRelayQuote = {
      version: 1,
      type: 'quote',
      requestId: input.request.requestId,
      quoteId: createPrivateRelayId(),
      peerPubkey: this.publicKey,
      peerAccount: input.peerAccount,
      feeAtomic: input.feeAtomic,
      nonce: createPrivateRelayId(),
      expiresAt: Math.min(input.request.expiresAt, nowSeconds() + DEFAULT_MESSAGE_TTL_SECONDS),
    };
    await this.messenger.publish(quote, input.request.replyPubkey, signal);
    this.quotes.set(quote.quoteId, quote);
    this.senderByQuote.set(quote.quoteId, input.request.replyPubkey);
    return quote;
  }

  async sendPayout(input: {
    selection: PrivateRelaySelection;
    quote: PrivateRelayQuote;
    privateFeeAddress: string;
  }, signal?: AbortSignal): Promise<PrivateRelayPayout> {
    const payout: PrivateRelayPayout = {
      version: 1,
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

  async sendSigned(input: {
    job: PrivateRelaySignJob;
    quote: PrivateRelayQuote;
    signedEnvelopeXdr: string;
  }, signal?: AbortSignal): Promise<PrivateRelaySignedJob> {
    const response: PrivateRelaySignedJob = {
      version: 1,
      type: 'signed-job',
      requestId: input.job.requestId,
      quoteId: input.job.quoteId,
      transactionHash: input.job.transactionHash,
      signedEnvelopeXdr: input.signedEnvelopeXdr,
      nonce: createPrivateRelayId(),
      expiresAt: Math.min(input.job.expiresAt, nowSeconds() + DEFAULT_MESSAGE_TTL_SECONDS),
    };
    const senderPublicKey = this.senderByQuote.get(input.quote.quoteId);
    if (!senderPublicKey) throw new Error('Private relay sender key is unavailable');
    await this.messenger.publish(response, senderPublicKey, signal);
    return response;
  }

  async sendSubmitted(input: {
    job: PrivateRelaySubmitJob;
    quote: PrivateRelayQuote;
    rpcStatus: PrivateRelaySubmitted['rpcStatus'];
  }, signal?: AbortSignal): Promise<PrivateRelaySubmitted> {
    const response: PrivateRelaySubmitted = {
      version: 1,
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
      version: 1,
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
    this.quotes.clear();
    this.senderByQuote.clear();
    this.messenger.close();
  }
}
