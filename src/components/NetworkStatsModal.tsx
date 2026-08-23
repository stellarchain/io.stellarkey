"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { NETWORKS } from "@/lib/stellar";
import { fetchFeeStats, testHorizonPing, type FeeStats } from "@/lib/api";
import { stroopsToAmount } from "@/lib/stellar-domain";
import { Button, ErrorText, Modal, ModalHeader } from "./ui";
import { IconCheck, IconShield } from "./icons";

export function NetworkStatsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { network, activity, minimumBalanceXlm } = useWallet();
  const [feeStats, setFeeStats] = useState<FeeStats | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void Promise.all([fetchFeeStats(network), testHorizonPing(network)])
      .then(([fees, latency]) => {
        if (!alive) return;
        setFeeStats(fees);
        setLatencyMs(latency);
        setError(null);
      })
      .catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Unable to load network statistics.");
      });
    return () => {
      alive = false;
    };
  }, [network, open]);

  if (!open) return null;

  const totalTxCount = activity.length;

  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader
        title="Network Status"
        subtitle={`Observed data from Stellar ${NETWORKS[network].label}`}
        onClose={onClose}
      />
      <div className="p-6 space-y-4">
        {/* Top Eco Banner */}
        <div className="rounded-3xl bg-gradient-to-br from-emerald-950/40 via-zinc-900 to-black border border-emerald-500/20 p-5 flex items-center justify-between shadow-lg">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-semibold text-emerald-400 mb-2">
              <IconShield size={12} />
              <span>No Proof-of-Work Mining</span>
            </div>
            <h3 className="text-[17px] font-bold text-white tracking-tight">
              Stellar Consensus Protocol
            </h3>
            <p className="text-[12px] text-neutral-400 mt-1 max-w-sm">
              Federated Byzantine Agreement reaches consensus without proof-of-work mining.
            </p>
          </div>
          <div className="text-right">
            <span className="text-3xl">🌱</span>
          </div>
        </div>

        {/* 4-Stat Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Horizon Response
            </p>
            <p className="mono text-[22px] font-bold text-white mt-1">{latencyMs === null ? "—" : `${latencyMs}ms`}</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">Measured from this browser</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Accepted Base Fee
            </p>
            <p className="mono text-[22px] font-bold text-[#30D158] mt-1">
              {feeStats ? stroopsToAmount(BigInt(feeStats.modeAcceptedFee)) : "—"} XLM
            </p>
            <p className="text-[11px] text-neutral-400 mt-0.5">Horizon fee distribution mode</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Loaded Activity
            </p>
            <p className="mono text-[22px] font-bold text-[#64D2FF] mt-1">{totalTxCount}</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">Operations loaded in this session</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Smart Contracts Engine
            </p>
            <p className="mono text-[22px] font-bold text-purple-300 mt-1">Soroban</p>
            <p className="text-[11px] text-purple-400 mt-0.5">Rust WASM Virtual Machine</p>
          </div>
        </div>

        {error && <ErrorText message={error} />}

        {/* Live account reserve */}
        <div className="panel-inset p-4 space-y-2 text-[12.5px]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Active Account Reserve
          </p>
          <div className="flex justify-between text-neutral-300">
            <span>Current Minimum Balance</span>
            <span className="mono font-semibold text-white">
              {minimumBalanceXlm === null ? "—" : `${minimumBalanceXlm} XLM`}
            </span>
          </div>
          <div className="flex justify-between text-neutral-300">
            <span>Last Ledger Base Fee</span>
            <span className="mono font-semibold text-white">
              {feeStats ? `${feeStats.lastLedgerBaseFee} stroops` : "—"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 pt-1 text-[11px] text-emerald-400">
            <IconCheck size={12} />
            <span>Minimum balance includes subentries and sponsorship deltas reported by Horizon.</span>
          </div>
        </div>

        <Button variant="ghost" className="w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
