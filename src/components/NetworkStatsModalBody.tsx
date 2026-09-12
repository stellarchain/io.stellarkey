"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { SectionHeader } from "@/components/ui";
import {
  useWalletActivity,
  useWalletIdentity,
  useWalletLedger,
} from "@/hooks/useWallet";
import { NETWORKS } from "@/lib/stellar";
import { fetchFeeStats, type FeeStats } from "@/lib/api";
import { getHorizonUrl, testHorizonEndpoint } from "@/lib/stellar-endpoints";
import { stroopsToAmount } from "@/lib/stellar-domain";
import {
  Button,
  ErrorText,
  LoadingRegion,
  ModalBody,
  ModalFooter,
} from "./ui";
import { IconCheck, IconShield, IconStellar } from "./icons";
import { XlmFeeFiatValue } from "./XlmFeeFiatValue";

/** Header text the body reports to its shell once it knows the network. */
export type NetworkStatsHeader = { title: string; subtitle?: string };

export interface NetworkStatsModalBodyProps {
  onClose: () => void;
  onHeaderChange: (header: NetworkStatsHeader | null) => void;
}

// Mounted fresh by the NetworkStatsModal shell for each opening, so every
// visit measures again rather than showing the previous visit's numbers.
export function NetworkStatsModalBody({ onClose, onHeaderChange }: NetworkStatsModalBodyProps) {
  const { network } = useWalletIdentity();
  const { activity } = useWalletActivity();
  const { minimumBalanceXlm } = useWalletLedger();
  const [feeStats, setFeeStats] = useState<FeeStats | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    onHeaderChange({
      title: "Network Status",
      subtitle: `Observed data from Stellar ${NETWORKS[network].label}`,
    });
    return () => onHeaderChange(null);
  }, [network, onHeaderChange]);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      fetchFeeStats(network),
      testHorizonEndpoint(network, getHorizonUrl(network)).then((result) => result.latencyMs),
    ])
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
  }, [network]);

  const loading = feeStats === null && error === null;
  const totalTxCount = activity.length;
  const acceptedFeeXlm = feeStats
    ? stroopsToAmount(BigInt(feeStats.modeAcceptedFee))
    : null;
  const lastLedgerFeeXlm = feeStats
    ? stroopsToAmount(BigInt(feeStats.lastLedgerBaseFee))
    : null;

  return (
    <ModalBody>
      {/* Top Eco Banner */}
      <div className="rounded-3xl bg-gradient-to-br from-emerald-950/40 via-zinc-900 to-black border border-emerald-500/20 p-5 flex items-center justify-between gap-4 shadow-lg">
        <div className="min-w-0">
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
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400"
        >
          <IconStellar size={26} />
        </span>
      </div>

      {loading ? (
        <LoadingRegion label="Measuring network statistics" className="min-h-40" />
      ) : (
        /* 4-Stat Grid */
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <SectionHeader>Horizon Response</SectionHeader>
            <p className="mono text-[18px] font-bold sm:text-[22px] text-white mt-1">{latencyMs === null ? "—" : `${latencyMs}ms`}</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">Measured from this browser</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <SectionHeader>Accepted Base Fee</SectionHeader>
            <p className="mono text-[18px] font-bold sm:text-[22px] text-white mt-1">
              {acceptedFeeXlm ?? "—"} XLM
            </p>
            {acceptedFeeXlm && (
              <XlmFeeFiatValue amount={acceptedFeeXlm} className="mt-0.5 block" />
            )}
            <p className="text-[11px] text-neutral-400 mt-0.5">Horizon fee distribution mode</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <SectionHeader>Loaded Activity</SectionHeader>
            <p className="mono text-[18px] font-bold sm:text-[22px] text-white mt-1">{totalTxCount}</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">Operations loaded in this session</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <SectionHeader>Smart Contracts Engine</SectionHeader>
            <p className="mt-1 text-[18px] font-bold text-white sm:text-[22px]">Soroban</p>
            <p className="text-[11px] text-purple-400 mt-0.5">Rust WASM Virtual Machine</p>
          </div>
        </div>
      )}

      {error && <ErrorText message={error} />}

      {/* Live account reserve */}
      <div className="panel-inset p-4 space-y-2 text-[12.5px]">
        <SectionHeader>Active Account Reserve</SectionHeader>
        <div className="flex justify-between text-neutral-300">
          <span>Current Minimum Balance</span>
          <span className="mono font-semibold text-white">
            {minimumBalanceXlm === null ? "—" : `${minimumBalanceXlm} XLM`}
          </span>
        </div>
        <div className="flex justify-between text-neutral-300">
          <span>Last Ledger Base Fee</span>
          <span className="flex flex-col items-end font-semibold text-white">
            <span className="mono">
              {feeStats ? `${feeStats.lastLedgerBaseFee} stroops · ${lastLedgerFeeXlm} XLM` : "—"}
            </span>
            {lastLedgerFeeXlm && <XlmFeeFiatValue amount={lastLedgerFeeXlm} />}
          </span>
        </div>
        <div className="flex items-center gap-1.5 pt-1 text-[11px] text-emerald-400">
          <IconCheck size={12} />
          <span>Minimum balance includes subentries and sponsorship deltas reported by Horizon.</span>
        </div>
      </div>

      <ModalFooter
        primary={
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        }
      />
    </ModalBody>
  );
}
