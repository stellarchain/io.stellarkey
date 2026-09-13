/** Parse Horizon's immutable ledger close timestamp without falling back to device time. */
export function parsePaymentCreatedAt(createdAt: string): number | null {
  if (typeof createdAt !== "string" || createdAt.trim() === "") return null;
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
