"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { isValidPublicAddress } from "@/lib/vault";
import { fmtAmount, isValidAmount, shortenAddr } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { Button, ErrorText, Modal, ModalHeader } from "./ui";
import { useToast } from "./Toast";
import { IconCheck, IconChevronDown, IconPlus, IconTrash } from "./icons";

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
  const { balances, sendBatch, refresh, contacts } = useWallet();
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
  const [success, setSuccess] = useState(false);

  const options = useMemo(() => balances ?? [], [balances]);
  const selectedAsset = useMemo(
    () => options.find((b) => b.key === assetKey) ?? null,
    [options, assetKey],
  );

  const totalAmount = useMemo(() => {
    return rows.reduce((acc, r) => {
      const v = parseFloat(r.amount);
      return acc + (Number.isNaN(v) ? 0 : v);
    }, 0);
  }, [rows]);

  const balanceNum = selectedAsset ? parseFloat(selectedAsset.balance) : 0;
  const validRows = rows.filter(
    (r) => isValidPublicAddress(r.destination.trim()) && isValidAmount(r.amount),
  );

  const canSubmit =
    validRows.length > 0 &&
    validRows.length === rows.filter((r) => r.destination.trim() || r.amount.trim()).length &&
    totalAmount <= balanceNum &&
    !busy;

  function handleAddRow() {
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
    if (rows.length === 0 || balanceNum <= 0) return;
    triggerHaptic("selection");
    const splitAmount = (balanceNum / rows.length).toFixed(4).replace(/\.?0+$/, "");
    setRows((prev) => prev.map((r) => ({ ...r, amount: splitAmount })));
    toast(`Split ${fmtAmount(balanceNum)} ${selectedAsset?.code} equally`, "info");
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
      setRows(parsed);
      setShowCsvInput(false);
      triggerHaptic("success");
    }
  }

  async function handleBatchSend() {
    if (!selectedAsset || validRows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await sendBatch({
        payments: validRows.map((r) => ({
          destination: r.destination.trim(),
          amount: r.amount.trim(),
          assetCode: selectedAsset.code,
          issuer: selectedAsset.issuer,
        })),
        memoText: memo.trim() || undefined,
      });
      setSuccess(true);
      triggerHaptic("success");
      window.setTimeout(() => void refresh(), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch transaction failed.");
      triggerHaptic("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? () => undefined : onClose} dismissable={!busy}>
      <div className="px-6 pb-6 pt-7">
        {success ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]">
              <IconCheck size={28} />
            </span>
            <p className="display-h mt-5 text-xl font-light text-white">Batch Payment Broadcasted</p>
            <p className="mt-1.5 text-[13px] text-neutral-400">
              Successfully sent to {validRows.length} recipient{validRows.length > 1 ? "s" : ""} in a single atomic transaction.
            </p>
            <Button variant="ghost" className="mt-7 w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <ModalHeader
              title="Multi-Send Disperse"
              subtitle="Send payments to multiple recipients in 1 transaction"
              onClose={onClose}
            />

            <div className="mt-5 space-y-4">
              {/* Asset picker */}
              <div>
                <label className="field-label">Asset</label>
                <div className="relative">
                  <select
                    value={assetKey}
                    onChange={(e) => {
                      triggerHaptic("selection");
                      setAssetKey(e.target.value);
                    }}
                    className="input pr-10 cursor-pointer text-[14px]"
                  >
                    {options.map((b) => (
                      <option key={b.key} value={b.key} className="bg-neutral-900 text-white">
                        {b.code} · Balance: {fmtAmount(b.balance)}
                      </option>
                    ))}
                  </select>
                  <IconChevronDown
                    size={16}
                    className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-400"
                  />
                </div>
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
                    className="input mono text-[12px] resize-none"
                  />
                  <Button variant="secondary" className="w-full !h-9 text-[13px]" onClick={handleParseCsv}>
                    Parse & Populate Rows
                  </Button>
                </div>
              ) : (
                <div className="max-h-[260px] space-y-2.5 overflow-y-auto pr-1">
                  {rows.map((row, idx) => (
                    <div
                      key={row.id}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-neutral-400">
                          #{idx + 1}
                        </span>
                        {contacts.length > 0 && (
                          <select
                            onChange={(e) => {
                              if (e.target.value) handleSelectContactForRow(row.id, e.target.value);
                            }}
                            defaultValue=""
                            className="bg-transparent text-[11px] font-medium text-[#0A84FF] outline-none cursor-pointer"
                          >
                            <option value="" disabled className="bg-neutral-900 text-neutral-400">
                              + Contact
                            </option>
                            {contacts.map((c) => (
                              <option key={c.address} value={c.address} className="bg-neutral-900 text-white">
                                {c.name} ({shortenAddr(c.address, 4, 4)})
                              </option>
                            ))}
                          </select>
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
                      <input
                        type="text"
                        placeholder="Recipient address (G...)"
                        value={row.destination}
                        onChange={(e) => handleRowChange(row.id, "destination", e.target.value)}
                        className="input mono !h-9 text-[12px]"
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="Amount"
                        value={row.amount}
                        onChange={(e) => handleRowChange(row.id, "amount", e.target.value)}
                        className="input mono !h-9 text-[12px]"
                      />
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
                  className="input text-[13px]"
                />
              </div>

              {/* Summary calculation */}
              <div className="panel-inset p-3 space-y-1 text-[12px]">
                <div className="flex justify-between text-neutral-300">
                  <span>Total Recipients</span>
                  <span className="font-semibold">{validRows.length}</span>
                </div>
                <div className="flex justify-between text-white font-semibold">
                  <span>Total Disperse</span>
                  <span className="mono">
                    {totalAmount.toFixed(4)} {selectedAsset?.code}
                  </span>
                </div>
                {totalAmount > balanceNum && (
                  <p className="text-[11px] text-[#FF453A] pt-1">
                    Exceeds available balance ({fmtAmount(balanceNum)} {selectedAsset?.code})
                  </p>
                )}
              </div>

              {error && (
                <div className="mt-4">
                  <ErrorText message={error} />
                </div>
              )}

              <Button
                className="mt-6 w-full"
                loading={busy}
                disabled={!canSubmit}
                onClick={() => void handleBatchSend()}
              >
                {busy ? "Broadcasting…" : `Disperse to ${validRows.length} Recipient${validRows.length > 1 ? "s" : ""}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
