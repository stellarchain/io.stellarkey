"use client";

import {
  Account,
  Asset,
  Keypair,
  Operation,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { NETWORKS, type NetworkKey } from "./stellar";
import { normalizeAmount } from "./format";
import { getJson, SendError, explainSubmitError, submitSignedTx } from "./api";

export interface SwapRoute {
  destinationAmount: string;
  intermediates: Asset[];
}

function assetQueryPrefix(prefix: string, code: string, issuer?: string | null): URLSearchParams {
  const q = new URLSearchParams();
  if (!issuer || code === "XLM") {
    q.set(`${prefix}_asset_type`, "native");
  } else {
    q.set(`${prefix}_asset_type`, code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12");
    q.set(`${prefix}_asset_code`, code);
    q.set(`${prefix}_asset_issuer`, issuer);
  }
  return q;
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
  if (sendAmount <= "0" || parseFloat(sendAmount) <= 0) return null;
  if (sendCode === destCode && sendIssuer === destIssuer) return null;
  const cfg = NETWORKS[network];
  const q = assetQueryPrefix("source", sendCode, sendIssuer);
  q.set("source_amount", normalizeAmount(sendAmount));
  const destQ = assetQueryPrefix("destination", destCode, destIssuer);
  for (const [k, v] of destQ) q.set(k, v);

  try {
    const routes = await getJson<
      Array<{
        destination_amount: string;
        path: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>;
      }>
    >(`${cfg.horizonUrl}/paths/strict-send?${q.toString()}`);
    if (!routes || routes.length === 0) return null;
    const best = routes.reduce((a, b) =>
      parseFloat(b.destination_amount) > parseFloat(a.destination_amount) ? b : a,
    );
    const intermediates = (best.path ?? []).map((p) =>
      p.asset_type === "native"
        ? Asset.native()
        : new Asset(p.asset_code!, p.asset_issuer!),
    );
    return { destinationAmount: best.destination_amount, intermediates };
  } catch {
    return null;
  }
}

export async function swapStrictSend(params: {
  network: NetworkKey;
  secretKey: string;
  sendCode: string;
  sendIssuer?: string | null;
  sendAmount: string;
  destCode: string;
  destIssuer?: string | null;
  destMin: string;
  intermediates: Asset[];
}): Promise<{ hash: string }> {
  const { network } = params;
  const cfg = NETWORKS[network];
  const kp = Keypair.fromSecret(params.secretKey);
  const source = await getJson<{ sequence: string }>(
    `${cfg.horizonUrl}/accounts/${kp.publicKey()}`,
  );
  if (!source) throw new SendError("Your account does not exist on this network.");

  const tx = new TransactionBuilder(new Account(kp.publicKey(), source.sequence), {
    fee: BASE_FEE,
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(
      Operation.pathPaymentStrictSend({
        sendAsset:
          params.sendCode === "XLM"
            ? Asset.native()
            : new Asset(params.sendCode, params.sendIssuer!),
        sendAmount: normalizeAmount(params.sendAmount),
        destination: kp.publicKey(),
        destAsset:
          params.destCode === "XLM"
            ? Asset.native()
            : new Asset(params.destCode, params.destIssuer!),
        destMin: normalizeAmount(params.destMin),
        path: params.intermediates,
      }),
    )
    .setTimeout(180)
    .build();
  tx.sign(kp);

  try {
    return await submitSignedTx(tx, network);
  } catch (err) {
    throw new SendError(explainSubmitError(err));
  }
}
