"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useWalletIdentity,
  useWalletLedger,
  useWalletSubmission,
  useWalletTransactions,
} from "@/hooks/useWallet";
import { networkFeeXlm, type ClaimableBalanceItem } from "@/lib/api";
import { formatTrezorAddress } from "@/lib/address-display";
import { fmtAmount } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import type { AssetBalance } from "@/lib/types";
import type { SubmissionResult } from "@/lib/submission";
import { Button, ErrorText, Modal, ModalHeader } from "./ui";
import { IconAlert, IconCheck, IconEyeOff, IconGift, IconPlus } from "./icons";

function hasClaimTrustline(
  item: ClaimableBalanceItem,
  balances: AssetBalance[] | null,
): boolean {
  if (item.issuer === null) return true;
  return (balances ?? []).some(
    (balance) => balance.code === item.assetCode && balance.issuer === item.issuer,
  );
}

export function ClaimableBalancesModal({
  open,
  dismissedBalanceIds,
  initialShowDismissed = false,
  onClose,
  onDismiss,
  onRestore,
  onAddAsset,
}: {
  open: boolean;
  dismissedBalanceIds: string[];
  initialShowDismissed?: boolean;
  onClose: () => void;
  onDismiss: (balanceId: string) => void;
  onRestore: (balanceId: string) => void;
  onAddAsset: () => void;
}) {
  const { activeAccount } = useWalletIdentity();
  const { balances, claimableBalances, recommendedBaseFeeStroops } = useWalletLedger();
  const { pendingTxs, submissionStatus } = useWalletSubmission();
  const { claimAirdrops, refresh } = useWalletTransactions();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<SubmissionResult | null>(null);
  const [showDismissed, setShowDismissed] = useState(initialShowDismissed);
  const trackedStatus = pendingSubmission ? submissionStatus(pendingSubmission) : null;
  const pendingAirdropClaim = pendingTxs.some(
    (transaction) => transaction.label === "Airdrop claim",
  );

  const dismissedIdSet = useMemo(
    () => new Set(dismissedBalanceIds),
    [dismissedBalanceIds],
  );
  const visibleBalances = useMemo(
    () => claimableBalances.filter((item) => !dismissedIdSet.has(item.id)),
    [claimableBalances, dismissedIdSet],
  );
  const dismissedBalances = useMemo(
    () => claimableBalances.filter((item) => dismissedIdSet.has(item.id)),
    [claimableBalances, dismissedIdSet],
  );
  const availableIds = useMemo(
    () => visibleBalances
      .filter((item) => hasClaimTrustline(item, balances))
      .map((item) => item.id),
    [balances, visibleBalances],
  );
  const selectedIds = useMemo(
    () => visibleBalances
      .filter((item) => selected.has(item.id) && hasClaimTrustline(item, balances))
      .map((item) => item.id),
    [balances, selected, visibleBalances],
  );
  const missingTrustlines = visibleBalances.length - availableIds.length;
  const allAvailableSelected =
    availableIds.length > 0 && availableIds.every((id) => selected.has(id));
  const selectedFee = networkFeeXlm(recommendedBaseFeeStroops, selectedIds.length);

  useEffect(() => {
    if (!pendingSubmission || trackedStatus === null) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      if (trackedStatus === "failed") {
        setPendingSubmission(null);
        setError("The selected claim transaction failed on-chain. Review the entries and retry.");
        triggerHaptic("error");
        return;
      }
      if (trackedStatus !== "confirmed") return;
      await refresh();
      if (!active) return;
      setSelected(new Set());
      setPendingSubmission(null);
      triggerHaptic("success");
      onClose();
    })();
    return () => {
      active = false;
    };
  }, [onClose, pendingSubmission, refresh, trackedStatus]);

  if (!open) return null;

  function toggleSelection(id: string, checked: boolean) {
    triggerHaptic("selection");
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllAvailable() {
    triggerHaptic("selection");
    setSelected(allAvailableSelected ? new Set() : new Set(availableIds));
  }

  function handleDismiss(balanceId: string) {
    try {
      onDismiss(balanceId);
      setSelected((current) => {
        const next = new Set(current);
        next.delete(balanceId);
        return next;
      });
      setError(null);
      triggerHaptic("light");
    } catch (dismissError) {
      setError(
        dismissError instanceof Error
          ? dismissError.message
          : "This balance could not be dismissed on this device.",
      );
      triggerHaptic("error");
    }
  }

  function handleRestore(balanceId: string) {
    try {
      onRestore(balanceId);
      setError(null);
      triggerHaptic("light");
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "This balance could not be restored on this device.",
      );
      triggerHaptic("error");
    }
  }

  async function handleClaimSelected() {
    if (
      selectedIds.length === 0 ||
      busy ||
      pendingAirdropClaim ||
      pendingSubmission ||
      activeAccount?.watchOnly
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    triggerHaptic("selection");
    try {
      const result = await claimAirdrops(selectedIds);
      if (result.status === "confirmed") {
        await refresh();
        setSelected(new Set());
        triggerHaptic("success");
        onClose();
      } else {
        setPendingSubmission(result);
        triggerHaptic(result.status === "status_unknown" ? "warning" : "medium");
      }
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Claim transaction failed.");
      triggerHaptic("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} wide dismissable={!busy}>
      <ModalHeader
        title={showDismissed ? "Dismissed balances" : "Pending balances"}
        subtitle={
          showDismissed
            ? "Hidden on this browser only"
            : "Select only the assets you recognize"
        }
        onClose={onClose}
      />
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex items-start gap-2.5 rounded-2xl border border-[#FF9F0A]/25 bg-[#FF9F0A]/10 px-3.5 py-3 text-[12px] leading-relaxed text-neutral-300">
          <IconAlert size={15} className="mt-0.5 shrink-0 text-[#FF9F0A]" />
          {showDismissed ? (
            <p>
              Dismissing a balance only hides it for this account on this browser. It does not
              decline or change it on Stellar, and clearing browser data resets this list.
            </p>
          ) : (
            <p>
              Stellar has no recipient-side decline operation. Unselected balances remain unclaimed
              on the public ledger. Use the crossed-eye button to hide an unwanted balance locally.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-1">
          {showDismissed ? (
            <p className="text-[12px] text-neutral-400">
              {dismissedBalances.length} hidden on this browser
            </p>
          ) : (
            <>
              <p className="text-[12px] text-neutral-400">
                {selectedIds.length} of {availableIds.length} available selected
              </p>
              <button
                type="button"
                onClick={toggleAllAvailable}
                disabled={availableIds.length === 0 || busy || pendingAirdropClaim}
                className="min-h-11 rounded-lg px-2 text-[12px] font-semibold text-[#0A84FF] disabled:text-neutral-600 sm:min-h-0"
              >
                {allAvailableSelected ? "Clear selection" : "Select all available"}
              </button>
            </>
          )}
        </div>

        {(dismissedBalances.length > 0 || showDismissed) && (
          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection");
              setShowDismissed((current) => !current);
            }}
            className="flex min-h-11 w-full items-center justify-center rounded-xl text-[12px] font-semibold text-[#0A84FF] hover:bg-white/[0.04]"
          >
            {showDismissed
              ? `Review available (${visibleBalances.length})`
              : `Show dismissed (${dismissedBalances.length})`}
          </button>
        )}

        {showDismissed ? (
          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
            {dismissedBalances.length === 0 && (
              <p className="px-4 py-8 text-center text-[13px] text-neutral-500">
                No dismissed balances
              </p>
            )}
            {dismissedBalances.map((item, index) => (
              <div
                key={item.id}
                className={`flex min-h-[72px] items-center gap-3 px-4 py-3 ${
                  index > 0 ? "border-t border-white/[0.08]" : ""
                }`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-neutral-500">
                  <IconGift size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mono block truncate text-[14px] font-semibold text-neutral-300">
                    {fmtAmount(item.amount)} {item.assetCode}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10.5px] text-neutral-500">
                    {item.issuer
                      ? `Issuer ${formatTrezorAddress(item.issuer)}`
                      : "Native XLM"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => handleRestore(item.id)}
                  className="min-h-11 shrink-0 rounded-xl px-2.5 text-[12px] font-semibold text-[#0A84FF] hover:bg-[#0A84FF]/10"
                  aria-label={`Restore ${fmtAmount(item.amount)} ${item.assetCode}`}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
            {visibleBalances.length === 0 && (
              <p className="px-4 py-8 text-center text-[13px] text-neutral-500">
                No pending balances to review
              </p>
            )}
            {visibleBalances.map((item, index) => {
              const ready = hasClaimTrustline(item, balances);
              const checked = selected.has(item.id);
              return (
                <div
                  key={item.id}
                  className={`flex min-h-[72px] items-center ${
                    index > 0 ? "border-t border-white/[0.08]" : ""
                  }`}
                >
                  <label
                    className={`flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left ${
                      ready ? "cursor-pointer hover:bg-white/[0.04]" : "cursor-not-allowed"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!ready || busy || pendingAirdropClaim}
                      onChange={(event) => toggleSelection(item.id, event.target.checked)}
                      className="h-5 w-5 shrink-0 accent-[#0A84FF]"
                      aria-label={`Select ${fmtAmount(item.amount)} ${item.assetCode}`}
                    />
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#30D158]/12 text-[#30D158]">
                      <IconGift size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center justify-between gap-2">
                        <span className="mono min-w-0 truncate text-[14px] font-semibold text-white">
                          {fmtAmount(item.amount)} {item.assetCode}
                        </span>
                        {ready ? (
                          checked && (
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white">
                              <IconCheck size={11} />
                            </span>
                          )
                        ) : (
                          <span className="shrink-0 rounded-md bg-[#FF9F0A]/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#FF9F0A]">
                            Trustline required
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10.5px] text-neutral-500">
                        {item.issuer
                          ? `Issuer ${formatTrezorAddress(item.issuer)}`
                          : "Native XLM · no trustline required"}
                      </span>
                      {item.sponsor && (
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-neutral-600">
                          Sponsor {formatTrezorAddress(item.sponsor)}
                        </span>
                      )}
                    </span>
                  </label>
                  <button
                    type="button"
                    title="Dismiss balance locally"
                    onClick={() => handleDismiss(item.id)}
                    disabled={busy || pendingAirdropClaim}
                    className="mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-neutral-500 hover:bg-white/[0.06] hover:text-white disabled:text-neutral-700"
                    aria-label={`Dismiss ${fmtAmount(item.amount)} ${item.assetCode} locally`}
                  >
                    <IconEyeOff size={17} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {!showDismissed && missingTrustlines > 0 && (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5">
            <p className="text-[12px] leading-relaxed text-neutral-400">
              {missingTrustlines} issued balance{missingTrustlines === 1 ? " needs" : "s need"} an
              exact issuer trustline before it can be selected. Adding one reserves XLM and should
              only be done for an asset you trust.
            </p>
            <Button
              variant="secondary"
              className="mt-3 w-full !min-h-10 !py-2 text-[12px]"
              onClick={onAddAsset}
            >
              <IconPlus size={14} /> Add trusted asset
            </Button>
          </div>
        )}

        {!showDismissed && activeAccount?.watchOnly && (
          <ErrorText message="This is a watch-only account. Switch to an account that can sign to claim." />
        )}
        {error && <ErrorText message={error} />}
        {!showDismissed && (pendingSubmission || pendingAirdropClaim) && !error && (
          <div
            role="status"
            className="rounded-2xl border border-[#0A84FF]/25 bg-[#0A84FF]/10 p-3 text-[12px] leading-relaxed text-[#64D2FF]"
          >
            Claim submitted. Waiting for ledger confirmation before another claim can be sent.
          </div>
        )}

        {showDismissed ? (
          <Button variant="secondary" className="w-full" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3.5">
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="text-neutral-400">Selected network fee</span>
                <span className="mono text-neutral-200">{selectedFee} XLM</span>
              </div>
              <p className="mt-1 text-[10.5px] leading-relaxed text-neutral-500">
                {selectedIds.length} operation{selectedIds.length === 1 ? "" : "s"} · one atomic
                transaction · one signature
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button variant="ghost" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button
                loading={busy}
                disabled={
                  selectedIds.length === 0 ||
                  pendingAirdropClaim ||
                  Boolean(pendingSubmission) ||
                  Boolean(activeAccount?.watchOnly)
                }
                onClick={() => void handleClaimSelected()}
              >
                Claim selected ({selectedIds.length})
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
