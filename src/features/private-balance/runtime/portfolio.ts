import type { PrivateBalanceAsset } from '@/lib/private-balance-assets';
import type { ActivityItem } from '@/lib/types';
import type {
  PrivatePendingAction,
  ShieldedActivityRecord,
  ShieldedCheckpoint,
  ShieldedNoteRecord,
} from './types';

export interface PrivatePortfolioDurableSnapshot {
  notes: Array<
    Pick<ShieldedNoteRecord, 'value' | 'status' | 'assetContractId'> &
    Partial<Pick<ShieldedNoteRecord, 'actionIndex' | 'memoHex'>>
  >;
  activities: ShieldedActivityRecord[];
  pendingActions: PrivatePendingAction[];
  checkpoint: Pick<ShieldedCheckpoint, 'lastActionIndex' | 'latestLedger'> | null;
}

export interface PrivatePortfolioCandidate {
  deploymentId: string;
  asset: PrivateBalanceAsset;
  durable: PrivatePortfolioDurableSnapshot | null;
}

export interface PrivatePortfolioEntry {
  deploymentId: string;
  asset: PrivateBalanceAsset;
  verifiedBalanceAtomicUnits: string;
  lastVerifiedLedger: number | null;
  lastVerifiedActionIndex: number | null;
  activities: ShieldedActivityRecord[];
  pendingActions: PrivatePendingAction[];
}

/**
 * Keep the dashboard cache current for both bootstrap-loaded assets and an
 * asset configured during this session. First-time setup must insert a row;
 * mapping the bootstrap entries alone leaves the asset looking unconfigured
 * until the next page load.
 */
export function upsertPrivatePortfolioEntry(
  entries: readonly PrivatePortfolioEntry[],
  entry: PrivatePortfolioEntry,
): PrivatePortfolioEntry[] {
  const index = entries.findIndex(candidate => candidate.deploymentId === entry.deploymentId);
  if (index === -1) return [...entries, entry];
  return entries.map((candidate, candidateIndex) => candidateIndex === index ? entry : candidate);
}

/**
 * Preserve the last ledger-backed balance while an asset-scoped runtime is
 * restoring its encrypted state. Runtime mounts begin with an honest zero,
 * but that zero is not authoritative until the runtime reaches `current`.
 */
export function reconcilePrivatePortfolioRuntimeEntry(
  existing: PrivatePortfolioEntry | undefined,
  candidate: PrivatePortfolioEntry,
  runtimeCurrent: boolean,
): PrivatePortfolioEntry {
  return existing && !runtimeCurrent ? existing : candidate;
}

export interface PrivatePortfolioPoolAsset {
  deploymentId: string;
  asset: PrivateBalanceAsset;
}

/**
 * Private Payments setup belongs to the shared pool, while balances belong to
 * individual assets. Configure or remove every pool row together, preserving
 * an already-loaded sibling balance and using an honest zero until that asset
 * runtime publishes its own verified snapshot.
 */
export function updatePrivatePortfolioPoolEntries(
  entries: readonly PrivatePortfolioEntry[],
  poolAssets: readonly PrivatePortfolioPoolAsset[],
  selectedEntry: PrivatePortfolioEntry | null,
): PrivatePortfolioEntry[] {
  const poolDeploymentIds = new Set(poolAssets.map(candidate => candidate.deploymentId));
  if (poolDeploymentIds.size === 0) return [...entries];
  const existingByDeployment = new Map(
    entries
      .filter(candidate => poolDeploymentIds.has(candidate.deploymentId))
      .map(candidate => [candidate.deploymentId, candidate]),
  );
  const outsidePool = entries.filter(candidate => !poolDeploymentIds.has(candidate.deploymentId));
  if (!selectedEntry) return outsidePool;

  return [
    ...outsidePool,
    ...poolAssets.map(candidate => {
      if (candidate.deploymentId === selectedEntry.deploymentId) return selectedEntry;
      return existingByDeployment.get(candidate.deploymentId) ?? {
        deploymentId: candidate.deploymentId,
        asset: candidate.asset,
        verifiedBalanceAtomicUnits: '0',
        lastVerifiedLedger: selectedEntry.lastVerifiedLedger,
        lastVerifiedActionIndex: selectedEntry.lastVerifiedActionIndex,
        activities: [],
        pendingActions: [],
      };
    }),
  ];
}

function cachedBalance(
  notes: PrivatePortfolioDurableSnapshot['notes'],
  assetContractId: string,
): string {
  return notes
    .filter(note => note.status === 'unspent' && note.assetContractId === assetContractId)
    .reduce((total, note) => total + BigInt(note.value), 0n)
    .toString();
}

function activitiesWithRecoveredMemos(
  activities: readonly ShieldedActivityRecord[],
  notes: PrivatePortfolioDurableSnapshot['notes'],
): ShieldedActivityRecord[] {
  const memoByActionIndex = new Map(
    notes.flatMap(note => note.memoHex && note.actionIndex !== undefined
      ? [[note.actionIndex, note.memoHex] as const]
      : []),
  );
  return activities.map(activity => {
    if (
      activity.memoHex ||
      activity.actionKind !== 'transfer' ||
      activity.direction !== 'inflow'
    ) {
      return activity;
    }
    const memoHex = memoByActionIndex.get(activity.actionIndex);
    return memoHex ? { ...activity, memoHex } : activity;
  });
}

export function buildPrivatePortfolioEntries(
  candidates: readonly PrivatePortfolioCandidate[],
): PrivatePortfolioEntry[] {
  return candidates.flatMap(candidate => candidate.durable
    ? [{
        deploymentId: candidate.deploymentId,
        asset: candidate.asset,
        verifiedBalanceAtomicUnits: cachedBalance(candidate.durable.notes, candidate.asset.contractId),
        lastVerifiedLedger: candidate.durable.checkpoint?.latestLedger ?? null,
        lastVerifiedActionIndex: candidate.durable.checkpoint?.lastActionIndex ?? null,
        activities: activitiesWithRecoveredMemos(
          candidate.durable.activities.filter(
            activity => activity.assetContractId === candidate.asset.contractId,
          ),
          candidate.durable.notes.filter(
            note => note.assetContractId === candidate.asset.contractId,
          ),
        ),
        pendingActions: candidate.durable.pendingActions.filter(
          action => action.assetContractId === candidate.asset.contractId,
        ),
      }]
    : []);
}

function atomicUnitsToNumber(value: string, decimals: number): number | null {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) {
    return null;
  }
  const padded = value.padStart(decimals + 1, '0');
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fraction = decimals === 0 ? '' : padded.slice(-decimals);
  const amount = Number(fraction ? `${whole}.${fraction}` : whole);
  return Number.isFinite(amount) ? amount : null;
}

function atomicUnitsToDecimal(value: string, decimals: number): string {
  const padded = value.padStart(decimals + 1, '0');
  if (decimals === 0) return padded;
  return `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}

function decimalToAtomicUnits(value: string | number, decimals: number): bigint | null {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  const raw = typeof value === 'number' ? value.toFixed(decimals) : value.trim();
  const match = /^(\d+)(?:\.(\d*))?$/.exec(raw);
  if (!match || (match[2]?.length ?? 0) > decimals) return null;
  return BigInt(match[1]) * (10n ** BigInt(decimals))
    + BigInt((match[2] ?? '').padEnd(decimals, '0'));
}

/**
 * Adds the active account's configured private XLM to a public XLM balance.
 * Issued private assets are deliberately excluded because token quantities
 * cannot be added across assets; their value belongs in the fiat total.
 */
export function portfolioXlmWithPrivateAssets(
  publicXlm: string | number | null,
  entries: readonly PrivatePortfolioEntry[],
): string | null {
  const decimals = 7;
  const publicAtomicUnits = publicXlm === null
    ? null
    : decimalToAtomicUnits(publicXlm, decimals);
  if (publicAtomicUnits === null) return null;

  let total = publicAtomicUnits;
  for (const entry of entries) {
    if (entry.asset.kind !== 'native') continue;
    if (entry.asset.decimals !== decimals || !/^\d+$/.test(entry.verifiedBalanceAtomicUnits)) {
      return null;
    }
    total += BigInt(entry.verifiedBalanceAtomicUnits);
  }
  return atomicUnitsToDecimal(total.toString(), decimals);
}

/**
 * Representative USD value for configured private assets.
 *
 * Private deployments are pinned by the signed local catalogue, so XLM may
 * use the live market rate and its pinned testnet USDC deployment may use the
 * production dollar peg. Unknown assets deliberately make the total
 * unavailable instead of borrowing a price from an untrusted asset code.
 */
export function privatePortfolioRepresentativeUsd(
  entries: readonly PrivatePortfolioEntry[],
  xlmPriceUsd: number | null,
): number | null {
  let total = 0;
  for (const entry of entries) {
    const amount = atomicUnitsToNumber(
      entry.verifiedBalanceAtomicUnits,
      entry.asset.decimals,
    );
    if (amount === null) return null;
    if (amount === 0) continue;

    const unitPrice = entry.asset.kind === 'native'
      ? xlmPriceUsd
      : entry.asset.code === 'USDC'
        ? 1
        : null;
    if (unitPrice === null || !Number.isFinite(unitPrice) || unitPrice <= 0) return null;
    total += amount * unitPrice;
  }
  return Number.isFinite(total) ? total : null;
}

/**
 * Combines the independently verified public and private valuations.
 * A partial number would look exact while silently omitting assets, so either
 * unavailable side keeps the account total unavailable.
 */
export function portfolioUsdWithPrivateAssets(
  publicUsd: number | null,
  privateUsd: number | null,
): number | null {
  if (publicUsd === null || privateUsd === null) return null;
  const total = publicUsd + privateUsd;
  return Number.isFinite(total) ? total : null;
}

const PRIVATE_ACTIVITY_TITLES = {
  deposit: 'Added to private balance',
  withdraw: 'Withdrew to public balance',
} as const;

const TRANSACTION_HASH = /^[0-9a-f]{64}$/i;

function privateInternalTransfer(
  actionKind: 'deposit' | 'transfer' | 'withdraw',
  amount: string,
  asset: PrivateBalanceAsset,
): ActivityItem['internalTransfer'] {
  if (actionKind === 'transfer') return undefined;
  const publicLeg = {
    amount,
    assetCode: asset.code,
    assetIssuer: asset.issuer,
    balance: 'public' as const,
  };
  const privateLeg = {
    amount,
    assetCode: asset.code,
    assetIssuer: asset.issuer,
    balance: 'private' as const,
  };
  return actionKind === 'deposit'
    ? { debit: publicLeg, credit: privateLeg }
    : { debit: privateLeg, credit: publicLeg };
}

/**
 * Prefer StellarKey's exactly identified private action over Horizon's generic
 * operation row only when both name the exact same submitted transaction.
 * Synthetic restored-history IDs never suppress public ledger activity.
 */
export function mergePortfolioActivity(
  publicItems: readonly ActivityItem[],
  privateItems: readonly ActivityItem[],
): ActivityItem[] {
  const privateTransactionHashes = new Set(
    privateItems
      .filter(item => item.private && TRANSACTION_HASH.test(item.hash))
      .map(item => item.hash.toLowerCase()),
  );
  return [
    ...publicItems.filter(item => !(
      item.type === 'invoke_host_function' &&
      privateTransactionHashes.has(item.hash.toLowerCase())
    )),
    ...privateItems,
  ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function privatePortfolioActivityItems(
  entries: readonly PrivatePortfolioEntry[],
): ActivityItem[] {
  return entries
    .flatMap(entry => [
      ...entry.activities.map(activity => {
        const amount = atomicUnitsToDecimal(activity.amount, entry.asset.decimals);
        return {
        id: `private:${entry.deploymentId}:${activity.id}`,
        type: `private_${activity.actionKind}`,
        title: activity.actionKind === 'transfer'
          ? activity.direction === 'inflow'
            ? 'Private payment received'
            : activity.direction === 'internal'
              ? 'Private balance prepared'
              : 'Private payment sent'
          : PRIVATE_ACTIVITY_TITLES[activity.actionKind],
        direction: activity.actionKind !== 'transfer'
          ? 'neutral' as const
          : activity.direction === 'inflow'
            ? 'in' as const
            : activity.direction === 'outflow'
              ? 'out' as const
              : 'neutral' as const,
        amount,
        assetCode: entry.asset.code,
        assetIssuer: entry.asset.issuer,
        counterparty: null,
        hash: activity.transactionHash ?? `private:${entry.deploymentId}:${activity.id}`,
        createdAt: new Date(activity.timestamp).toISOString(),
        successful: true,
        private: {
          deploymentId: entry.deploymentId,
          actionIndex: activity.actionIndex,
          actionKind: activity.actionKind,
          memoHex: activity.memoHex,
          recipientFingerprint: activity.recipientFingerprint,
        },
        internalTransfer: privateInternalTransfer(activity.actionKind, amount, entry.asset),
      };
      }),
      ...entry.pendingActions
        .filter(action =>
          (action.status === 'signed' || action.broadcastAttempts > 0) &&
          !(action.kind === 'transfer' && !action.recipientFingerprint)
        )
        .map(action => {
          const amount = action.amountStroops
            ? atomicUnitsToDecimal(action.amountStroops, entry.asset.decimals)
            : null;
          return {
          id: `private-pending:${entry.deploymentId}:${action.id}`,
          type: `private_${action.kind}`,
          title: action.kind === 'transfer'
            ? 'Private payment sent'
            : PRIVATE_ACTIVITY_TITLES[action.kind],
          direction: action.kind === 'transfer' ? 'out' as const : 'neutral' as const,
          amount,
          assetCode: entry.asset.code,
          assetIssuer: entry.asset.issuer,
          counterparty: null,
          hash: action.transactionHash ?? `private-pending:${action.id}`,
          createdAt: new Date(action.createdAt).toISOString(),
          successful: true,
          pending: true,
          private: {
            deploymentId: entry.deploymentId,
            actionKind: action.kind,
            memoHex: action.memoHex,
            recipientFingerprint: action.recipientFingerprint,
          },
          internalTransfer: amount
            ? privateInternalTransfer(action.kind, amount, entry.asset)
            : undefined,
        };
        }),
    ])
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}
