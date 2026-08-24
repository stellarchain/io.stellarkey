"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { isValidPublicAddress } from "@/lib/vault";
import { fmtAmount, isValidAmount, memoByteLength } from "@/lib/format";
import { formatTrezorAddress } from "@/lib/address-display";
import {
  compareStellarAmounts,
  splitStellarAmount,
  sumStellarAmounts,
} from "@/lib/stellar-domain";
import { networkFeeXlm } from "@/lib/api";
import { triggerHaptic } from "@/lib/haptics";
import { spendableAssetBalance } from "@/lib/transaction-intent";
import type { SubmissionResult } from "@/lib/submission";
import { Button, ErrorText, Modal, ModalHeader, Select } from "./ui";
import { FiatValue } from "./FiatValue";
import { useToast } from "./Toast";
import { IconAlert, IconCheck, IconLedger, IconPlus, IconTrash, IconTrezor } from "./icons";

interface RecipientRow {
  id: string;
  destination: string;
  amount: string;
}

export function BatchSendModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
  memo?: string;
}) {
  if (!open) return null;
  return <BatchSendInner onClose={onClose} />;
}

function BatchSendInner({ onClose }: { onClose: () => void }) {
  const { balances, minimumBalanceXlm, recommendedBaseFeeStroops, sendBatch, refresh, contacts, activeAccount, submissionStatus } = useWallet();
  const { toast } = useToast();
  const [assetKey, setAssetKey] = useState("native");
  const [memo, setMemo] = useState("");
  const [rows, setRows] = useState<RecipientRow[]>([
    { id: "1", destination: "", amount: "" },
    { id: "2", destination: "", amount: "" },
  ]);
  const [csvInput, setCsvInput] = useState("");
  const [showCsvInput, setShowCsvInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<SubmissionResult | null>(null);
  const trackedSubmissionStatus = submission ? submissionStatus(submission) : null;

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive || trackedSubmissionStatus !== "failed") return;
      setSubmission(null);
      setError("Batch transaction failed on-chain. Review the recipients and retry when ready.");
      triggerHaptic("error");
    })();
    return () => {
      alive = false;
    };
  }, [trackedSubmissionStatus]);

  const options = useMemo(() => balances ?? [], [balances]);
  const selectedAsset = useMemo(
    () => options.find((b) => b.key === assetKey) ?? null,
    [options, assetKey],
  );

  const totalAmount = useMemo(
    () => sumStellarAmounts(rows.filter((r) => isValidAmount(r.amount)).map((r) => r.amount)),
    [rows],
  );

  const validRows = rows.filter(
    (r) => isValidPublicAddress(r.destination.trim()) && isValidAmount(r.amount),
  );
  const feeXlm = networkFeeXlm(recommendedBaseFeeStroops, validRows.length);
  const maxSendable = selectedAsset?.isNative
    ? minimumBalanceXlm === null
      ? "0"
      : spendableAssetBalance(selectedAsset, [minimumBalanceXlm, feeXlm])
    : selectedAsset
      ? spendableAssetBalance(selectedAsset)
      : "0";

  const canSubmit =
    validRows.length > 0 &&
    validRows.length === rows.filter((r) => r.destination.trim() || r.amount.trim()).length &&
    compareStellarAmounts(totalAmount, maxSendable) <= 0 &&
    memoByteLength(memo) <= 28 &&
    !busy;

  function handleAddRow() {
    if (rows.length >= 100) {
      toast("Stellar transactions support at most 100 operations.", "error");
      return;
    }
    triggerHaptic("selection");
    setRows((prev) => [...prev, { id: String(Date.now()), destination: "", amount: "" }]);
  }

  function handleRemoveRow(id: string) {
    triggerHaptic("selection");
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  function handleRowChange(id: string, field: "destination" | "amount", val: string) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: field === "amount" ? val.replace(/,/g, ".") : val } : r)),
    );
  }

  function handleSelectContactForRow(id: string, addr: string) {
    triggerHaptic("selection");
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, destination: addr } : r)),
    );
  }

  function handleSplitEqually() {
    if (rows.length === 0 || compareStellarAmounts(maxSendable, "0") <= 0) return;
    triggerHaptic("selection");
    const splitAmounts = splitStellarAmount(maxSendable, rows.length);
    setRows((prev) => prev.map((r, index) => ({ ...r, amount: splitAmounts[index] })));
    toast(`Split ${fmtAmount(maxSendable)} ${selectedAsset?.code} equally`, "info");
  }

  function handleParseCsv() {
    triggerHaptic("selection");
    const lines = csvInput.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsed: RecipientRow[] = [];
    for (const line of lines) {
      const parts = line.split(/[,\t;]/).map((p) => p.trim());
      if (parts.length >= 2) {
        parsed.push({
          id: String(Math.random()),
          destination: parts[0],
          amount: parts[1],
        });
      }
    }
    if (parsed.length > 0) {
      setRows(parsed.slice(0, 100));
      setShowCsvInput(false);
      if (parsed.length > 100) {
        setError("Only the first 100 recipients were imported (Stellar's operation limit).");
      }
      triggerHaptic("success");
    }
  }

  async function handleBatchSend() {
    if (!selectedAsset || validRows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendBatch({
        payments: validRows.map((r) => ({
          destination: r.destination.trim(),
          amount: r.amount.trim(),
          assetCode: selectedAsset.code,
          issuer: selectedAsset.issuer,
        })),
        memo: memo.trim() ? { type: "text", value: memo.trim() } : undefined,
      });
      setSubmission(result);
      triggerHaptic(result.status === "status_unknown" ? "warning" : "success");
      window.setTimeout(() => void refresh(), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch transaction failed.");
      triggerHaptic("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? () => undefined : onClose} dismissable={!busy} wide>
      <ModalHeader
        title={
          trackedSubmissionStatus === "status_unknown"
            ? "Batch Status Unknown"
            : submission
              ? trackedSubmissionStatus === "confirmed" ? "Batch Confirmed" : "Batch Accepted"
              : "Multi-Send Disperse"
        }
        subtitle={
          trackedSubmissionStatus === "status_unknown"
            ? "Do not resubmit blindly — canonical hash tracking is active"
            : submission
              ? trackedSubmissionStatus === "confirmed"
                ? `Confirmed for ${validRows.length} recipient${validRows.length > 1 ? "s" : ""} in 1 atomic transaction`
                : `Accepted for ${validRows.length} recipient${validRows.length > 1 ? "s" : ""} in 1 atomic transaction`
            : "Send payments to multiple recipients in 1 transaction"
        }
        onClose={busy ? undefined : onClose}
      />
      <div className="p-4 sm:p-6">
        {submission ? (
          <div className="flex flex-col items-center py-4 text-center">
            <span className={`flex h-16 w-16 items-center justify-center rounded-full border ${
              trackedSubmissionStatus === "status_unknown"
                ? "border-[#FF9F0A]/30 bg-[#FF9F0A]/10 text-[#FF9F0A]"
                : "border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]"
            }`}>
              {trackedSubmissionStatus === "status_unknown" ? <IconAlert size={28} /> : <IconCheck size={28} />}
            </span>
            <p className="display-h mt-4 text-xl font-light text-white">
              {trackedSubmissionStatus === "status_unknown"
                ? "Submission Status Unknown"
                : trackedSubmissionStatus === "confirmed"
                  ? "Batch Confirmed"
                  : "Batch Accepted"}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-neutral-400">
              {trackedSubmissionStatus === "status_unknown"
                ? "Horizon did not confirm acceptance. Do not resubmit blindly; the wallet will keep polling this hash."
                : trackedSubmissionStatus === "confirmed"
                  ? `The atomic payment for ${validRows.length} recipient${validRows.length > 1 ? "s" : ""} is confirmed on-chain.`
                  : `Horizon accepted the atomic payment for ${validRows.length} recipient${validRows.length > 1 ? "s" : ""}. Confirmation tracking continues.`}
            </p>
            <p className="mt-4 w-full break-all rounded-xl bg-white/[0.04] p-3 font-mono text-[10.5px] text-neutral-300">
              {submission.network} · {submission.hash}
            </p>
            <Button variant="ghost" className="mt-6 w-full" onClick={onClose}>
              {trackedSubmissionStatus === "status_unknown" ? "Close and Keep Tracking" : "Done"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
              {/* Asset picker */}
              <div>
                <label className="field-label">Asset</label>
                <Select
                  value={assetKey}
                  onChange={setAssetKey}
                  ariaLabel="Asset"
                  options={options.map((b) => ({
                    value: b.key,
                    label: b.code,
                    sublabel: `Balance: ${fmtAmount(b.balance)}`,
                  }))}
                />
              </div>

              {/* Mode toggle: Manual vs CSV */}
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-white">
                  Recipients ({rows.length})
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSplitEqually}
                    className="text-[12px] font-medium text-[#30D158] hover:underline"
                    title="Split total balance equally across all recipient rows"
                  >
                    Split Equally
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection");
                      setShowCsvInput((s) => !s);
                    }}
                    className="text-[12px] font-medium text-[#0A84FF] hover:underline"
                  >
                    {showCsvInput ? "Switch to Form" : "Paste CSV / TSV"}
                  </button>
                </div>
              </div>

              {showCsvInput ? (
                <div className="space-y-2">
                  <textarea
                    rows={5}
                    placeholder={"GDESTINATION..., 10.5\nGDESTINATION2..., 5.0"}
                    value={csvInput}
                    onChange={(e) => setCsvInput(e.target.value)}
                    className="input mono text-base resize-none sm:text-[12px]"
                  />
                  <Button variant="secondary" className="w-full !h-9 text-[13px]" onClick={handleParseCsv}>
                    Parse & Populate Rows
                  </Button>
                </div>
              ) : (
                <div className="max-h-[280px] space-y-2.5 overflow-y-auto pr-1">
                  {rows.map((row, idx) => (
                    <div
                      key={row.id}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-neutral-400">
                          Recipient #{idx + 1}
                        </span>
                        {contacts.length > 0 && (
                          <Select
                            size="sm"
                            value=""
                            onChange={(v) => {
                              if (v) handleSelectContactForRow(row.id, v);
                            }}
                            placeholder="+ Contact"
                            ariaLabel="Fill from contact"
                            className="!border-transparent !bg-transparent !px-1.5 !py-0.5 text-[11px] font-medium !text-[#0A84FF] hover:!bg-white/[0.06]"
                            options={contacts
                              .slice()
                              .sort((a, b) => (a.favorite && !b.favorite ? -1 : !a.favorite && b.favorite ? 1 : 0))
                              .map((c) => ({
                                value: c.address,
                                label: `${c.favorite ? "★ " : ""}${c.name}`,
                                sublabel: formatTrezorAddress(c.address),
                              }))}
                          />
                        )}
                        {rows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveRow(row.id)}
                            className="text-neutral-500 hover:text-[#FF453A] transition-colors"
                          >
                            <IconTrash size={13} />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <div className="sm:col-span-8">
                          <input
                            type="text"
                            placeholder="Recipient address (G...)"
                            value={row.destination}
                            onChange={(e) => handleRowChange(row.id, "destination", e.target.value)}
                            className="input mono !h-11 text-base md:!h-9 sm:text-[12px]"
                          />
                        </div>
                        <div className="sm:col-span-4">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="Amount"
                            value={row.amount}
                            onChange={(e) => handleRowChange(row.id, "amount", e.target.value)}
                            className="input mono !h-11 text-base md:!h-9 sm:text-[12px]"
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={handleAddRow}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/20 py-2 text-[12.5px] font-semibold text-[#0A84FF] hover:bg-white/[0.04]"
                  >
                    <IconPlus size={14} />
                    <span>Add Recipient</span>
                  </button>
                </div>
              )}

              {/* Memo */}
              <div>
                <label className="field-label">Transaction Memo (Optional)</label>
                <input
                  type="text"
                  placeholder="Max 28 bytes"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className="input text-base sm:text-[13px]"
                />
              </div>

              {/* Hardware Device Indicator */}
              {activeAccount?.hardware && (
                <div className="rounded-xl border border-[#0A84FF]/30 bg-[#0A84FF]/10 p-2.5 flex items-center justify-between text-[12px] text-[#0A84FF]">
                  <div className="flex items-center gap-2">
                    {activeAccount.hardware === "ledger" ? (
                      <IconLedger size={15} className="text-[#64D2FF]" />
                    ) : (
                      <IconTrezor size={15} className="text-emerald-400" />
                    )}
                    <span className="font-semibold">
                      Sign on {activeAccount.hardware === "ledger" ? "Ledger" : "Trezor"} Device
                    </span>
                  </div>
                  <span className="mono text-[11px] text-neutral-400">{activeAccount.path ?? "m/44'/148'/0'"}</span>
                </div>
              )}

              {/* Summary calculation */}
              <div className="panel-inset p-3 space-y-1 text-[12px]">
                <div className="flex justify-between text-neutral-300">
                  <span>Total Recipients</span>
                  <span className="font-semibold">{validRows.length}</span>
                </div>
                <div className="flex justify-between text-white font-semibold">
                  <span>Total Disperse</span>
                  <span className="mono flex items-baseline gap-2">
                    {fmtAmount(totalAmount)} {selectedAsset?.code}
                    <FiatValue
                      amount={totalAmount}
                      code={selectedAsset?.code ?? "XLM"}
                      issuer={selectedAsset?.issuer}
                      isNative={selectedAsset?.isNative}
                      className="text-[11px] font-normal text-neutral-400"
                    />
                  </span>
                </div>
                <div className="flex justify-between text-neutral-300">
                  <span>Network Fee</span>
                  <span className="mono">{feeXlm} XLM</span>
                </div>
                {compareStellarAmounts(totalAmount, maxSendable) > 0 && (
                  <p className="text-[11px] text-[#FF453A] pt-1">
                    Exceeds spendable balance ({fmtAmount(maxSendable)} {selectedAsset?.code})
                  </p>
                )}
              </div>

              {error && (
                <div>
                  <ErrorText message={error} />
                </div>
              )}

              <Button
                className="!mt-6 w-full"
                loading={busy}
                disabled={!canSubmit}
                onClick={() => void handleBatchSend()}
              >
                {busy ? "Broadcasting…" : `Disperse to ${validRows.length} Recipient${validRows.length > 1 ? "s" : ""}`}
              </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
