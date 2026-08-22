"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Federation } from "@stellar/stellar-sdk";
import { useWallet } from "@/hooks/useWallet";
import { isValidPublicAddress } from "@/lib/vault";
import { NETWORKS } from "@/lib/stellar";
import { parseSep7PayUri, type PayUriPayload } from "@/lib/payuri";
import { fmtAmount, isValidAmount, memoByteLength } from "@/lib/format";
import { lookupKnownAsset } from "@/lib/assets";
import type { Contact } from "@/lib/contacts";
import { triggerHaptic } from "@/lib/haptics";
import { Avatar, Button, ErrorText, Modal, ModalHeader } from "./ui";
import {
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconExternal,
  IconQrScan,
} from "./icons";

type Stage = "form" | "review" | "sending" | "done";
type MemoType = "text" | "id" | "hash";

export function SendModal({
  open,
  onClose,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  prefill?: PayUriPayload | null;
}) {
  if (!open) return null;
  return <SendInner onClose={onClose} prefill={prefill} />;
}

function SendInner({
  onClose,
  prefill,
}: {
  onClose: () => void;
  prefill?: PayUriPayload | null;
}) {
  const { balances, send, network, refresh, contacts } = useWallet();
  const [stage, setStage] = useState<Stage>("form");
  const [destination, setDestination] = useState(prefill?.destination ?? "");
  const [amount, setAmount] = useState(
    prefill?.amount && isValidAmount(prefill.amount) ? prefill.amount : "",
  );
  const [assetKey, setAssetKey] = useState(() => {
    if (!prefill?.assetCode || prefill.assetCode === "XLM") return "native";
    const match = (balances ?? []).find(
      (b) =>
        b.code === prefill.assetCode &&
        (!prefill.assetIssuer || b.issuer === prefill.assetIssuer),
    );
    return match?.key ?? "native";
  });
  const [memoType, setMemoType] = useState<MemoType>("text");
  const [memo, setMemo] = useState(prefill?.memo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [resolvingFed, setResolvingFed] = useState(false);
  const [fedResolvedAddr, setFedResolvedAddr] = useState<string | null>(null);

  const options = useMemo(() => balances ?? [], [balances]);
  const selectedAsset = useMemo(
    () => options.find((b) => b.key === assetKey) ?? null,
    [options, assetKey],
  );

  const isFederation = destination.includes("*");

  // Handle federation address check (e.g. user*domain.com) asynchronously
  useEffect(() => {
    let alive = true;
    if (!isFederation || destination.trim().length < 5) return;

    const timer = window.setTimeout(async () => {
      setResolvingFed(true);
      try {
        const res = await Federation.Server.resolve(destination.trim());
        if (alive && res?.account_id) {
          setFedResolvedAddr(res.account_id);
          if (res.memo) {
            setMemo(res.memo);
            if (res.memo_type === "id") setMemoType("id");
            else if (res.memo_type === "hash") setMemoType("hash");
          }
        }
      } catch {
        if (alive) setFedResolvedAddr(null);
      } finally {
        if (alive) setResolvingFed(false);
      }
    }, 600);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [destination, isFederation]);

  const effectiveDestination = (isFederation && fedResolvedAddr) ? fedResolvedAddr : destination.trim();
  const destOk = isValidPublicAddress(effectiveDestination);
  const matchedContact: Contact | undefined = contacts.find(
    (c) => c.address === effectiveDestination,
  );

  const amountNum = parseFloat(amount || "0");
  const balanceNum = selectedAsset ? parseFloat(selectedAsset.balance) : 0;
  const amountOk =
    isValidAmount(amount) && selectedAsset !== null && amountNum <= balanceNum;

  const memoBytes = memoByteLength(memo);
  const memoOk =
    memoType === "text"
      ? memoBytes <= 28
      : memoType === "id"
        ? /^\d+$/.test(memo.trim()) || memo.trim() === ""
        : memoType === "hash"
          ? /^[0-9a-fA-F]{64}$/.test(memo.trim()) || memo.trim() === ""
          : true;

  const reserveBlocked =
    selectedAsset?.isNative === true && isValidAmount(amount) && amountNum > balanceNum - 1;
  const canReview = (destOk || Boolean(fedResolvedAddr)) && amountOk && memoOk && !reserveBlocked;

  async function handleConfirm() {
    if (!selectedAsset) return;
    setStage("sending");
    setError(null);
    try {
      const result = await send({
        destination: effectiveDestination,
        amount,
        assetCode: selectedAsset.code,
        issuer: selectedAsset.issuer,
        memoText: memo.trim() || undefined,
      });
      setHash(result.hash);
      setStage("done");
      triggerHaptic("success");
      window.setTimeout(() => void refresh(), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed.");
      setStage("review");
      triggerHaptic("error");
    }
  }

  function handleDestinationChange(raw: string) {
    setDestination(raw);
    setFedResolvedAddr(null);
    setResolvingFed(false);
    const parsed = parseSep7PayUri(raw);
    if (parsed?.destination) {
      setDestination(parsed.destination);
      if (parsed.amount && isValidAmount(parsed.amount)) setAmount(parsed.amount);
      if (parsed.memo) setMemo(parsed.memo.slice(0, 28));
      if (parsed.assetCode) {
        const isNative = parsed.assetCode === "XLM" || parsed.assetCode === "native";
        if (isNative) {
          setAssetKey("native");
        } else {
          const match = options.find(
            (b) =>
              b.code === parsed.assetCode &&
              (!parsed.assetIssuer || b.issuer === parsed.assetIssuer),
          );
          if (match) setAssetKey(match.key);
        }
      }
      triggerHaptic("medium");
    }
  }

  const knownSelected = selectedAsset ? lookupKnownAsset(selectedAsset.code) : null;

  return (
    <Modal
      open
      onClose={stage === "sending" ? () => undefined : onClose}
      dismissable={stage !== "sending"}
    >
      <div className="px-6 pb-6 pt-7">
        {stage === "done" ? (
          <div className="flex flex-col items-center py-8">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]">
              <IconCheck size={28} />
            </span>
            <p className="display-h mt-5 text-xl font-light text-white">Payment Sent</p>
            <p className="mt-1.5 text-[13px] text-neutral-400">
              Confirmed on Stellar {NETWORKS[network].label}.
            </p>
            {hash && (
              <a
                className="chip mt-5"
                href={NETWORKS[network].explorerTxUrl(hash)}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Explorer <IconExternal size={11} />
              </a>
            )}
            <Button variant="ghost" className="mt-7 w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : stage === "review" || stage === "sending" ? (
          <>
            <p className="eyebrow mb-6 text-center">
              {stage === "sending" ? "Confirming…" : "Review Transfer"}
            </p>
            <div className="flex flex-col items-center">
              <p className="display-h text-[36px] text-white">
                {fmtAmount(amount)}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className="mono rounded-full px-2.5 py-1 text-[10px] font-bold"
                  style={
                    knownSelected
                      ? { background: knownSelected.color, color: "#fff" }
                      : selectedAsset?.isNative
                        ? { background: "#fdda24", color: "#0d0d0d" }
                        : { background: "rgba(255,255,255,0.08)", color: "#fff" }
                  }
                >
                  {selectedAsset?.code}
                </span>
                {knownSelected && (
                  <span className="text-[12px] text-neutral-400">{knownSelected.name}</span>
                )}
              </div>
            </div>

            <div className="panel-inset mt-7 divide-y divide-white/[0.08]">
              <Row label="To">
                <span className="mono text-[12px] break-all text-white">{effectiveDestination}</span>
              </Row>
              {isFederation && (
                <Row label="Federation">
                  <span className="text-[13px] text-white">{destination}</span>
                </Row>
              )}
              {matchedContact && (
                <Row label="Contact">
                  <span className="text-[13px] text-white">{matchedContact.name}</span>
                </Row>
              )}
              {!selectedAsset?.isNative && (
                <Row label="Issuer">
                  <span className="mono truncate text-[12px] text-neutral-400">
                    {selectedAsset?.issuer?.slice(0, 10)}…{selectedAsset?.issuer?.slice(-6)}
                  </span>
                </Row>
              )}
              {memo.trim() && (
                <Row label="Memo">
                  <span className="text-[13px] text-white">{memo}</span>
                </Row>
              )}
              <Row label="Network Fee">
                <span className="text-[13px] text-neutral-400">0.00001 XLM</span>
              </Row>
            </div>

            <div className="mt-5">
              <ErrorText message={error ?? ""} />
            </div>

            <div className="mt-5 flex gap-3">
              <Button
                variant="ghost"
                className="flex-1"
                disabled={stage === "sending"}
                onClick={() => setStage("form")}
              >
                Back
              </Button>
              <Button
                className="flex-1"
                loading={stage === "sending"}
                disabled={stage === "sending"}
                onClick={() => void handleConfirm()}
              >
                Confirm & Send
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="text-center">
              <p className="eyebrow">Send Payment</p>
              <div className="mt-4 flex items-center justify-center gap-3">
                <input
                  className="mono w-[190px] border-none bg-transparent text-center text-[40px] font-light tracking-tight text-white outline-none placeholder:text-neutral-600"
                  placeholder="0"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  autoFocus
                />
                <div className="relative shrink-0">
                  <select
                    className="input !w-auto appearance-none py-2.5 pl-4 pr-9 text-[14px] font-semibold"
                    value={assetKey}
                    onChange={(e) => setAssetKey(e.target.value)}
                    aria-label="Asset"
                  >
                    {(options.length > 0 ? options : [{ key: "native", code: "XLM" }]).map(
                      (b) => (
                        <option key={b.key} value={b.key} className="bg-neutral-900">
                          {b.code}
                        </option>
                      ),
                    )}
                  </select>
                  <IconChevronDown
                    size={14}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400"
                  />
                </div>
              </div>
              <div className="mt-2.5 flex items-center justify-center gap-1.5">
                {selectedAsset && (
                  <>
                    <span className="mono mr-1 text-[11px] text-neutral-400">
                      {fmtAmount(selectedAsset.balance)} {selectedAsset.code}
                    </span>
                    {[0.25, 0.5, 1].map((f) => (
                      <button
                        key={f}
                        type="button"
                        className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-neutral-400 transition-colors hover:border-white/20 hover:text-white"
                        onClick={() => {
                          triggerHaptic("selection");
                          setAmount(
                            parseFloat(
                              (
                                Math.max(0, balanceNum - (selectedAsset.isNative ? 1 : 0)) * f
                              ).toFixed(7),
                            ).toString(),
                          );
                        }}
                      >
                        {f === 1 ? "Max" : `${f * 100}%`}
                      </button>
                    ))}
                  </>
                )}
              </div>
              {reserveBlocked && (
                <p className="mt-2 text-[11px] text-[#FF9F0A]">
                  Reserve note: 1 XLM is reserved for base balance.
                </p>
              )}
            </div>

            {/* Quick Contacts Bar */}
            {contacts.length > 0 && (
              <div className="mt-5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                  Recent Contacts
                </p>
                <div className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none">
                  {contacts.map((c) => (
                    <button
                      key={c.address}
                      type="button"
                      onClick={() => {
                        triggerHaptic("selection");
                        handleDestinationChange(c.address);
                      }}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] transition-colors shrink-0 ${
                        destination === c.address
                          ? "border-[#0A84FF] bg-[#0A84FF]/10 text-white"
                          : "border-white/10 bg-white/[0.04] text-neutral-300 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      <Avatar seed={c.address} size={18} />
                      <span className="font-medium">{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 space-y-4">
              <div className="relative">
                <label className="block text-[12px] font-semibold tracking-tight text-neutral-300 mb-1.5">
                  Recipient Address or Federation
                </label>
                <div className="relative flex items-center">
                  <input
                    className="input mono pr-10 text-[13px]"
                    placeholder="G... or username*stellar.org"
                    value={destination}
                    onChange={(e) => handleDestinationChange(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection");
                      setShowScanner(true);
                    }}
                    className="absolute right-2.5 flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white"
                    aria-label="Scan QR Code"
                  >
                    <IconQrScan size={16} />
                  </button>
                </div>
                {resolvingFed && (
                  <p className="mt-1 text-[11px] text-[#0A84FF]">Resolving federation address…</p>
                )}
                {fedResolvedAddr && (
                  <p className="mono mt-1 text-[11px] text-[#30D158] truncate">
                    Resolved: {fedResolvedAddr}
                  </p>
                )}
              </div>

              {/* Memo field with Type selector */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[12px] font-semibold tracking-tight text-neutral-300">
                    Memo (optional)
                  </span>
                  <div className="flex items-center gap-1">
                    {(["text", "id", "hash"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          triggerHaptic("selection");
                          setMemoType(t);
                        }}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          memoType === t
                            ? "bg-white/20 text-white"
                            : "text-neutral-500 hover:text-neutral-300"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                    {memoType === "text" && (
                      <span className="mono text-[10px] text-neutral-500 ml-1">
                        {memoBytes}/28
                      </span>
                    )}
                  </div>
                </div>
                <input
                  className="input text-[13px]"
                  placeholder={
                    memoType === "text"
                      ? "Public memo text"
                      : memoType === "id"
                        ? "Numeric memo ID (uint64)"
                        : "64-character hex hash"
                  }
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={!canReview}
                onClick={() => {
                  triggerHaptic("selection");
                  setStage("review");
                }}
              >
                Review Transfer
              </Button>
            </div>
          </>
        )}
      </div>

      {/* QR Code Scanner Dialog */}
      {showScanner && (
        <ScannerModal
          onClose={() => setShowScanner(false)}
          onScan={(val) => {
            setShowScanner(false);
            handleDestinationChange(val);
          }}
        />
      )}
    </Modal>
  );
}

function ScannerModal({
  onClose,
  onScan,
}: {
  onClose: () => void;
  onScan: (value: string) => void;
}) {
  const [manualCode, setManualCode] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <Modal open onClose={onClose}>
      <ModalHeader title="Scan Stellar QR Code" onClose={onClose} />
      <div className="p-6 flex flex-col items-center">
        <div className="relative flex h-56 w-56 items-center justify-center rounded-2xl border-2 border-dashed border-white/20 bg-neutral-900/60 p-4 text-center">
          <div className="flex flex-col items-center gap-3">
            <IconCamera size={36} className="text-neutral-400" />
            <p className="text-[12px] text-neutral-400">
              Upload a QR code image or paste payload
            </p>
            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  triggerHaptic("selection");
                }
              }}
            />
            <Button
              variant="secondary"
              className="text-[12px] py-1.5 px-3"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose Image
            </Button>
          </div>
        </div>

        <div className="mt-5 w-full space-y-2">
          <label className="block text-[12px] font-medium text-neutral-400">
            Or paste address / SEP-0007 URI
          </label>
          <div className="flex gap-2">
            <input
              className="input text-[13px]"
              placeholder="Paste QR payload..."
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
            />
            <Button
              disabled={!manualCode.trim()}
              onClick={() => onScan(manualCode.trim())}
            >
              Use
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="shrink-0 pt-0.5 text-[13px] font-medium text-neutral-400">
        {label}
      </span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}
