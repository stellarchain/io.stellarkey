"use client";

import type { ReactNode } from "react";
import type { AccountMeta, NetworkKey } from "@/lib/types";
import { IconKey, IconShield } from "./icons";
import { Button, CopyButton, HashValue, NetworkBadge } from "./ui";

/*
 * The first screen after unlocking a wallet that holds nothing yet.
 *
 * Built to the first-use empty-state pattern rather than as a dashboard with
 * the data missing: a heading naming the outcome, one sentence on how to get
 * there, exactly one primary action, and a dimmed preview of the populated
 * screen underneath. The preview is the part that does the work — it shows
 * what this space becomes instead of leaving a void where the assets go, and
 * it is decorative, so it is hidden from assistive tech.
 */

/** A dimmed sketch of the assets list this screen turns into once funded. */
function AssetPreview() {
  return (
    <div aria-hidden="true" className="mt-7 select-none">
      <p className="section-title px-1 pb-2">Your assets</p>
      <div className="panel-inset divide-y divide-white/[0.05] opacity-45">
        <div className="flex items-center gap-3.5 px-4 py-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0A84FF]/25 text-[11px] font-bold text-[#7FBEFF]">
            XLM
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-neutral-300">Lumens</p>
            <p className="text-[12px] text-neutral-500">Stellar native asset</p>
          </div>
          <p className="text-[14px] font-semibold tabular-nums text-neutral-400">0.00</p>
        </div>
        {[0, 1].map((row) => (
          <div key={row} className="flex items-center gap-3.5 px-4 py-3.5">
            <span className="h-9 w-9 shrink-0 rounded-full bg-white/[0.06]" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <span className="block h-2.5 w-24 rounded-full bg-white/[0.06]" />
              <span className="block h-2 w-16 rounded-full bg-white/[0.04]" />
            </div>
            <span className="h-2.5 w-12 rounded-full bg-white/[0.06]" />
          </div>
        ))}
      </div>
    </div>
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
          className="pointer-events-none absolute -left-24 -top-28 h-72 w-[28rem] rounded-full bg-[#0A84FF]/20 blur-[90px]"
        />
        <div className="relative">
          <NetworkBadge network={network} />

          <h1 className="display-h mt-5 text-[32px] text-white sm:text-[40px]">
            Your lumens land here.
          </h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-neutral-400">
            {testnet
              ? "Claim some test lumens and the account goes live on Stellar."
              : reserveXlm
                ? `Send at least ${reserveXlm} XLM to the address below and the account goes live on Stellar.`
                : "Send XLM to the address below and the account goes live on Stellar."}
          </p>

          {/* One primary action. Showing the address is the quiet way through
              for anyone funding from elsewhere, so it stays a link. */}
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
            {testnet ? (
              <Button
                className="!px-6 !py-3.5 text-[15px] font-semibold"
                loading={fundBusy}
                disabled={fundBusy}
                onClick={onFund}
              >
                Claim 10,000 test XLM
              </Button>
            ) : (
              <Button className="!px-6 !py-3.5 text-[15px] font-semibold" onClick={onReceive}>
                Show my address
              </Button>
            )}
            {testnet && (
              <button
                type="button"
                onClick={onReceive}
                className="link text-[14px] font-medium"
              >
                or receive from elsewhere
              </button>
            )}
          </div>
          {fundError && <p className="mt-4 text-[13px] text-[#FF453A]">{fundError}</p>}

          {account && (
            <div className="panel-inset mt-6 flex items-center gap-2 px-3.5 py-2.5">
              <IconKey size={14} className="shrink-0 text-neutral-500" />
              <HashValue value={account.publicKey} head={8} tail={6} className="min-w-0 flex-1 text-[13px]" />
              {/* HashValue copies on click too; the chip is here for discoverability */}
              <CopyButton value={account.publicKey} label="Copy" />
            </div>
          )}

          <AssetPreview />
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

        {children}
      </div>
    </div>
  );
}
