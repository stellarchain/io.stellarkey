"use client";

import { useWallet } from "@/hooks/useWallet";
import { NETWORKS } from "@/lib/stellar";
import { Button, Modal, ModalHeader } from "./ui";
import { IconCheck, IconShield } from "./icons";

export function NetworkStatsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { network, activity } = useWallet();
  if (!open) return null;

  const totalTxCount = activity.length;
  // Estimated gas savings: Ethereum average tx = ~$4.50, Stellar = ~$0.00001
  const ethSavingsUsd = (totalTxCount * 4.5).toFixed(2);


  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader
        title="Network Efficiency & Stats"
        subtitle={`Stellar ${NETWORKS[network].label} Performance & Eco-Score`}
        onClose={onClose}
      />
      <div className="p-6 space-y-4">
        {/* Top Eco Banner */}
        <div className="rounded-3xl bg-gradient-to-br from-emerald-950/40 via-zinc-900 to-black border border-emerald-500/20 p-5 flex items-center justify-between shadow-lg">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-semibold text-emerald-400 mb-2">
              <IconShield size={12} />
              <span>100% Carbon Neutral</span>
            </div>
            <h3 className="text-[17px] font-bold text-white tracking-tight">
              Eco-Friendly Stellar Consensus (SCP)
            </h3>
            <p className="text-[12px] text-neutral-400 mt-1 max-w-sm">
              Powered by the Federated Byzantine Agreement with zero energy-intensive Proof-of-Work mining.
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
              Avg Finality Speed
            </p>
            <p className="mono text-[22px] font-bold text-white mt-1">~3.5s</p>
            <p className="text-[11px] text-emerald-400 font-medium mt-0.5">Instant Settlement</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Avg Network Fee
            </p>
            <p className="mono text-[22px] font-bold text-[#30D158] mt-1">$0.000001</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">100 stroops (0.00001 XLM)</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Est. Gas Fees Saved
            </p>
            <p className="mono text-[22px] font-bold text-[#64D2FF] mt-1">
              ${totalTxCount > 0 ? ethSavingsUsd : "45.00+"}
            </p>
            <p className="text-[11px] text-neutral-400 mt-0.5">vs. Ethereum network</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Smart Contracts Engine
            </p>
            <p className="mono text-[22px] font-bold text-purple-300 mt-1">Soroban</p>
            <p className="text-[11px] text-purple-400 mt-0.5">Rust WASM Virtual Machine</p>
          </div>
        </div>

        {/* Ledger Base Reserve Breakdown */}
        <div className="panel-inset p-4 space-y-2 text-[12.5px]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Stellar Base Reserve Standards (SEP)
          </p>
          <div className="flex justify-between text-neutral-300">
            <span>Base Account Minimum</span>
            <span className="mono font-semibold text-white">1.0000 XLM</span>
          </div>
          <div className="flex justify-between text-neutral-300">
            <span>Trustline / Signer Reserve</span>
            <span className="mono font-semibold text-white">0.5000 XLM per entry</span>
          </div>
          <div className="flex items-center gap-1.5 pt-1 text-[11px] text-emerald-400">
            <IconCheck size={12} />
            <span>100% refundable upon trustline removal or account merge.</span>
          </div>
        </div>

        <Button variant="ghost" className="w-full mt-2" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
