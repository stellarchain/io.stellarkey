"use client";

import type { ReactNode } from "react";
import type { AccountMeta, NetworkKey } from "@/lib/types";
import {
  IconCheck,
  IconGear,
  IconKey,
  IconReceive,
  IconSend,
  IconShield,
  IconSwap,
  IconTrezor,
  IconUsers,
  IconWallet,
} from "./icons";
import { Button, CopyButton, HashValue, NetworkBadge } from "./ui";

/*
 * The first screen after unlocking a wallet that has no funds yet.
 *
 * It used to be one card on an empty canvas offering a single button, which
 * told a new holder nothing about the wallet they had just created and left
 * the most important job of the first five minutes — writing down the
 * recovery phrase — entirely unmentioned. This lays out the same activation
 * step as one of three, alongside the account's own identity, so the screen
 * answers "what is this, is it mine, and what do I do next".
 */

function Step({
  index,
  title,
  body,
  done,
  urgent,
  action,
}: {
  index: number;
  title: string;
  body: string;
  done?: boolean;
  urgent?: boolean;
  action?: ReactNode;
}) {
  return (
    <li className="flex gap-3.5 px-5 py-4">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
          done
            ? "bg-[#30D158]/15 text-[#30D158]"
            : urgent
              ? "bg-[#FF9F0A]/15 text-[#FF9F0A]"
              : "bg-white/[0.08] text-neutral-400"
        }`}
      >
        {done ? <IconCheck size={14} /> : index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className={`text-[14px] font-semibold ${done ? "text-neutral-400" : "text-white"}`}>
            {title}
          </p>
          {done && <span className="text-[11px] font-semibold text-[#30D158]">Done</span>}
          {urgent && !done && (
            <span className="rounded-full bg-[#FF9F0A]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#FF9F0A]">
              Do this first
            </span>
          )}
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-neutral-400">{body}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </li>
  );
}

function Capability({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <li className="flex gap-3 px-5 py-3.5">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-neutral-500">{icon}</span>
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-neutral-200">{title}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-neutral-500">{body}</p>
      </div>
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
      <div className="space-y-6 lg:col-span-7">
        <section className="panel relative px-6 py-7 sm:px-8 sm:py-8">
          {/* a quiet wash behind the identity, so the empty balance still reads
              as the centre of the screen rather than a blank card */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(10,132,255,0.16),transparent_70%)]"
          />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="gold-bubble h-9 w-9">
                <IconWallet size={18} />
              </span>
              <p className="text-[15px] font-bold text-white">{account?.label ?? "Your wallet"}</p>
              <NetworkBadge network={network} />
            </div>

            <p className="eyebrow mt-6">Balance</p>
            <p className="display-h mt-1 text-[44px] text-white sm:text-[56px]">
              0<span className="text-neutral-600">.00</span>{" "}
              <span className="text-[24px] font-semibold text-neutral-500 sm:text-[28px]">XLM</span>
            </p>
            <p className="mt-3 max-w-md text-[14px] leading-relaxed text-neutral-400">
              The keys exist on this device already. The account itself appears on the Stellar
              ledger once it holds the network minimum
              {reserveXlm ? <> of <span className="text-neutral-200">{reserveXlm} XLM</span></> : null}
              {testnet
                ? ", which Friendbot will cover for you on testnet."
                : ". Send XLM from another wallet or an exchange to the address below."}
            </p>

            {account && (
              <div className="panel-inset mt-5 flex items-center gap-2 px-3.5 py-2.5">
                <IconKey size={14} className="shrink-0 text-neutral-500" />
                <HashValue value={account.publicKey} head={10} tail={8} className="min-w-0 flex-1 text-[13px]" />
                {/* HashValue copies on click too; the chip is here for discoverability */}
                <CopyButton value={account.publicKey} label="Copy" />
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
              {testnet ? (
                <Button
                  className="!py-3.5 text-[15px] font-semibold sm:flex-1"
                  loading={fundBusy}
                  disabled={fundBusy}
                  onClick={onFund}
                >
                  Claim 10,000 test XLM
                </Button>
              ) : null}
              <Button
                variant={testnet ? "secondary" : "primary"}
                className="!py-3.5 text-[15px] font-semibold sm:flex-1"
                onClick={onReceive}
              >
                <IconReceive size={16} /> Show my address
              </Button>
            </div>
            {fundError && <p className="mt-4 text-[13px] text-[#FF453A]">{fundError}</p>}
          </div>
        </section>

        <section className="panel" aria-labelledby="welcome-steps">
          <div className="flex items-center justify-between px-5 pb-1 pt-5">
            <h2 id="welcome-steps" className="section-title">Three steps to your first payment</h2>
            <span className="text-[12px] font-semibold text-neutral-500">
              {backedUp ? 2 : 1} of 3
            </span>
          </div>
          <ul className="divide-y divide-white/[0.06]">
            <Step
              index={1}
              done
              title="Wallet created"
              body="Your key was generated here and encrypted with your password. It has never left this device."
            />
            <Step
              index={2}
              done={backedUp}
              urgent={!backedUp}
              title="Write down your recovery phrase"
              body={
                backedUp
                  ? "You have exported your recovery material. Keep it somewhere only you can reach."
                  : "This is the only way back in if you lose this device. Nobody can restore it for you — not us, not anyone."
              }
              action={
                <Button variant={backedUp ? "ghost" : "secondary"} className="!py-2 text-[13px]" onClick={onBackup}>
                  <IconShield size={14} /> {backedUp ? "View backup options" : "Back up now"}
                </Button>
              }
            />
            <Step
              index={3}
              title="Add XLM to activate"
              body={
                testnet
                  ? "Claim test lumens above. They have no real value and exist only on testnet."
                  : "Send XLM to the address above from another wallet or an exchange."
              }
            />
          </ul>
        </section>
      </div>

      <div className="space-y-6 lg:col-span-5">
        <section className="panel" aria-labelledby="welcome-capabilities">
          <h2 id="welcome-capabilities" className="section-title px-5 pb-1 pt-5">
            What this wallet does
          </h2>
          <ul className="divide-y divide-white/[0.06]">
            <Capability
              icon={<IconSend size={16} />}
              title="Send and receive"
              body="Any Stellar asset, with the whole transaction shown to you before it is signed."
            />
            <Capability
              icon={<IconSwap size={16} />}
              title="Swap on the DEX"
              body="Trade against Stellar's built-in order book without leaving the wallet."
            />
            <Capability
              icon={<IconUsers size={16} />}
              title="Take payments"
              body="Merchant mode turns this device into a counter with orders, staff and reports."
            />
            <Capability
              icon={<IconTrezor size={16} />}
              title="Sign with hardware"
              body="Pair a Trezor and the signing key never reaches the browser at all."
            />
          </ul>
          <p className="flex items-center gap-2 border-t border-white/[0.06] px-5 py-3.5 text-[12px] text-neutral-500">
            <IconGear size={13} className="shrink-0" />
            Everything above is available once the account is funded.
          </p>
        </section>

        {children}
      </div>
    </div>
  );
}
