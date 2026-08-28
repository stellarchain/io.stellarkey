"use client";

import type { ReactNode } from "react";
import type { AccountMeta, NetworkKey } from "@/lib/types";
import {
  IconCheck,
  IconKey,
  IconReceive,
  IconSend,
  IconShield,
  IconSwap,
  IconTrezor,
  IconUsers,
} from "./icons";
import { Button, CopyButton, HashValue, NetworkBadge } from "./ui";

/*
 * The first screen after unlocking a wallet that has no funds yet.
 *
 * Deliberately short on words: a new holder needs to know the wallet is
 * theirs, that it is empty, and what the one next step is. Everything else is
 * carried by layout rather than prose — the steps are a strip rather than
 * paragraphs, and the capabilities are labels rather than descriptions.
 */

type Step = { label: string; done: boolean };

function StepStrip({ steps }: { steps: Step[] }) {
  return (
    <ol
      className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-1.5"
      aria-label="Setup progress"
    >
      {steps.map((step, index) => (
        <li key={step.label} className="flex min-w-0 items-center gap-2 sm:flex-1">
          <span
            aria-hidden="true"
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
              step.done ? "bg-[#30D158] text-black" : "bg-white/[0.10] text-neutral-400"
            }`}
          >
            {step.done ? <IconCheck size={11} /> : index + 1}
          </span>
          <span
            className={`text-[12.5px] font-medium sm:truncate ${
              step.done ? "text-neutral-400" : "text-white"
            }`}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Tile({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <li className="panel-inset flex flex-col gap-2.5 px-4 py-4">
      <span aria-hidden="true" className="text-[#0A84FF]">{icon}</span>
      <span className="text-[13px] font-semibold leading-snug text-neutral-200">{label}</span>
    </li>
  );
}

export function WelcomeHome({
  account,
  network,
  reserveXlm,
  fundBusy,
  fundError,
  backedUp,
  onFund,
  onBackup,
  onReceive,
  children,
}: {
  account: AccountMeta | null;
  network: NetworkKey;
  /** The network's current minimum balance, when it is known. */
  reserveXlm: string | null;
  fundBusy: boolean;
  fundError: string | null;
  backedUp: boolean;
  onFund: () => void;
  onBackup: () => void;
  onReceive: () => void;
  /** The market card, passed in so this stays presentational. */
  children?: ReactNode;
}) {
  const testnet = network === "testnet";

  return (
    <div className="fade-up grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
      <section className="panel relative overflow-hidden px-6 py-8 sm:px-9 sm:py-10 lg:col-span-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-20 -top-24 h-72 w-[26rem] rounded-full bg-[#0A84FF]/20 blur-[80px]"
        />
        <div className="relative">
          <NetworkBadge network={network} />

          <h1 className="display-h mt-5 text-[34px] text-white sm:text-[42px]">
            Your wallet is ready.
          </h1>
          <p className="mt-3 text-[15px] text-neutral-400">
            {/* naming the reserve helps on mainnet, where the holder covers it
                themselves; on testnet Friendbot covers it and the number is noise */}
            {testnet
              ? "Claim some test lumens to bring it on-chain."
              : reserveXlm
                ? `Add ${reserveXlm} XLM to bring it on-chain.`
                : "Add XLM to bring it on-chain."}
          </p>

          <p className="display-h mt-8 text-[52px] text-white sm:text-[64px]">
            0<span className="text-neutral-700">.00</span>
            <span className="ml-2 text-[24px] font-semibold text-neutral-500">XLM</span>
          </p>

          {account && (
            <div className="panel-inset mt-5 flex items-center gap-2 px-3.5 py-2.5">
              <IconKey size={14} className="shrink-0 text-neutral-500" />
              <HashValue value={account.publicKey} head={8} tail={6} className="min-w-0 flex-1 text-[13px]" />
              {/* HashValue copies on click too; the chip is here for discoverability */}
              <CopyButton value={account.publicKey} label="Copy" />
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
            {testnet && (
              <Button
                className="!py-3.5 text-[15px] font-semibold sm:flex-1"
                loading={fundBusy}
                disabled={fundBusy}
                onClick={onFund}
              >
                Claim 10,000 test XLM
              </Button>
            )}
            <Button
              variant={testnet ? "secondary" : "primary"}
              className="!py-3.5 text-[15px] font-semibold sm:flex-1"
              onClick={onReceive}
            >
              <IconReceive size={16} /> Show address
            </Button>
          </div>
          {fundError && <p className="mt-4 text-[13px] text-[#FF453A]">{fundError}</p>}

          <StepStrip
            steps={[
              { label: "Wallet created", done: true },
              { label: "Back up phrase", done: backedUp },
              { label: "Add XLM", done: false },
            ]}
          />
        </div>
      </section>

      <div className="space-y-6 lg:col-span-5">
        {!backedUp && (
          <section className="panel flex flex-col gap-3 border border-[#FF9F0A]/25 px-5 py-4 sm:flex-row sm:items-center sm:gap-3.5">
            <span aria-hidden="true" className="shrink-0 text-[#FF9F0A]">
              <IconShield size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-white">Back up your recovery phrase</p>
              <p className="mt-0.5 text-[13px] text-neutral-400">The only way back in.</p>
            </div>
            <Button variant="secondary" className="w-full !py-2 text-[13px] sm:w-auto" onClick={onBackup}>
              Back up
            </Button>
          </section>
        )}

        <section className="panel px-5 py-5">
          <h2 className="section-title">Once funded</h2>
          <ul className="mt-3.5 grid grid-cols-2 gap-2.5">
            <Tile icon={<IconSend size={18} />} label="Send & receive" />
            <Tile icon={<IconSwap size={18} />} label="Swap on the DEX" />
            <Tile icon={<IconUsers size={18} />} label="Take payments" />
            <Tile icon={<IconTrezor size={18} />} label="Sign with Trezor" />
          </ul>
        </section>

        {children}
      </div>
    </div>
  );
}
