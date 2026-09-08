"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useState } from "react";
import {
  useWalletContacts,
  useWalletIdentity,
  useWalletLedger,
  useWalletSubmission,
  useWalletTransactions,
} from "@/hooks/useWallet";
import { isValidPaymentAddress } from "@/lib/vault";
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
import { Button, ErrorText, HashValue, ModalBody, ModalFooter, Select } from "./ui";
import { FiatValue } from "./FiatValue";
import { XlmFeeFiatValue } from "./XlmFeeFiatValue";
import { useToast } from "./Toast";
import { IconAlert, IconCheck, IconLedger, IconPlus, IconTrash, IconTrezor } from "./icons";

/** Header override the body reports so the owning shell shows stage-aware titles. */
export type BatchSendHeader = { title: string; subtitle?: string; onBack?: () => void };

interface RecipientRow {
  id: string;
  destination: string;
  amount: string;
}

type BatchStage = "form" | "review";

interface BatchReview {
  sourcePublicKey: string;
  assetKey: string;
  assetCode: string;
  issuer?: string;
  payments: Array<{
    destination: string;
    amount: string;
    assetCode: string;
    issuer?: string;
  }>;
  memo?: { type: "text"; value: string };
  totalAmount: string;
  feeXlm: string;
}

export type BatchSendModalBodyProps = {
  onClose: () => void;
  onBusyChange(busy: boolean): void;
  onDirtyChange?(dirty: boolean): void;
  onHeaderChange?(header: BatchSendHeader | null): void;
};

export function BatchSendModalBody({
  onClose,
  onBusyChange,
  onDirtyChange,
  onHeaderChange,
}: BatchSendModalBodyProps) {
  const { activeAccount } = useWalletIdentity();
  const { balances, minimumBalanceXlm, recommendedBaseFeeStroops } = useWalletLedger();
  const { contacts } = useWalletContacts();
  const { submissionStatus } = useWalletSubmission();
  const { sendBatch, refresh } = useWalletTransactions();
  const { toast } = useToast();
  const [assetKey, setAssetKey] = useState("native");
  const memoInputId = useId();
  const csvInputId = useId();
  const [memo, setMemo] = useState("");
  const [rows, setRows] = useState<RecipientRow[]>([
    { id: "1", destination: "", amount: "" },
    { id: "2", destination: "", amount: "" },
  ]);
  const [csvInput, setCsvInput] = useState("");
  const [showCsvInput, setShowCsvInput] = useState(false);
  const [stage, setStage] = useState<BatchStage>("form");
  const [review, setReview] = useState<BatchReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<SubmissionResult | null>(null);
  const trackedSubmissionStatus = submission ? submissionStatus(submission) : null;

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  const hasEntries =
    rows.some((row) => row.destination.trim() !== "" || row.amount.trim() !== "") ||
    csvInput.trim() !== "" ||
    memo.trim() !== "";
  // Back from the review stage routes through the shell's discard prompt, so
  // only the editable stage counts as unsaved input.
  const dirty = stage === "form" && !submission && hasEntries;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

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
    (r) => isValidPaymentAddress(r.destination.trim()) && isValidAmount(r.amount),
  );
  const feeXlm = networkFeeXlm(recommendedBaseFeeStroops, validRows.length);
  const maxSendable = selectedAsset?.isNative
    ? minimumBalanceXlm === null
      ? "0"
      : spendableAssetBalance(selectedAsset, [minimumBalanceXlm, feeXlm])
    : selectedAsset
      ? spendableAssetBalance(selectedAsset)
      : "0";

  const canReview =
    validRows.length > 0 &&
    validRows.length === rows.filter((r) => r.destination.trim() || r.amount.trim()).length &&
    compareStellarAmounts(totalAmount, maxSendable) <= 0 &&
    memoByteLength(memo) <= 28 &&
    !busy;

  const recipientCount = review?.payments.length ?? validRows.length;
  const recipientNoun = `recipient${recipientCount > 1 ? "s" : ""}`;

  const backToForm = useCallback(() => {
    setStage("form");
    setReview(null);
    setError(null);
  }, []);

  // The shell shows the form-stage header by default; review and broadcast
  // outcomes override it, with Back only while nothing has been signed.
  const headerTitle =
    trackedSubmissionStatus === "status_unknown"
      ? "Batch Status Unknown"
      : submission
        ? trackedSubmissionStatus === "confirmed" ? "Batch Confirmed" : "Batch Accepted"
        : stage === "review"
          ? "Review Multi-Send"
          : null;
  const headerSubtitle =
    trackedSubmissionStatus === "status_unknown"
      ? "Do not resubmit blindly — canonical hash tracking is active"
      : submission
        ? trackedSubmissionStatus === "confirmed"
          ? `Confirmed for ${recipientCount} ${recipientNoun} in 1 atomic transaction`
          : `Accepted for ${recipientCount} ${recipientNoun} in 1 atomic transaction`
        : stage === "review"
          ? "Check every recipient and amount before signing · Step 2 of 2"
          : null;
  const canGoBack = stage === "review" && !submission;
  useLayoutEffect(() => {
    if (!onHeaderChange) return;
    onHeaderChange(
      headerTitle === null
        ? null
        : {
            title: headerTitle,
            subtitle: headerSubtitle ?? undefined,
            onBack: canGoBack ? backToForm : undefined,
          },
    );
    return () => onHeaderChange(null);
  }, [backToForm, canGoBack, headerSubtitle, headerTitle, onHeaderChange]);

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
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, destination: addr } : r)),
    );
  }

  function handleSplitEqually() {
    if (rows.length === 0 || compareStellarAmounts(maxSendable, "0") <= 0) return;
    const splitAmounts = splitStellarAmount(maxSendable, rows.length);
    setRows((prev) => prev.map((r, index) => ({ ...r, amount: splitAmounts[index] })));
    toast(`Split ${fmtAmount(maxSendable)} ${selectedAsset?.code} equally`, "info");
  }

  function handleParseCsv() {
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

  function handleReview() {
    if (!selectedAsset || !activeAccount || !canReview) return;
    const payments = validRows.map((row) => ({
      destination: row.destination.trim(),
      amount: row.amount.trim(),
      assetCode: selectedAsset.code,
      issuer: selectedAsset.issuer ?? undefined,
    }));
    setReview({
      sourcePublicKey: activeAccount.publicKey,
      assetKey: selectedAsset.key,
      assetCode: selectedAsset.code,
      issuer: selectedAsset.issuer ?? undefined,
      payments,
      memo: memo.trim() ? { type: "text", value: memo.trim() } : undefined,
      totalAmount,
      feeXlm,
    });
    setStage("review");
    setError(null);
  }

  async function handleBatchSend() {
    if (!review) return;
    const currentAsset = options.find((asset) => asset.key === review.assetKey);
    if (
      activeAccount?.publicKey !== review.sourcePublicKey ||
      !currentAsset ||
      currentAsset.code !== review.assetCode ||
      (currentAsset.issuer ?? undefined) !== review.issuer
    ) {
      setStage("form");
      setReview(null);
      setError("The active account or asset changed. Review the batch again before signing.");
      triggerHaptic("error");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await sendBatch({
        payments: review.payments,
        memo: review.memo,
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
    <ModalBody>
      {submission ? (
        <>
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
                  ? `The atomic payment for ${recipientCount} ${recipientNoun} is confirmed on-chain.`
                  : `Horizon accepted the atomic payment for ${recipientCount} ${recipientNoun}. Confirmation tracking continues.`}
            </p>
            <p className="mt-4 w-full break-all rounded-xl bg-white/[0.04] p-3 font-mono text-[10.5px] text-neutral-300">
              {submission.network} · {submission.hash}
            </p>
          </div>
          <ModalFooter primary={<Button onClick={onClose}>Done</Button>} />
        </>
      ) : stage === "review" && review ? (
        <>
          <div className="rounded-xl border border-[#0A84FF]/25 bg-[#0A84FF]/10 p-3 text-[12px] leading-relaxed text-[#A7D4FF]">
            Nothing has been signed or sent. Confirm only after checking every recipient.
          </div>

          <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
            {review.payments.map((payment, index) => (
              <div
                key={`${payment.destination}:${index}`}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-bold text-neutral-400">
                    Recipient #{index + 1}
                  </span>
                  <span className="mono shrink-0 text-[13px] font-semibold text-white">
                    {fmtAmount(payment.amount)} {payment.assetCode}
                  </span>
                </div>
                <HashValue
                  value={payment.destination}
                  className="mt-1 text-[11px] text-neutral-300"
                />
              </div>
            ))}
          </div>

          <div className="panel-inset space-y-1 p-3 text-[12px]">
            <div className="flex justify-between gap-3 text-neutral-300">
              <span>Total</span>
              <span className="mono font-semibold text-white">
                {fmtAmount(review.totalAmount)} {review.assetCode}
              </span>
            </div>
            <div className="flex justify-between gap-3 text-neutral-300">
              <span>Network fee</span>
              <span className="flex flex-col items-end">
                <span className="mono">{review.feeXlm} XLM</span>
                <XlmFeeFiatValue amount={review.feeXlm} />
              </span>
            </div>
            <div className="flex justify-between gap-3 text-neutral-300">
              <span>Transaction memo</span>
              <span className="max-w-[65%] truncate text-right text-white">
                {review.memo?.value ?? "None"}
              </span>
            </div>
          </div>

          {activeAccount?.hardware && (
            <div className="flex items-center gap-2 rounded-xl border border-[#0A84FF]/30 bg-[#0A84FF]/10 p-2.5 text-[12px] text-[#0A84FF]">
              {activeAccount.hardware === "ledger" ? (
                <IconLedger size={15} className="text-[#64D2FF]" />
              ) : (
                <IconTrezor size={15} className="text-emerald-400" />
              )}
              <span className="font-semibold">
                Final approval happens on your {activeAccount.hardware === "ledger" ? "Ledger" : "Trezor"} device.
              </span>
            </div>
          )}

          {error && <ErrorText message={error} />}

          <ModalFooter
            primary={
              <Button
                loading={busy}
                loadingLabel="Broadcasting batch"
                onClick={() => void handleBatchSend()}
              >
                Confirm and Send
              </Button>
            }
          />
        </>
      ) : (
        <>
          {/* Asset picker */}
          <div>
            <span className="field-label">Asset</span>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-white">
              Recipients ({rows.length})
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="btn-sm min-h-11"
                disabled={rows.length === 0 || compareStellarAmounts(maxSendable, "0") <= 0}
                onClick={handleSplitEqually}
              >
                Split equally
              </Button>
              <Button
                variant="ghost"
                className="btn-sm min-h-11"
                onClick={() => setShowCsvInput((s) => !s)}
              >
                {showCsvInput ? "Switch to form" : "Paste CSV / TSV"}
              </Button>
            </div>
          </div>

          {showCsvInput ? (
            <div className="space-y-2">
              <label htmlFor={csvInputId} className="sr-only">
                Recipients as CSV or TSV, one address and amount per line
              </label>
              <textarea
                id={csvInputId}
                rows={5}
                placeholder={"GDESTINATION..., 10.5\nGDESTINATION2..., 5.0"}
                value={csvInput}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="enter"
                onChange={(e) => setCsvInput(e.target.value)}
                className="input mono text-base resize-none sm:text-[13px]"
              />
              <Button variant="secondary" className="w-full" onClick={handleParseCsv}>
                Parse and populate rows
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
                        ariaLabel={`Fill recipient ${idx + 1} from contact`}
                        className="!border-transparent !bg-transparent font-medium !text-[#0A84FF] hover:!bg-white/[0.06]"
                        options={contacts
                          .slice()
                          .sort((a, b) => (a.favorite && !b.favorite ? -1 : !a.favorite && b.favorite ? 1 : 0))
                          .map((c) => ({
                            value: c.address,
                            label: c.name,
                            sublabel: formatTrezorAddress(c.address),
                          }))}
                      />
                    )}
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(row.id)}
                        aria-label={`Remove recipient ${idx + 1}`}
                        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:text-[#FF453A]"
                      >
                        <IconTrash size={15} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <div className="sm:col-span-8">
                      <input
                        type="text"
                        aria-label={`Recipient ${idx + 1} address`}
                        placeholder="Recipient address (G...)"
                        value={row.destination}
                        autoCapitalize="none"
                        autoComplete="off"
                        spellCheck={false}
                        enterKeyHint="next"
                        onChange={(e) => handleRowChange(row.id, "destination", e.target.value)}
                        className="input mono text-base sm:text-[13px]"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Recipient ${idx + 1} amount`}
                        placeholder="Amount"
                        value={row.amount}
                        autoComplete="off"
                        enterKeyHint="next"
                        onChange={(e) => handleRowChange(row.id, "amount", e.target.value)}
                        className="input mono text-base sm:text-[15px]"
                      />
                    </div>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={handleAddRow}
                className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/20 text-[12.5px] font-semibold text-[#0A84FF] hover:bg-white/[0.04]"
              >
                <IconPlus size={14} />
                <span>Add Recipient</span>
              </button>
            </div>
          )}

          {/* Memo */}
          <div>
            <label className="field-label" htmlFor={memoInputId}>
              Transaction Memo (Optional)
            </label>
            <input
              id={memoInputId}
              type="text"
              placeholder="Max 28 bytes"
              value={memo}
              autoComplete="off"
              enterKeyHint="done"
              onChange={(e) => setMemo(e.target.value)}
              className="input text-base sm:text-[14px]"
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
              <span className="flex flex-col items-end">
                <span className="mono">{feeXlm} XLM</span>
                <XlmFeeFiatValue amount={feeXlm} />
              </span>
            </div>
            {compareStellarAmounts(totalAmount, maxSendable) > 0 && (
              <p className="text-[11px] text-[#FF453A] pt-1">
                Exceeds spendable balance ({fmtAmount(maxSendable)} {selectedAsset?.code})
              </p>
            )}
          </div>

          {error && <ErrorText message={error} />}

          <ModalFooter
            primary={
              <Button disabled={!canReview} onClick={handleReview}>
                {`Review ${validRows.length} Recipient${validRows.length > 1 ? "s" : ""}`}
              </Button>
            }
          />
        </>
      )}
    </ModalBody>
  );
}
