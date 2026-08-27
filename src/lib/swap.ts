"use client";

import {
  Account,
  Asset,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { NETWORKS, type NetworkKey } from "./stellar";
import { getHorizonUrl } from "./stellar-endpoints";
import { normalizeAmount } from "./format";
import {
  getJson,
  loadRecommendedBaseFee,
  SendError,
  explainSubmitError,
  resolveSource,
  signAndSubmit,
} from "./api";
import type { HardwareSigner } from "./hardware";
import { getHorizonJson } from "./horizon";
import { amountToStroops, toStellarAsset } from "./stellar-domain";
import type { SubmissionPreparedCallback, SubmissionResult } from "./submission";

export interface SwapRoute {
  destinationAmount: string;
  intermediates: Asset[];
}

interface HorizonPathRecord {
  destination_amount: string;
  path: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>;
}

interface HorizonPathCollection {
  _embedded?: { records?: HorizonPathRecord[] };
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

export async function swapStrictSend(params: {
  network: NetworkKey;
  secretKey?: string;
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
}): Promise<SubmissionResult> {
  const { network } = params;
  const cfg = NETWORKS[network];
  const horizonUrl = getHorizonUrl(network);
  const { kp, publicKey } = resolveSource(params.secretKey, params.hardwareSigner);
  const source = await getJson<{ sequence: string }>(
    `${horizonUrl}/accounts/${publicKey}`,
  );
  if (!source) throw new SendError("Your account does not exist on this network.");
  const fee = await loadRecommendedBaseFee(network, params.feeStroops);

  const tx = new TransactionBuilder(new Account(publicKey, source.sequence), {
    fee: String(fee),
    networkPassphrase: cfg.networkPassphrase,
  })
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
    return await signAndSubmit(tx, network, kp, params.hardwareSigner, params.onPrepared);
  } catch (err) {
    throw new SendError(explainSubmitError(err));
  }
}
