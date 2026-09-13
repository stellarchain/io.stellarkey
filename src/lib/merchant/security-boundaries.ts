import type { NetworkKey } from "../stellar";
import { requireActiveOwner } from "./permissions";
import { activeShiftForTerminal } from "./shifts";
import type { MerchantStore, StaffMember } from "./types";
export { merchantExitRequired } from "./navigation";

export interface MerchantPaymentAuthority {
  actorId: string | null;
  network: NetworkKey;
}

/** Re-resolve the active till operator and shift from the store being mutated. */
export function requireMerchantPaymentActor(
  store: MerchantStore,
  authority: MerchantPaymentAuthority,
): StaffMember {
  const actor = store.staff.find(
    (member) =>
      member.id === authority.actorId &&
      member.id === store.activeStaffId &&
      member.active,
  );
  if (!actor) throw new Error("Choose an active staff member before taking a payment.");
  if (!actor.permissions.takePayment) {
    throw new Error(`${actor.name} is not allowed to take payments.`);
  }
  const shift = activeShiftForTerminal(store);
  if (!shift) {
    throw new Error(`Open a shift on ${store.settings.terminalName} before taking a payment.`);
  }
  if (shift.network !== authority.network) {
    throw new Error(
      `Shift ${shift.number} is open on ${shift.network}; switch network or close it first.`,
    );
  }
  return actor;
}

/** Void only an awaiting charge under freshly resolved payment and void authority. */
export function voidAwaitingMerchantCharge(
  store: MerchantStore,
  input: MerchantPaymentAuthority & { chargeId: string },
): MerchantStore {
  const actor = requireMerchantPaymentActor(store, input);
  if (!actor.permissions.void) {
    throw new Error(`${actor.name} is not allowed to void charges.`);
  }
  const currentCharge = store.charges.find((charge) => charge.id === input.chargeId);
  if (!currentCharge) throw new Error("This charge no longer exists.");
  if (currentCharge.status !== "awaiting") {
    throw new Error("Only an awaiting charge can be voided.");
  }
  return {
    ...store,
    charges: store.charges.map((charge) =>
      charge.id === input.chargeId ? { ...charge, status: "voided" as const } : charge,
    ),
    orders: store.orders.map((order) =>
      order.id === currentCharge.orderId && order.status === "awaiting"
        ? { ...order, status: "voided" as const }
        : order,
    ),
  };
}

export interface MerchantWalletExitBoundary {
  getStore: () => MerchantStore;
  getActorId: () => string | null;
  authorizeWalletOwner: () => Promise<void>;
}

/** Bind wallet reauthentication to the same active merchant owner on both sides. */
export async function authorizeMerchantWalletExit(
  boundary: MerchantWalletExitBoundary,
): Promise<void> {
  const actorId = boundary.getActorId() ?? "";
  requireActiveOwner(boundary.getStore(), actorId);
  await boundary.authorizeWalletOwner();
  requireActiveOwner(boundary.getStore(), actorId);
}

export function merchantPageAccess({
  activeStaff,
  vaultPhase,
}: {
  activeStaff: StaffMember | null;
  vaultPhase: string;
}): {
  hasActiveOperator: boolean;
  canSeeReports: boolean;
  canAccessRecords: boolean;
} {
  const hasActiveOperator = activeStaff?.active === true && vaultPhase !== "locked";
  const canSeeReports = hasActiveOperator && activeStaff.permissions.seeReports;
  return {
    hasActiveOperator,
    canSeeReports,
    canAccessRecords: canSeeReports,
  };
}
