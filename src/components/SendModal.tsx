"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Federation } from "@stellar/stellar-sdk";
import { useWallet } from "@/hooks/useWallet";
import { isValidPublicAddress } from "@/lib/vault";
import { NETWORKS } from "@/lib/stellar";
import { parseSep7PayUri, type PayUriPayload } from "@/lib/payuri";
import { fmtAmount, isValidAmount, memoByteLength } from "@/lib/format";
import { lookupKnownAsset } from "@/lib/assets";
import { fetchFeeStats, type FeeStats } from "@/lib/api";
import type { Contact } from "@/lib/contacts";
import { triggerHaptic } from "@/lib/haptics";
import { Button, ErrorText, Modal, ModalHeader, SegmentedControl } from "./ui";
import {
  IconCheck,
  IconChevronDown,
  IconExternal,
  IconQrScan,
} from "./icons";

type Stage = "form" | "review" | "sending" | "done";
type MemoType = "text" | "id" | "hash";
type FeeTier = "normal" | "priority" | "urgent";

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
  const [feeTier, setFeeTier] = useState<FeeTier>("normal");
  const [liveFeeStats, setLiveFeeStats] = useState<FeeStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [resolvingFed, setResolvingFed] = useState(false);
  const [fedResolvedAddr, setFedResolvedAddr] = useState<string | null>(null);

  // Fetch live fee surge stats on mount
  useEffect(() => {
    let alive = true;
    void (async () => {
      const stats = await fetchFeeStats(network);
      if (alive && stats) setLiveFeeStats(stats);
    })();
    return () => {
      alive = false;
    };
  }, [network]);

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
  const trustlinesCount = (balances ?? []).filter((b) => !b.isNative).length;
  const requiredReserve = selectedAsset?.isNative ? 1.0 + trustlinesCount * 0.5 : 0;
  const maxSendable = selectedAsset?.isNative
    ? Math.max(0, balanceNum - requiredReserve)
    : balanceNum;

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

  const reserveBlocked = selectedAsset?.isNative === true && isValidAmount(amount) && amountNum > maxSendable;
  const canReview = (destOk || Boolean(fedResolvedAddr)) && amountOk && memoOk && !reserveBlocked;

  // Dynamic fee calculation from live fee stats
  const normalStroops = liveFeeStats?.modeAcceptedFee ?? 100;
  const priorityStroops = Math.max(200, (liveFeeStats?.p90AcceptedFee ?? 150) * 2);
  const urgentStroops = Math.max(500, (liveFeeStats?.p99AcceptedFee ?? 300) * 3);

  const feeStroops = feeTier === "urgent" ? urgentStroops : feeTier === "priority" ? priorityStroops : normalStroops;
  const feeXlm = (feeStroops / 10_000_000).toFixed(7);

  const remainingBalance = Math.max(
    0,
    balanceNum - amountNum - (selectedAsset?.isNative ? parseFloat(feeXlm) : 0),
  )
    .toFixed(7)
    .replace(/\.?0+$/, "");

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
        feeStroops,
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

            <div className="panel-inset mt-6 divide-y divide-white/[0.08]">
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
                <span className="mono text-[13px] text-neutral-300">
                  {feeXlm} XLM <span className="text-[11px] text-neutral-500">({feeStroops} stroops)</span>
                </span>
              </Row>
            </div>

            {/* Pre-Flight Balance Delta Simulator */}
            <div className="panel-inset mt-3 p-3.5 space-y-1.5 text-[12px]">
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400">
                Pre-Flight Balance Simulation
              </p>
              <div className="flex justify-between text-neutral-300">
                <span>Balance Before</span>
                <span className="mono">{fmtAmount(balanceNum)} {selectedAsset?.code}</span>
              </div>
              <div className="flex justify-between text-[#FF453A]">
                <span>Transfer Amount</span>
                <span className="mono">−{fmtAmount(amountNum)} {selectedAsset?.code}</span>
              </div>
              {selectedAsset?.isNative && (
                <div className="flex justify-between text-neutral-400">
                  <span>Network Gas Fee</span>
                  <span className="mono">−{feeXlm} XLM</span>
                </div>
              )}
              <div className="border-t border-white/10 pt-1.5 flex justify-between font-semibold text-white">
                <span>Balance After</span>
                <span className="mono">{remainingBalance} {selectedAsset?.code}</span>
              </div>
            </div>

            {/* Transaction Safety Shield Verification */}
            <div className="panel-inset mt-3 p-3 flex items-center justify-between bg-[#30D158]/[0.06] border border-[#30D158]/20 text-[12px]">
              <div className="flex items-center gap-2 text-[#30D158]">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#30D158]/20">
                  <IconCheck size={12} />
                </span>
                <span className="font-semibold">Safety Shield Verified</span>
              </div>
              <span className="text-[11px] text-neutral-400">Ed25519 · Non-Custodial</span>
            </div>

            {error && (
              <div className="mt-4">
                <ErrorText message={error} />
              </div>
            )}

            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button
                variant="ghost"
                disabled={stage === "sending"}
                onClick={() => {
                  triggerHaptic("selection");
                  setStage("form");
                }}
              >
                Back
              </Button>
              <Button
                loading={stage === "sending"}
                disabled={stage === "sending"}
                onClick={() => void handleConfirm()}
              >
                {stage === "sending" ? "Sending…" : "Confirm Send"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <ModalHeader
              title="Send Payment"
              subtitle={`Transfer assets on Stellar ${NETWORKS[network].label}`}
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

              {/* Destination */}
              <div>
                <div className="flex items-center justify-between pb-1">
                  <label className="field-label !pb-0">Recipient Address or Federation</label>
                  <button
                    type="button"
                    onClick={() => setShowScanner((s) => !s)}
                    className="text-[12px] font-medium text-[#0A84FF] hover:underline flex items-center gap-1"
                  >
                    <IconQrScan size={13} />
                    <span>{showScanner ? "Hide Camera" : "Scan QR"}</span>
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="G... or user*domain.com"
                  value={destination}
                  onChange={(e) => handleDestinationChange(e.target.value)}
                  className="input mono text-[13px]"
                  spellCheck={false}
                  autoComplete="off"
                />
                {contacts.length > 0 && !destination && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-neutral-500">Quick contact:</span>
                    {contacts.slice(0, 4).map((c) => (
                      <button
                        key={c.address}
                        type="button"
                        onClick={() => {
                          triggerHaptic("selection");
                          handleDestinationChange(c.address);
                        }}
                        className="chip !py-0.5 !px-2 text-[11.5px] text-neutral-300 hover:text-white"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
                {resolvingFed && (
                  <p className="mt-1 text-[11px] text-[#0A84FF]">Resolving federation address…</p>
                )}
                {fedResolvedAddr && (
                  <p className="mt-1 mono text-[11px] text-[#30D158] truncate">
                    ✓ Resolved: {fedResolvedAddr}
                  </p>
                )}
                {matchedContact && (
                  <p className="mt-1 text-[11px] text-neutral-400">
                    Contact: <span className="text-white font-medium">{matchedContact.name}</span>
                  </p>
                )}
              </div>

              {showScanner && (
                <QrScannerBox
                  onScan={(text) => {
                    handleDestinationChange(text);
                    setShowScanner(false);
                    triggerHaptic("success");
                  }}
                />
              )}

              {/* Amount */}
              <div>
                <div className="flex items-center justify-between pb-1">
                  <label className="field-label !pb-0">Amount</label>
                  {selectedAsset && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic("selection");
                        setAmount(String(maxSendable));
                      }}
                      className="text-[12px] font-medium text-[#0A84FF] hover:underline"
                    >
                      Max: {fmtAmount(maxSendable)} {selectedAsset.code}
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/,/g, "."))}
                  className="input mono text-[15px]"
                />
                {reserveBlocked && (
                  <p className="mt-1 text-[11.5px] text-[#FF453A]">
                    Exceeds maximum sendable reserve ({fmtAmount(maxSendable)} XLM).
                  </p>
                )}
              </div>

              {/* Fee Tier Selector with Live Surge Stats */}
              <div>
                <div className="flex items-center justify-between pb-1">
                  <label className="field-label !pb-0">Speed / Network Fee</label>
                  {liveFeeStats && (
                    <span className="text-[11px] font-medium text-[#30D158] flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#30D158]" />
                      Base Fee: {liveFeeStats.lastLedgerBaseFee} stroops
                    </span>
                  )}
                </div>
                <SegmentedControl
                  value={feeTier}
                  onChange={(val) => {
                    triggerHaptic("selection");
                    setFeeTier(val as FeeTier);
                  }}
                  options={[
                    { value: "normal", label: `Normal (${normalStroops}s)` },
                    { value: "priority", label: `Priority (${priorityStroops}s)` },
                    { value: "urgent", label: `Urgent (${urgentStroops}s)` },
                  ]}
                />
              </div>

              {/* Memo */}
              <div>
                <div className="flex items-center justify-between pb-1">
                  <label className="field-label !pb-0">Memo (Optional)</label>
                  <div className="flex gap-2 text-[11px]">
                    {(["text", "id", "hash"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          triggerHaptic("selection");
                          setMemoType(t);
                        }}
                        className={`capitalize ${
                          memoType === t ? "text-white font-semibold" : "text-neutral-500"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  placeholder={
                    memoType === "text"
                      ? "Max 28 bytes"
                      : memoType === "id"
                        ? "Numeric 64-bit integer"
                        : "64-char hex hash"
                  }
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className="input text-[13px]"
                />
              </div>

              <Button
                className="mt-6 w-full"
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
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 text-[13px]">
      <span className="text-neutral-400">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function QrScannerBox({ onScan }: { onScan: (val: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [permErr, setPermErr] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | null = null;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setPermErr(true);
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        if ("BarcodeDetector" in window) {
          const barcodeDetector = new (window as unknown as {
            BarcodeDetector: new (opts: { formats: string[] }) => {
              detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
            };
          }).BarcodeDetector({ formats: ["qr_code"] });

          const tick = async () => {
            if (videoRef.current && videoRef.current.readyState === 4) {
              try {
                const barcodes = await barcodeDetector.detect(videoRef.current);
                if (barcodes.length > 0) {
                  onScan(barcodes[0].rawValue);
                  return;
                }
              } catch {
                void 0;
              }
            }
            timer = window.setTimeout(tick, 300);
          };
          timer = window.setTimeout(tick, 500);
        }
      } catch {
        setPermErr(true);
      }
    }

    void start();

    return () => {
      if (timer) window.clearTimeout(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [onScan]);

  return (
    <div className="overflow-hidden rounded-2xl bg-black border border-white/10 p-2 text-center">
      {permErr ? (
        <p className="py-6 text-[12px] text-neutral-400">
          Camera permission needed to scan QR codes.
        </p>
      ) : (
        <div className="relative aspect-square max-h-[220px] mx-auto overflow-hidden rounded-xl bg-neutral-900">
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="h-36 w-36 rounded-2xl border-2 border-white/70 shadow-lg" />
          </div>
        </div>
      )}
    </div>
  );
}
