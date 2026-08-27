import { assetPriceKey, type AssetPrices } from "./prices";
import type { NetworkKey } from "./stellar";
import type { AssetBalance } from "./types";

const STROOPS_PER_UNIT = BigInt(10_000_000);

export type AccountPortfolioSnapshotStatus = "loading" | "ready" | "unavailable";

/** One network-bound account read, including enough state to reject stale totals. */
export interface AccountPortfolioSnapshot {
  publicKey: string;
  network: NetworkKey;
  status: AccountPortfolioSnapshotStatus;
  balances: AssetBalance[] | null;
  updatedAt: number | null;
  error: string | null;
}

export interface AggregatedPortfolioAsset {
  key: string;
  code: string;
  issuer: string | null;
  isNative: boolean;
  balance: string;
  accountCount: number;
}

export interface PortfolioAggregate {
  completeness: "complete" | "loading" | "partial";
  assets: AggregatedPortfolioAsset[];
  /** Null until every selected-network account has a current successful snapshot. */
  nativeBalance: string | null;
  /** Null for testnet, missing accounts, missing market rates, or any unpriced positive asset. */
  totalUsd: number | null;
  loadingAccounts: string[];
  unavailableAccounts: string[];
  unpricedAssets: AggregatedPortfolioAsset[];
  updatedAt: number | null;
}

export function portfolioSnapshotKey(network: NetworkKey, publicKey: string): string {
  return `${network}:${publicKey}`;
}

function identityKey(balance: Pick<AssetBalance, "code" | "issuer" | "isNative">): string {
  return balance.isNative ? "native" : `${balance.code}:${balance.issuer ?? ""}`;
}

function toStroops(value: string): bigint | null {
  const raw = value.trim();
  if (!/^\d+(?:\.\d{1,7})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(fraction.padEnd(7, "0"));
}

function fromStroops(value: bigint): string {
  const whole = value / STROOPS_PER_UNIT;
  const fraction = (value % STROOPS_PER_UNIT).toString().padStart(7, "0");
  return `${whole}.${fraction}`;
}

interface AggregatePortfolioInput {
  accounts: string[];
  snapshots: Record<string, AccountPortfolioSnapshot>;
  network: NetworkKey;
  xlmPriceUsd: number | null;
  assetPrices: AssetPrices;
}

/**
 * Combines only current, successful snapshots. It can expose the known asset
 * composition for diagnosis, but never emits an exact native or fiat total when
 * an account read or a positive asset price is missing.
 */
export function aggregatePortfolio({
  accounts,
  snapshots,
  network,
  xlmPriceUsd,
  assetPrices,
}: AggregatePortfolioInput): PortfolioAggregate {
  const loadingAccounts: string[] = [];
  const unavailableAccounts: string[] = [];
  const totals = new Map<
    string,
    {
      code: string;
      issuer: string | null;
      isNative: boolean;
      stroops: bigint;
      accounts: Set<string>;
    }
  >();
  const timestamps: number[] = [];

  for (const publicKey of accounts) {
    const snapshot = snapshots[portfolioSnapshotKey(network, publicKey)];
    if (!snapshot || snapshot.network !== network || snapshot.publicKey !== publicKey) {
      loadingAccounts.push(publicKey);
      continue;
    }
    if (snapshot.status === "loading") {
      loadingAccounts.push(publicKey);
      continue;
    }
    if (snapshot.status !== "ready" || snapshot.balances === null) {
      unavailableAccounts.push(publicKey);
      continue;
    }

    const parsed = snapshot.balances.map((balance) => ({
      balance,
      stroops: toStroops(balance.balance),
    }));
    if (parsed.some((entry) => entry.stroops === null)) {
      unavailableAccounts.push(publicKey);
      continue;
    }
    if (snapshot.updatedAt !== null) timestamps.push(snapshot.updatedAt);

    for (const { balance, stroops } of parsed) {
      const key = identityKey(balance);
      const current = totals.get(key);
      if (current) {
        current.stroops += stroops as bigint;
        current.accounts.add(publicKey);
      } else {
        totals.set(key, {
          code: balance.code,
          issuer: balance.issuer,
          isNative: balance.isNative,
          stroops: stroops as bigint,
          accounts: new Set([publicKey]),
        });
      }
    }
  }

  const assets = [...totals.entries()]
    .map(([key, asset]) => ({
      key,
      code: asset.code,
      issuer: asset.issuer,
      isNative: asset.isNative,
      balance: fromStroops(asset.stroops),
      accountCount: asset.accounts.size,
    }))
    .sort((a, b) => {
      if (a.isNative !== b.isNative) return a.isNative ? -1 : 1;
      return a.key.localeCompare(b.key);
    });

  const completeness = unavailableAccounts.length > 0
    ? "partial"
    : loadingAccounts.length > 0
      ? "loading"
      : "complete";
  const native = assets.find((asset) => asset.isNative);
  const nativeBalance = completeness === "complete" ? (native?.balance ?? "0.0000000") : null;
  const unpricedAssets: AggregatedPortfolioAsset[] = [];
  let totalUsd: number | null = completeness === "complete" && network === "mainnet" ? 0 : null;

  if (totalUsd !== null) {
    for (const asset of assets) {
      const amount = Number(asset.balance);
      if (!Number.isFinite(amount)) {
        totalUsd = null;
        break;
      }
      const price = asset.isNative
        ? xlmPriceUsd
        : asset.issuer
          ? assetPrices[assetPriceKey(network, asset.code, asset.issuer)] ?? null
          : null;
      if (amount > 0 && (price === null || !Number.isFinite(price) || price <= 0)) {
        unpricedAssets.push(asset);
        totalUsd = null;
        continue;
      }
      if (totalUsd !== null && price !== null) totalUsd += amount * price;
    }
  }

  // Once one asset makes the total unavailable, still enumerate every other
  // positive unpriced asset so the UI can explain the complete reason set.
  if (completeness === "complete" && network === "mainnet") {
    for (const asset of assets) {
      if (Number(asset.balance) <= 0 || unpricedAssets.some((entry) => entry.key === asset.key)) continue;
      const price = asset.isNative
        ? xlmPriceUsd
        : asset.issuer
          ? assetPrices[assetPriceKey(network, asset.code, asset.issuer)] ?? null
          : null;
      if (price === null || !Number.isFinite(price) || price <= 0) unpricedAssets.push(asset);
    }
  }

  return {
    completeness,
    assets,
    nativeBalance,
    totalUsd: unpricedAssets.length > 0 ? null : totalUsd,
    loadingAccounts,
    unavailableAccounts,
    unpricedAssets,
    updatedAt:
      completeness === "complete" && timestamps.length === accounts.length
        ? Math.min(...timestamps)
        : null,
  };
}
