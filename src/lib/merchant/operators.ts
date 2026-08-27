import type { MerchantSettings, MerchantStore } from "./types";

/**
 * Select a PIN-verified operator and keep a unique roster of everyone working
 * on this local till. PIN verification stays in the hook at the crypto boundary.
 */
export function activateOperator(store: MerchantStore, memberId: string): MerchantStore {
  const member = store.staff.find((entry) => entry.id === memberId && entry.active);
  if (!member) throw new Error("That staff member is not active on this till.");
  return {
    ...store,
    activeStaffId: member.id,
    onShiftStaffIds: store.onShiftStaffIds.includes(member.id)
      ? [...store.onShiftStaffIds]
      : [...store.onShiftStaffIds, member.id],
  };
}

/**
 * Finish an asynchronous PIN switch against the newest store snapshot. Besides
 * preserving intervening commits, the digest check prevents a PIN that was
 * reset during verification from authorising the old credential.
 */
export function activateVerifiedOperator(
  store: MerchantStore,
  memberId: string,
  expectedPinDigest: string,
): MerchantStore {
  const member = store.staff.find((entry) => entry.id === memberId && entry.active);
  if (!member) throw new Error("That staff member is no longer active on this till.");
  if (member.pinDigest !== expectedPinDigest) {
    throw new Error("This operator's PIN changed while it was being checked. Try again.");
  }
  return activateOperator(store, member.id);
}

/** Clear authority without clocking anybody out. */
export function lockOperator(store: MerchantStore): MerchantStore {
  return store.activeStaffId === null ? store : { ...store, activeStaffId: null };
}

/** Remove one staff member from this device's roster and lock if they were selected. */
export function endOperatorShift(store: MerchantStore, memberId: string): MerchantStore {
  const onShiftStaffIds = store.onShiftStaffIds.filter((id) => id !== memberId);
  if (
    onShiftStaffIds.length === store.onShiftStaffIds.length &&
    store.activeStaffId !== memberId
  ) {
    return store;
  }
  return {
    ...store,
    activeStaffId: store.activeStaffId === memberId ? null : store.activeStaffId,
    onShiftStaffIds,
  };
}

export function shouldLockOperatorAfterSale(settings: MerchantSettings): boolean {
  return settings.operatorLockMode === "after_sale";
}

export function operatorTimeoutMs(settings: MerchantSettings): number | null {
  return settings.operatorLockMode === "after_timeout"
    ? settings.operatorLockTimeoutMinutes * 60 * 1000
    : null;
}

/** Apply the post-sale lock to the same store snapshot that records the sale. */
export function applyOperatorSalePolicy(store: MerchantStore): MerchantStore {
  return shouldLockOperatorAfterSale(store.settings) ? lockOperator(store) : store;
}

/**
 * Lock after a watched crypto payment only when it completed the current
 * operator's own sale. A late payment from another operator must never knock
 * the person now using the till out of their session.
 */
export function applyCompletedSalePolicy(
  before: MerchantStore,
  after: MerchantStore,
  sessionStaffId: string | null,
): MerchantStore {
  if (
    !shouldLockOperatorAfterSale(after.settings) ||
    sessionStaffId === null ||
    before.activeStaffId !== sessionStaffId ||
    after.activeStaffId !== sessionStaffId
  ) {
    return after;
  }

  const priorStatusById = new Map(before.orders.map((order) => [order.id, order.status]));
  const completedOwnSale = after.orders.some(
    (order) =>
      order.staffId === sessionStaffId &&
      order.status === "paid" &&
      priorStatusById.get(order.id) !== "paid",
  );
  return completedOwnSale ? lockOperator(after) : after;
}
