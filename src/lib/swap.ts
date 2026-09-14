"use client";

import {
  Account,
  Asset,
  type Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { NETWORKS, type NetworkKey } from "./stellar";
import { getHorizonUrl } from "./stellar-endpoints";
import { normalizeAmount } from "./format";
import {
  getJson,
  fetchCurrentBaseReserve,
  loadRecommendedBaseFee,
  SendError,
  explainSubmitError,
  resolveSource,
  signAndSubmit,
} from "./api";
import type { HardwareSigner } from "./hardware";
import { getHorizonJson } from "./horizon";
import { amountToStroops, calculateMinimumBalance, stroopsToAmount, toStellarAsset } from "./stellar-domain";
import type { SubmissionPreparedCallback, SubmissionResult } from "./submission";

export interface SwapRoute {
  destinationAmount: string;
  intermediates: Asset[];
}

export interface StrictReceiveSwapRoute {
  sourceAmount: string;
  intermediates: Asset[];
}

export interface SwapTrustlineAuthorization {
  /** The additional locked reserve shown in this swap's confirmation. */
  maximumReserveXlm: string;
}

export type SwapSubmissionResult = SubmissionResult & { feeXlm: string };

interface SwapSigningParams {
  network: NetworkKey;
  secretKey?: string;
  softwareSigner?: Keypair;
  hardwareSigner?: HardwareSigner;
  sendCode: string;
  sendIssuer?: string | null;
  destCode: string;
  destIssuer?: string | null;
  feeStroops?: number;
  destinationTrustline?: SwapTrustlineAuthorization;
  authorizeBeforeSigning?: () => void;
}

interface SwapSourceAccount {
  sequence: string;
  subentry_count?: number;
  num_sponsoring?: number;
  num_sponsored?: number;
  balances?: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string;
    balance: string; selling_liabilities?: string; is_authorized?: boolean }>;
}

async function prepareSwapBuilder(params: SwapSigningParams, maximumSend: string) {
  params.authorizeBeforeSigning?.();
  const { kp, publicKey } = resolveSource(params.secretKey, params.hardwareSigner, params.softwareSigner);
  const source = await getJson<SwapSourceAccount>(`${getHorizonUrl(params.network)}/accounts/${publicKey}`);
  if (!source) throw new SendError("Your account does not exist on this network.");
  const fee = await loadRecommendedBaseFee(params.network, params.feeStroops);
  const builder = new TransactionBuilder(new Account(publicKey, source.sequence), {
    fee: String(fee), networkPassphrase: NETWORKS[params.network].networkPassphrase,
  });
  const destination = toStellarAsset(params.destCode, params.destIssuer);
  if (!destination.isNative() && destination.getIssuer() !== publicKey) {
    if (!Array.isArray(source.balances)) throw new SendError("Unable to verify account balances. Refresh and review the swap again.");
    const trustline = source.balances.find(balance => balance.asset_type !== 'native'
      && balance.asset_code === destination.getCode() && balance.asset_issuer === destination.getIssuer());
    if (trustline) {
      // Zero balance is still a trustline. Never widen its limit or reset its flags.
      if (trustline.is_authorized !== true) throw new SendError("This asset's trustline requires issuer authorization before swapping.");
    } else {
      if (!params.destinationTrustline) throw new SendError("The receiving trustline is missing. Review the swap again to approve its creation.");
      const [baseReserve, issuer] = await Promise.all([
        fetchCurrentBaseReserve(params.network, true),
        getJson<{ flags?: { auth_required?: boolean } }>(`${getHorizonUrl(params.network)}/accounts/${destination.getIssuer()}`),
      ]);
      if (issuer?.flags?.auth_required !== false) throw new SendError("Issuer authorization is required or could not be verified. Set up an authorized trustline before swapping this asset.");
      if (BigInt(baseReserve) > amountToStroops(params.destinationTrustline.maximumReserveXlm)) {
        throw new SendError("The trustline reserve has increased. Review the swap again.");
      }
      const counts = [source.subentry_count, source.num_sponsoring, source.num_sponsored];
      if (counts.some(value => !Number.isSafeInteger(value) || value! < 0)) {
        throw new SendError("Unable to verify account reserve requirements. Refresh and review the swap again.");
      }
      const minimumAfter = amountToStroops(calculateMinimumBalance({ baseReserveStroops: baseReserve,
        subentryCount: source.subentry_count! + 1, numSponsoring: source.num_sponsoring!, numSponsored: source.num_sponsored! }));
      const native = source.balances.find(balance => balance.asset_type === 'native');
      if (!native) throw new SendError("Unable to verify the account's XLM balance.");
      const spendable = amountToStroops(native.balance) - amountToStroops(native.selling_liabilities ?? '0');
      const nativeSpend = toStellarAsset(params.sendCode, params.sendIssuer).isNative() ? amountToStroops(maximumSend) : 0n;
      if (spendable < minimumAfter + BigInt(fee) * 2n + nativeSpend) {
        throw new SendError("Not enough available XLM for the swap, network fees and the new trustline reserve.");
      }
      builder.addOperation(Operation.changeTrust({ asset: destination }));
    }
  }
  params.authorizeBeforeSigning?.();
  return { builder, kp, publicKey };
}

interface HorizonPathRecord {
  destination_amount: string;
  path: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>;
}

interface HorizonPathCollection {
  _embedded?: { records?: HorizonPathRecord[] };
}

interface HorizonStrictReceivePathRecord {
  source_amount: string;
  path: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>;
}

interface HorizonStrictReceivePathCollection {
  _embedded?: { records?: HorizonStrictReceivePathRecord[] };
}

function assetQueryPrefix(prefix: string, code: string, issuer?: string | null): URLSearchParams {
  const asset = toStellarAsset(code, issuer);
  const q = new URLSearchParams();
  if (asset.isNative()) {
    q.set(`${prefix}_asset_type`, "native");
  } else {
    const assetIssuer = asset.getIssuer();
    if (!assetIssuer) throw new SendError(`Issuer is required for ${asset.getCode()}.`);
    q.set(
      `${prefix}_asset_type`,
      asset.getCode().length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
    );
    q.set(`${prefix}_asset_code`, asset.getCode());
    q.set(`${prefix}_asset_issuer`, assetIssuer);
  }
  return q;
}

function assetIdentifier(code: string, issuer?: string | null): string {
  const asset = toStellarAsset(code, issuer);
  if (asset.isNative()) return "native";
  const assetIssuer = asset.getIssuer();
  if (!assetIssuer) throw new SendError(`Issuer is required for ${asset.getCode()}.`);
  return `${asset.getCode()}:${assetIssuer}`;
}

export async function findStrictSendRoute(params: {
  network: NetworkKey;
  sendCode: string;
  sendIssuer?: string | null;
  sendAmount: string;
  destCode: string;
  destIssuer?: string | null;
}): Promise<SwapRoute | null> {
  const { network, sendCode, sendIssuer, sendAmount, destCode, destIssuer } = params;
  if (amountToStroops(sendAmount) <= BigInt(0)) return null;
  if (sendCode === destCode && sendIssuer === destIssuer) return null;
  const horizonUrl = getHorizonUrl(network);
  const q = assetQueryPrefix("source", sendCode, sendIssuer);
  q.set("source_amount", normalizeAmount(sendAmount));
  q.set("destination_assets", assetIdentifier(destCode, destIssuer));

  const data = await getHorizonJson<HorizonPathCollection>(
    `${horizonUrl}/paths/strict-send?${q.toString()}`,
  );
  const routes = data?._embedded?.records ?? [];
  if (routes.length === 0) return null;
  const best = routes.reduce((a, b) =>
    amountToStroops(b.destination_amount) > amountToStroops(a.destination_amount) ? b : a,
  );
  const intermediates = (best.path ?? []).map((p) =>
    p.asset_type === "native"
      ? Asset.native()
      : new Asset(p.asset_code!, p.asset_issuer!),
  );
  return { destinationAmount: best.destination_amount, intermediates };
}

export async function findStrictReceiveRoute(params: {
  network: NetworkKey;
  sendCode: string;
  sendIssuer?: string | null;
  destinationAmount: string;
  destCode: string;
  destIssuer?: string | null;
}): Promise<StrictReceiveSwapRoute | null> {
  const { network, sendCode, sendIssuer, destinationAmount, destCode, destIssuer } = params;
  if (amountToStroops(destinationAmount) <= BigInt(0)) return null;
  if (sendCode === destCode && sendIssuer === destIssuer) return null;
  const horizonUrl = getHorizonUrl(network);
  const q = assetQueryPrefix("destination", destCode, destIssuer);
  q.set("destination_amount", normalizeAmount(destinationAmount));
  q.set("source_assets", assetIdentifier(sendCode, sendIssuer));

  const data = await getHorizonJson<HorizonStrictReceivePathCollection>(
    `${horizonUrl}/paths/strict-receive?${q.toString()}`,
  );
  const routes = data?._embedded?.records ?? [];
  if (routes.length === 0) return null;
  const best = routes.reduce((a, b) =>
    amountToStroops(b.source_amount) < amountToStroops(a.source_amount) ? b : a,
  );
  const intermediates = (best.path ?? []).map((p) =>
    p.asset_type === "native"
      ? Asset.native()
      : new Asset(p.asset_code!, p.asset_issuer!),
  );
  return { sourceAmount: best.source_amount, intermediates };
}

export async function swapStrictSend(params: {
  network: NetworkKey;
  secretKey?: string;
  softwareSigner?: Keypair;
  hardwareSigner?: HardwareSigner;
  sendCode: string;
  sendIssuer?: string | null;
  sendAmount: string;
  destCode: string;
  destIssuer?: string | null;
  destMin: string;
  intermediates: Asset[];
  feeStroops?: number;
  onPrepared?: SubmissionPreparedCallback;
  destinationTrustline?: SwapTrustlineAuthorization;
  authorizeBeforeSigning?: () => void;
}): Promise<SwapSubmissionResult> {
  const { network } = params;
  const { builder, kp, publicKey } = await prepareSwapBuilder(params, params.sendAmount);
  const tx = builder
    .addOperation(
      Operation.pathPaymentStrictSend({
        sendAsset: toStellarAsset(params.sendCode, params.sendIssuer),
        sendAmount: normalizeAmount(params.sendAmount),
        destination: publicKey,
        destAsset: toStellarAsset(params.destCode, params.destIssuer),
        destMin: normalizeAmount(params.destMin),
        path: params.intermediates,
      }),
    )
    .setTimeout(180)
    .build();

  try {
    const result = await signAndSubmit(tx, network, kp, params.hardwareSigner, params.onPrepared, params.authorizeBeforeSigning);
    return { ...result, feeXlm: stroopsToAmount(BigInt(tx.fee)) };
  } catch (err) {
    throw new SendError(explainSubmitError(err));
  }
}

export async function swapStrictReceive(params: {
  network: NetworkKey;
  secretKey?: string;
  softwareSigner?: Keypair;
  hardwareSigner?: HardwareSigner;
  sendCode: string;
  sendIssuer?: string | null;
  sendMax: string;
  destCode: string;
  destIssuer?: string | null;
  destinationAmount: string;
  intermediates: Asset[];
  feeStroops?: number;
  onPrepared?: SubmissionPreparedCallback;
  destinationTrustline?: SwapTrustlineAuthorization;
  authorizeBeforeSigning?: () => void;
}): Promise<SwapSubmissionResult> {
  const { network } = params;
  const { builder, kp, publicKey } = await prepareSwapBuilder(params, params.sendMax);
  const tx = builder
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: toStellarAsset(params.sendCode, params.sendIssuer),
        sendMax: normalizeAmount(params.sendMax),
        destination: publicKey,
        destAsset: toStellarAsset(params.destCode, params.destIssuer),
        destAmount: normalizeAmount(params.destinationAmount),
        path: params.intermediates,
      }),
    )
    .setTimeout(180)
    .build();

  try {
    const result = await signAndSubmit(tx, network, kp, params.hardwareSigner, params.onPrepared, params.authorizeBeforeSigning);
    return { ...result, feeXlm: stroopsToAmount(BigInt(tx.fee)) };
  } catch (err) {
    throw new SendError(explainSubmitError(err));
  }
}
