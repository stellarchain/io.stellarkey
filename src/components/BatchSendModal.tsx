"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { isValidPublicAddress } from "@/lib/vault";
import { fmtAmount, isValidAmount } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { Button, ErrorText, Field, Modal, ModalHeader } from "./ui";
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
}) {
  if (!open) return null;
  return <BatchSendInner onClose={onClose} />;
}

function BatchSendInner({ onClose }: { onClose: () => void }) {
  const { balances, sendBatch, refresh } = useWallet();
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
      const n = parseFloat(r.amount);
      return acc + (Number.isFinite(n) && n > 0 ? n : 0);
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
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function handleRowChange(id: string, field: "destination" | "amount", val: string) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: val } : r)),
    );
  }

  function handleParseCsv() {
    if (!csvInput.trim()) return;
    const lines = csvInput.trim().split(/\r?\n/);
    const parsed: RecipientRow[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(/[,\t\s]+/);
      if (parts.length >= 2) {
        parsed.push({
          id: String(Date.now() + i),
          destination: parts[0].trim(),
          amount: parts[1].trim(),
        });
      }
    }

    if (parsed.length > 0) {
      triggerHaptic("success");
      setRows(parsed);
      setShowCsvInput(false);
      setCsvInput("");
    }
  }

  async function handleBatchSend() {
    if (!selectedAsset || !canSubmit) return;
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
      triggerHaptic("success");
      setSuccess(true);
      window.setTimeout(() => void refresh(), 4000);
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Batch transaction failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        title="Batch Payment Disperse"
        subtitle="Send assets to multiple recipients at once"
        onClose={onClose}
      />
      <div className="px-6 pb-6 pt-4">
        {success ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]">
              <IconCheck size={28} />
            </span>
            <p className="display-h mt-5 text-xl font-bold text-white">Batch Sent Successfully</p>
            <p className="mt-1.5 text-[13px] text-neutral-400">
              Dispersed {fmtAmount(totalAmount)} {selectedAsset?.code} across {validRows.length} recipients.
            </p>
            <Button variant="ghost" className="mt-7 w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-neutral-300">Asset</span>
                <div className="relative">
                  <select
                    className="input !w-auto py-1 pl-3 pr-8 text-[13px] font-semibold bg-white/10"
                    value={assetKey}
                    onChange={(e) => setAssetKey(e.target.value)}
                    aria-label="Asset"
                  >
                    {options.map((b) => (
                      <option key={b.key} value={b.key} className="bg-neutral-900">
                        {b.code} ({fmtAmount(b.balance)})
                      </option>
                    ))}
                  </select>
                  <IconChevronDown
                    size={13}
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection");
                  setShowCsvInput((v) => !v);
                }}
                className="text-[12px] font-semibold text-[#0A84FF] hover:underline"
              >
                {showCsvInput ? "Manual Rows" : "Paste CSV / List"}
              </button>
            </div>

            {showCsvInput ? (
              <div className="space-y-2 mb-4">
                <textarea
                  className="input mono min-h-[120px] text-[12px]"
                  placeholder="G..., 50&#10;G..., 100"
                  value={csvInput}
                  onChange={(e) => setCsvInput(e.target.value)}
                />
                <Button variant="secondary" className="w-full !py-2 text-[13px]" onClick={handleParseCsv}>
                  Import Lines
                </Button>
              </div>
            ) : (
              <div className="max-h-[260px] overflow-y-auto space-y-2.5 pr-1">
                {rows.map((row, i) => (
                  <div key={row.id} className="flex items-center gap-2">
                    <span className="text-[11px] mono text-neutral-500 w-4 shrink-0">{i + 1}</span>
                    <input
                      className="input mono flex-1 !py-2 text-[12.5px]"
                      placeholder="Destination G..."
                      value={row.destination}
                      onChange={(e) => handleRowChange(row.id, "destination", e.target.value)}
                    />
                    <input
                      className="input mono w-24 !py-2 text-[12.5px]"
                      placeholder="Amount"
                      inputMode="decimal"
                      value={row.amount}
                      onChange={(e) => handleRowChange(row.id, "amount", e.target.value.replace(/[^0-9.]/g, ""))}
                    />
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(row.id)}
                        className="text-neutral-500 hover:text-[#FF453A] p-1.5"
                      >
                        <IconTrash size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!showCsvInput && (
              <button
                type="button"
                onClick={handleAddRow}
                className="mt-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-[#0A84FF] hover:underline"
              >
                <IconPlus size={14} /> Add Recipient
              </button>
            )}

            {/* Total Summary */}
            <div className="panel-inset mt-4 p-3.5 space-y-1.5 text-[12.5px]">
              <div className="flex justify-between">
                <span className="text-neutral-400">Total Recipients</span>
                <span className="font-semibold text-white">{validRows.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Total Sum</span>
                <span className="mono font-bold text-white">
                  {fmtAmount(totalAmount)} {selectedAsset?.code}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Est. Base Fee</span>
                <span className="mono text-neutral-300">
                  {(rows.length * 0.00001).toFixed(5)} XLM
                </span>
              </div>
            </div>

            <div className="mt-3">
              <Field label="Memo (optional)">
                <input
                  className="input !py-2 text-[13px]"
                  placeholder="Shared batch memo"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  maxLength={28}
                />
              </Field>
            </div>

            <div className="mt-3">
              <ErrorText message={error ?? ""} />
            </div>

            <div className="mt-5 flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                loading={busy}
                disabled={!canSubmit}
                onClick={() => void handleBatchSend()}
              >
                Disperse {validRows.length} Payments
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
