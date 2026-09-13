import type { StorageIssue } from "../storage-load";
import { requireActiveOwner } from "./permissions";
import type { MerchantStore } from "./types";

export interface MerchantRecoveryResetBoundary {
  getStorageIssue: () => StorageIssue | null;
  getStore: () => MerchantStore;
  getActorId: () => string | null;
  authorizeWalletOwner: () => Promise<void>;
  clearRepository: () => Promise<void>;
}

/**
 * Reset authority is deliberately asymmetric. An unreadable merchant archive
 * cannot prove its staff roster, so the wallet password is the break-glass
 * authority. A healthy archive still requires both its active owner and wallet
 * reauthentication.
 */
export async function resetMerchantRecoveryStore(
  boundary: MerchantRecoveryResetBoundary,
): Promise<void> {
  if (!boundary.getStorageIssue()) {
    requireActiveOwner(boundary.getStore(), boundary.getActorId() ?? "");
  }
  await boundary.authorizeWalletOwner();
  if (!boundary.getStorageIssue()) {
    requireActiveOwner(boundary.getStore(), boundary.getActorId() ?? "");
  }
  await boundary.clearRepository();
}
