"use client";

import type { ReactNode } from "react";
import { useWallet } from "@/hooks/useWallet";
import { triggerHaptic } from "@/lib/haptics";
import type { NetworkKey } from "@/lib/stellar";
import { formatTrezorAddress } from "@/lib/address-display";
import { AccountMark } from "../AccountMark";
import {
  Button,
  Dropdown,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  SectionHeader,
} from "../ui";
import { IconCheck, IconChevronDown, IconKey, IconLedger, IconLock, IconPlus, IconTrezor } from "../icons";

export function ActionButton({
  icon,
  label,
  onClick,
  primary = false,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? "Watch-only accounts cannot sign transactions" : undefined}
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
      className="group flex w-full min-w-0 flex-col items-center gap-2 outline-none disabled:cursor-not-allowed"
    >
      <span
        className={`flex h-12 w-12 items-center justify-center rounded-full pointer-coarse:h-[clamp(48px,16vw,60px)] pointer-coarse:w-[clamp(48px,16vw,60px)] transition-[background-color,border-color,transform,filter] duration-[var(--motion-duration-emphasized)] ease-[cubic-bezier(0.34,1.4,0.64,1)] group-focus-visible:ring-2 group-focus-visible:ring-white/60 group-active:scale-[0.84] group-active:duration-[var(--motion-duration-fast)] ${
          primary
            ? "bg-gradient-to-b from-[#2f94ff] to-[#0a7aff] text-[var(--color-oncolor)] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_1px_rgba(0,0,0,0.15),0_10px_26px_-8px_rgba(10,132,255,0.6)] group-hover:brightness-110"
            : "border border-white/[0.1] bg-white/[0.07] text-neutral-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_10px_22px_-12px_var(--shadow-medium)] backdrop-blur-xl group-hover:border-white/[0.16] group-hover:bg-white/[0.12]"
        } ${disabled ? "opacity-30" : ""}`}
      >
        {icon}
      </span>
      <span
        className={`text-[12px] font-medium tracking-[-0.01em] transition-colors ${
          disabled ? "text-neutral-600" : "text-neutral-300 group-hover:text-white"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

export function NetworkModal({
  open,
  onClose,
  network,
  onSwitch,
}: {
  open: boolean;
  onClose: () => void;
  network: NetworkKey;
  onSwitch: (n: NetworkKey) => void;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader
        title="Switch Network"
        subtitle="Select active Stellar blockchain environment"
        onClose={onClose}
      />
      <ModalBody>
        {(
          [
            {
              id: "mainnet",
              title: "Stellar Mainnet",
              desc: "Live public ledger with real assets, DEX liquidity, and production settlement.",
              color: "#30D158",
            },
            {
              id: "testnet",
              title: "Stellar Testnet",
              desc: "Free testing environment funded with 10,000 test XLM via SDF Friendbot.",
              color: "#FF9F0A",
            },
          ] as const
        ).map((n) => {
          const isActive = network === n.id;
          return (
            <button
              key={n.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                if (!isActive) {
                  triggerHaptic("selection");
                  onSwitch(n.id);
                }
                onClose();
              }}
              className={`flex w-full items-start justify-between rounded-2xl border p-4 text-left transition-colors ${
                isActive
                  ? "border-[#0A84FF] bg-[#0A84FF]/10 text-white shadow-sm"
                  : "border-white/10 bg-white/[0.03] text-neutral-300 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              <div className="flex items-start gap-3 min-w-0 pr-2">
                <span
                  className="mt-1 h-3 w-3 rounded-full shrink-0 shadow-sm"
                  style={{ background: n.color }}
                />
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-white leading-tight">
                    {n.title}
                  </p>
                  <p className="text-[12px] leading-relaxed text-neutral-400 pt-1">
                    {n.desc}
                  </p>
                </div>
              </div>
              {isActive && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0A84FF] text-[var(--color-oncolor)] shrink-0">
                  <IconCheck size={11} />
                </span>
              )}
            </button>
          );
        })}
        <ModalFooter
          primary={
            <Button type="button" variant="ghost" onClick={onClose}>
              Done
            </Button>
          }
        />
      </ModalBody>
    </Modal>
  );
}

export function AccountMenu({
  onAddAccount,
  onManageAccounts,
  compact = false,
}: {
  onAddAccount: () => void;
  onManageAccounts: () => void;
  compact?: boolean;
}) {
  const { accounts, activeAccount, selectAccount, lock, network } = useWallet();
  if (!activeAccount) return null;
  return (
    <Dropdown
      align="left"
      className={compact ? "shrink-0" : "min-w-0 flex-1"}
      trigger={(_, triggerProps) =>
        compact ? (
          <button
            {...triggerProps}
            aria-label={`Open account menu for ${activeAccount.label}`}
            className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] transition-[background-color,border-color,transform] hover:bg-white/[0.08] hover:border-white/20 active:scale-95 shadow-sm"
            title={`${activeAccount.label} (${formatTrezorAddress(activeAccount.publicKey)})`}
          >
            <AccountMark publicKey={activeAccount.publicKey} size={28} />
            <span
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--color-panel)]"
              style={{ background: network === "mainnet" ? "#30d158" : "#ff9f0a" }}
            />
          </button>
        ) : (
          <button
            {...triggerProps}
            aria-label={`Open account menu for ${activeAccount.label}`}
            className="flex min-h-11 min-w-0 flex-1 w-full max-w-[240px] sm:max-w-[260px] items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] hover:bg-white/[0.12] active:scale-95 py-1 pl-1.5 pr-3 shadow-sm transition-[background-color,transform] cursor-pointer"
          >
            <AccountMark publicKey={activeAccount.publicKey} size={28} />
            <span className="text-left min-w-0 max-w-[110px]">
              <span className="block truncate text-[13.5px] font-semibold leading-tight text-white">
                {activeAccount.label}
              </span>
              <span className="mono block truncate text-[10.5px] text-neutral-400">
                {formatTrezorAddress(activeAccount.publicKey)}
              </span>
            </span>
            <IconChevronDown size={11} className="text-neutral-400 shrink-0 ml-0.5" />
          </button>
        )
      }
    >
      {(close) => (
        <div className="p-1 space-y-1">
          <SectionHeader className="px-3 pb-1 pt-2 text-[10.5px] font-bold">Switch Account</SectionHeader>
          {accounts.map((acct) => {
            const isActive = acct.id === activeAccount.id;
            return (
              <button
                key={acct.id}
                type="button"
                role="menuitem"
                className={`menu-item !rounded-xl !py-2 !px-3 ${
                  isActive ? "bg-white/[0.08] text-white font-semibold" : ""
                }`}
                onClick={() => {
                  triggerHaptic("selection");
                  selectAccount(acct.id);
                  close();
                }}
              >
                <AccountMark publicKey={acct.publicKey} size={24} />
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-[13px] font-semibold leading-tight flex items-center gap-1.5">
                    <span>{acct.label}</span>
                    {acct.hardware === "trezor" && (
                      <IconTrezor size={12} className="text-emerald-400 shrink-0" />
                    )}
                    {acct.hardware === "ledger" && (
                      <IconLedger size={12} className="text-[#64D2FF] shrink-0" />
                    )}
                  </p>
                  <p className="mono truncate text-[10.5px] text-neutral-400">
                    {formatTrezorAddress(acct.publicKey)}
                  </p>
                </div>
                {isActive && (
                  <IconCheck size={14} className="text-[#0A84FF] shrink-0 ml-1" />
                )}
              </button>
            );
          })}
          <div className="my-1 h-px bg-white/10" />
          <button
            type="button"
            role="menuitem"
            className="menu-item !rounded-xl !py-2 !px-3"
            onClick={() => {
              triggerHaptic("selection");
              onAddAccount();
              close();
            }}
          >
            <IconPlus size={14} /> <span>Add Account</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item !rounded-xl !py-2 !px-3"
            onClick={() => {
              onManageAccounts();
              close();
            }}
          >
            <IconKey size={14} /> <span>Manage Accounts</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item danger !rounded-xl !py-2 !px-3"
            onClick={() => {
              triggerHaptic("warning");
              lock();
              close();
            }}
          >
            <IconLock size={14} /> <span>Lock Wallet</span>
          </button>
        </div>
      )}
    </Dropdown>
  );
}
