import type { ShieldedActivityRecord } from './types';

export type PrivatePrivacyAdvisory = 'precise-deposit' | 'matching-deposit' | 'recent-deposit';
type Activity = Pick<ShieldedActivityRecord, 'actionKind' | 'direction' | 'amount' | 'assetContractId' | 'timestamp'>;

/** Local heuristics only. No network reads, retained history, scores or amount changes. */
export function privatePrivacyAdvisories(input: {
  kind: 'deposit' | 'transfer' | 'withdraw';
  amount: bigint | null;
  decimals: number;
  assetContractId: string | null;
  activities: readonly Activity[];
  now: number;
}): PrivatePrivacyAdvisory[] {
  const { amount, assetContractId, kind } = input;
  if (amount === null || amount <= 0n || !assetContractId || kind === 'transfer') return [];
  if (kind === 'deposit') {
    if (!Number.isInteger(input.decimals) || input.decimals <= 2 || input.decimals > 18) return [];
    return amount % (10n ** BigInt(input.decimals - 2)) !== 0n ? ['precise-deposit'] : [];
  }
  let matching = false;
  let recent = false;
  for (const activity of input.activities) {
    if (activity.actionKind !== 'deposit' || activity.direction !== 'inflow' || activity.assetContractId !== assetContractId) continue;
    if (!/^[0-9]{1,20}$/.test(activity.amount) || BigInt(activity.amount) <= 0n) continue;
    matching ||= BigInt(activity.amount) === amount;
    // A missing archival timestamp is unknown, not a deposit made "now".
    recent ||= Number.isSafeInteger(input.now) && Number.isSafeInteger(activity.timestamp)
      && activity.timestamp > 0 && activity.timestamp <= input.now
      && input.now - activity.timestamp < 24 * 60 * 60 * 1000;
  }
  return [...(matching ? ['matching-deposit' as const] : []), ...(recent ? ['recent-deposit' as const] : [])];
}
