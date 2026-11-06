"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useMerchantShell } from "@/hooks/useMerchantRuntime";
import { triggerHaptic } from "@/lib/haptics";
import { fmtAmount, fmtFiat } from "@/lib/format";
import { formatTrezorAddress } from "@/lib/address-display";
import {
  BRAND_NAME,
  COPYRIGHT_OWNER,
  COPYRIGHT_YEAR,
  decodeContactAddress,
} from "@/lib/brand";
import type { ShellMode } from "@/lib/shell-mode";
import { AccountMark } from "../AccountMark";
import { BuildIdentity } from "../BuildIdentity";
import { ModeSwitcher } from "../merchant/ModeSwitcher";
import { NetworkBadge, SectionHeader, Spinner, Tooltip } from "../ui";
import {
  IconBook,
  IconCalculator,
  IconEye,
  IconEyeOff,
  IconFileText,
  IconGear,
  IconHome,
  IconLedger,
  IconList,
  IconLock,
  IconMessageCircle,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSwap,
  IconTrezor,
  IconUsers,
  IconWallet,
  LogoMark,
} from "../icons";
import { IconBars, IconReceipt, IconReceiptStellar, IconStorefront, IconTag } from "../merchant/icons";
import type { View } from "./view-model";

export function DashboardSidebar({
  mode,
  view,
  merchantAttention,
  accountTotals,
  refresh,
  switchTab,
  onOpenSettings,
  onOpenPalette,
  onAddAccount,
  onOpenConverter,
  onOpenNetwork,
}: {
  mode: ShellMode;
  view: View;
  merchantAttention: number;
  accountTotals: Record<string, { xlm: string | null; usd: number | null }>;
  refresh: () => Promise<void>;
  switchTab: (v: View) => Promise<void>;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  onAddAccount: () => void;
  onOpenConverter: () => void;
  onOpenNetwork: () => void;
}) {
  const {
    accounts,
    activeAccount,
    selectAccount,
    contacts,
    activity,
    dataLoading,
    fiatCurrency,
    fiatRates,
    network,
    privacyMode,
    togglePrivacy,
    lock,
  } = useWallet();
  const { enabled: merchantEnabled } = useMerchantShell();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  /** Merchant selects the till, Wallet returns Home. */
  async function switchMode(next: ShellMode) {
    await switchTab(next === "merchant" ? "merchant" : "home");
  }

  return (
      <aside
        className={`app-safe-sticky-top hidden md:flex flex-col shrink-0 border-r border-white/10 bg-white/[0.02] backdrop-blur-3xl sticky h-screen transition-[width] duration-[var(--motion-duration-emphasized)] ease-[cubic-bezier(0.32,0.72,0,1)] ${
          sidebarCollapsed ? "w-[72px]" : "w-[260px] lg:w-[280px]"
        }`}
      >
        {/* App Title & Header Controls — Exact 64px height to match Main Header */}
        <div
          className={`flex h-[64px] shrink-0 items-center border-b border-white/[0.08] w-full ${
            sidebarCollapsed ? "justify-center px-2" : "justify-between px-5"
          }`}
        >
          {sidebarCollapsed ? (
            <Tooltip label="Expand Sidebar" side="right">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection");
                  setSidebarCollapsed(false);
                }}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--color-oncolor)] transition-colors hover:bg-white/[0.08]"
                aria-label="Expand Sidebar"
              >
                <LogoMark size={30} className="text-white" />
              </button>
            </Tooltip>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-1.5">
                <LogoMark size={30} className="text-white" />
                <div className="min-w-0">
                  <h1 className="truncate text-[15.5px] font-bold tracking-tight text-white leading-tight">
                    {BRAND_NAME}
                  </h1>
                  <p className="truncate text-[10.5px] text-neutral-400 font-medium">
                    Self-Custody Wallet
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection");
                  setSidebarCollapsed(true);
                }}
                className="icon-btn !h-8 !w-8 text-neutral-400 hover:text-white shrink-0"
                title="Collapse Sidebar"
                aria-label="Collapse Sidebar"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M9 3v18" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Navigation & Accounts Scroll Body */}
        <div className={`flex-1 overflow-y-auto scrollbar-none ${sidebarCollapsed ? "p-2.5 space-y-2" : "p-4 space-y-1"}`}>
          <nav className="space-y-1 w-full" aria-label="Desktop Navigation">
            {/*
              Mode is a higher-level choice than search, and search is scoped to
              the mode you are in — so the switcher sits directly under the app
              header and above the palette button, and the sidebar shows one
              mode's navigation at a time instead of two stacked lists.
            */}
            {merchantEnabled &&
              (sidebarCollapsed ? (
                <Tooltip
                  label={mode === "merchant" ? "Switch to Wallet" : "Switch to Merchant"}
                  side="right"
                >
                  <button
                    type="button"
                    onClick={() => switchMode(mode === "merchant" ? "wallet" : "merchant")}
                    className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-neutral-300 transition-colors hover:bg-white/[0.08] hover:text-[var(--color-oncolor)]"
                    aria-label={mode === "merchant" ? "Switch to Wallet" : "Switch to Merchant"}
                  >
                    {mode === "merchant" ? (
                      <IconReceiptStellar size={18} className="text-[#30D158]" />
                    ) : (
                      <IconWallet size={18} />
                    )}
                  </button>
                </Tooltip>
              ) : (
                <div className="mb-2">
                  <ModeSwitcher mode={mode} onChange={switchMode} />
                </div>
              ))}

            {!sidebarCollapsed && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection");
                  onOpenPalette();
                }}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] font-medium text-neutral-400 bg-white/[0.04] hover:bg-white/[0.08] hover:text-white transition-colors mb-2 border border-white/5"
              >
                <div className="flex items-center gap-2">
                  <IconSearch size={15} />
                  <span>Search actions…</span>
                </div>
                <kbd className="mono rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-neutral-400 font-semibold">
                  ⌘K
                </kbd>
              </button>
            )}

            {mode === "merchant" ? (
              <>
                <Tooltip label={sidebarCollapsed ? "Point of Sale (⌘6)" : null} side="right">
                  <button
                    type="button"
                    aria-label={sidebarCollapsed ? "Point of Sale (⌘6)" : undefined}
                    onClick={() => switchTab("merchant")}
                    className={`group relative flex w-full items-center rounded-xl transition-colors ${
                      sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3 py-2"
                    } text-[13.5px] font-semibold ${
                      view === "merchant"
                        ? "bg-[#0A84FF] text-[var(--color-oncolor)] shadow-sm"
                        : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <IconStorefront size={18} />
                    {!sidebarCollapsed && <span>Point of Sale</span>}
                  </button>
                </Tooltip>

                <Tooltip
                  label={sidebarCollapsed
                    ? merchantAttention > 0
                      ? `Orders (${merchantAttention} need attention)`
                      : "Orders"
                    : null}
                  side="right"
                >
                  <button
                    type="button"
                    aria-label={sidebarCollapsed
                      ? merchantAttention > 0
                        ? `Orders (${merchantAttention} need attention)`
                        : "Orders"
                      : undefined}
                    onClick={() => switchTab("orders")}
                    className={`group relative flex w-full items-center rounded-xl transition-colors ${
                      sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "justify-between px-3 py-2"
                    } text-[13.5px] font-semibold ${
                      view === "orders"
                        ? "bg-[#0A84FF] text-[var(--color-oncolor)] shadow-sm"
                        : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                  <div className="flex items-center gap-2.5">
                    <IconReceipt size={18} />
                    {!sidebarCollapsed && <span>Orders</span>}
                  </div>
                  {merchantAttention > 0 &&
                    (sidebarCollapsed ? (
                      <span
                        aria-hidden
                        className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#FF9F0A]"
                      />
                    ) : (
                      <span
                        className={`mono rounded-full px-1.5 py-[1px] text-[10.5px] font-semibold ${
                          view === "orders"
                            ? "bg-white/25 text-white"
                            : "bg-[#FF9F0A]/20 text-[#FF9F0A]"
                        }`}
                      >
                        {merchantAttention}
                      </span>
                    ))}
                  </button>
                </Tooltip>

                <Tooltip label={sidebarCollapsed ? "Catalogue" : null} side="right">
                  <button
                    type="button"
                    aria-label={sidebarCollapsed ? "Catalogue" : undefined}
                    onClick={() => switchTab("catalogue")}
                    className={`group relative flex w-full items-center rounded-xl transition-colors ${
                      sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3 py-2"
                    } text-[13.5px] font-semibold ${
                      view === "catalogue"
                        ? "bg-[#0A84FF] text-[var(--color-oncolor)] shadow-sm"
                        : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <IconTag size={18} />
                    {!sidebarCollapsed && <span>Catalogue</span>}
                  </button>
                </Tooltip>

                {/* Counter codes is the other half of Invoices, so it lights this row. */}
                <Tooltip label={sidebarCollapsed ? "Invoices" : null} side="right">
                  <button
                    type="button"
                    aria-label={sidebarCollapsed ? "Invoices" : undefined}
                    onClick={() => switchTab("invoices")}
                    className={`group relative flex w-full items-center rounded-xl transition-colors ${
                      sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3 py-2"
                    } text-[13.5px] font-semibold ${
                      view === "invoices" || view === "links"
                        ? "bg-[#0A84FF] text-[var(--color-oncolor)] shadow-sm"
                        : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <IconFileText size={18} />
                    {!sidebarCollapsed && <span>Invoices</span>}
                  </button>
                </Tooltip>

                <Tooltip label={sidebarCollapsed ? "Customers" : null} side="right">
                  <button
                    type="button"
                    aria-label={sidebarCollapsed ? "Customers" : undefined}
                    onClick={() => switchTab("customers")}
                    className={`group relative flex w-full items-center rounded-xl transition-colors ${
                      sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3 py-2"
                    } text-[13.5px] font-semibold ${
                      view === "customers"
                        ? "bg-[#0A84FF] text-[var(--color-oncolor)] shadow-sm"
                        : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <IconUsers size={18} />
                    {!sidebarCollapsed && <span>Customers</span>}
                  </button>
                </Tooltip>

                <Tooltip label={sidebarCollapsed ? "Insights" : null} side="right">
                  <button
                    type="button"
                    aria-label={sidebarCollapsed ? "Insights" : undefined}
                    onClick={() => switchTab("insights")}
                    className={`group relative flex w-full items-center rounded-xl transition-colors ${
                      sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3 py-2"
                    } text-[13.5px] font-semibold ${
                      view === "insights"
                        ? "bg-[#0A84FF] text-[var(--color-oncolor)] shadow-sm"
                        : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <IconBars size={18} />
                    {!sidebarCollapsed && <span>Insights</span>}
                  </button>
                </Tooltip>

              </>
            ) : (
              <>
            <Tooltip label={sidebarCollapsed ? "Home (⌘1)" : null} side="right">
              <button
                type="button"
                aria-label={sidebarCollapsed ? "Home (⌘1)" : undefined}
                onClick={() => switchTab("home")}
                className={`group relative flex w-full items-center rounded-xl transition-colors ${
                  sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "justify-between px-3 py-2"
                } text-[13.5px] font-semibold ${
                  view === "home"
                    ? "bg-[#0A84FF] text-[var(--color-oncolor)] shadow-sm"
                    : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <IconHome size={18} />
                  {!sidebarCollapsed && <span>Home</span>}
                </div>
              </button>
            </Tooltip>

            <Tooltip label={sidebarCollapsed ? "Activity (⌘2)" : null} side="right">
              <button
                type="button"
                aria-label={sidebarCollapsed ? "Activity (⌘2)" : undefined}
                onClick={() => switchTab("activity")}
                className={`group relative flex w-full items-center rounded-xl transition-colors ${
                  sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "justify-between px-3 py-2"
                } text-[13.5px] font-semibold ${
                  view === "activity"
                    ? "bg-[#0A84FF] text-[var(--color-oncolor)] shadow-sm"
                    : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <IconList size={18} />
                  {!sidebarCollapsed && <span>Activity</span>}
                </div>
                {!sidebarCollapsed && activity.length > 0 && (
                  <span className="mono text-[11px] font-normal opacity-80">{activity.length}</span>
                )}
              </button>
            </Tooltip>

            <Tooltip label={sidebarCollapsed ? "DEX Swap (⌘3)" : null} side="right">
              <button
                type="button"
                aria-label={sidebarCollapsed ? "DEX Swap (⌘3)" : undefined}
                onClick={() => switchTab("swap")}
                className={`group relative flex w-full items-center rounded-xl transition-colors ${
                  sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3 py-2"
                } text-[13.5px] font-semibold ${
                  view === "swap"
                    ? "bg-[#0A84FF] text-[var(--color-oncolor)] shadow-sm"
                    : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <IconSwap size={18} />
                {!sidebarCollapsed && <span>DEX Swap</span>}
              </button>
            </Tooltip>

            <Tooltip label={sidebarCollapsed ? "Contacts (⌘4)" : null} side="right">
              <button
                type="button"
                aria-label={sidebarCollapsed ? "Contacts (⌘4)" : undefined}
                onClick={() => switchTab("contacts")}
                className={`group relative flex w-full items-center rounded-xl transition-colors ${
                  sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "justify-between px-3 py-2"
                } text-[13.5px] font-semibold ${
                  view === "contacts"
                    ? "bg-[#0A84FF] text-[var(--color-oncolor)] shadow-sm"
                    : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <IconBook size={18} />
                  {!sidebarCollapsed && <span>Contacts</span>}
                </div>
                {!sidebarCollapsed && contacts.length > 0 && (
                  <span className="mono text-[11px] font-normal opacity-80">{contacts.length}</span>
                )}
              </button>
            </Tooltip>
              </>
            )}

            <Tooltip
              label={sidebarCollapsed
                ? mode === "merchant"
                  ? "Merchant settings"
                  : "Settings (⌘5)"
                : null}
              side="right"
            >
              <button
                type="button"
                aria-label={sidebarCollapsed
                  ? mode === "merchant"
                    ? "Merchant settings"
                    : "Settings (⌘5)"
                  : undefined}
                onClick={onOpenSettings}
                className={`group relative flex w-full items-center rounded-xl transition-colors ${
                  sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3 py-2"
                } text-[13.5px] font-semibold ${
                  view === "settings"
                    ? "bg-[#0A84FF] text-[var(--color-oncolor)] shadow-sm"
                    : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <IconGear size={18} />
                {!sidebarCollapsed && <span>Settings</span>}
              </button>
            </Tooltip>

            {/* Accounts Subgroup (Zero Outer Borders) */}
            {!sidebarCollapsed ? (
              <div className="pt-3 space-y-1">
                <div className="flex items-center justify-between px-2 pb-0.5">
                  <SectionHeader as="span">Accounts ({accounts.length})</SectionHeader>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => onAddAccount()}
                      className="text-[11.5px] font-semibold text-[#0A84FF] hover:underline"
                    >
                      + Add
                    </button>
                  </div>
                </div>

                <div className="space-y-0.5">
                  {accounts.map((acct) => {
                    const isActive = acct.id === activeAccount?.id;
                    const accountXlm = accountTotals[acct.publicKey]?.xlm ?? null;
                    const accountUsd = accountTotals[acct.publicKey]?.usd ?? null;
                    return (
                      <button
                        key={acct.id}
                        type="button"
                        onClick={() => {
                          triggerHaptic("selection");
                          selectAccount(acct.id);
                        }}
                        className={`flex w-full items-center rounded-xl px-2.5 py-2 text-left transition-colors ${
                          isActive
                            ? "bg-white/[0.09] text-white font-medium shadow-sm"
                            : "text-neutral-300 hover:bg-white/[0.04] hover:text-white"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <AccountMark publicKey={acct.publicKey} size={24} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] leading-tight font-medium text-white flex items-center gap-1.5">
                              <span>{acct.label}</span>
                              {acct.hardware === "trezor" && (
                                <IconTrezor size={12} className="text-emerald-400 shrink-0" />
                              )}
                              {acct.hardware === "ledger" && (
                                <IconLedger size={12} className="text-[#64D2FF] shrink-0" />
                              )}
                            </p>
                            <p className="mono truncate text-[10.5px] text-neutral-400 pt-0.5">
                              {privacyMode
                                ? "••••••"
                                : `${accountXlm === null ? "—" : fmtAmount(accountXlm)} XLM`}
                            </p>
                          </div>
                        </div>
                        {!privacyMode ? (
                          <span
                            className="mono shrink-0 pl-2 text-[11.5px] font-semibold text-neutral-300"
                            title={accountUsd === null ? "Account value unavailable" : network === "testnet" ? "Testnet reference value — not real money; public + saved private balances" : "Public + saved private balances"}
                          >
                            {accountUsd === null ? "—" : fmtFiat(accountUsd, fiatCurrency, fiatRates)}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 pt-2">
                {accounts.map((acct) => {
                  const isActive = acct.id === activeAccount?.id;
                  return (
                    <Tooltip
                      key={acct.id}
                      label={`${acct.label} · ${formatTrezorAddress(acct.publicKey)}`}
                      side="right"
                    >
                      <button
                        type="button"
                        aria-label={`${acct.label} · ${formatTrezorAddress(acct.publicKey)}`}
                        onClick={() => {
                          triggerHaptic("selection");
                          selectAccount(acct.id);
                        }}
                        className={`relative flex h-10 w-10 items-center justify-center rounded-2xl transition-colors ${
                          isActive
                            ? "ring-2 ring-[#0A84FF] bg-white/[0.12] scale-105 shadow-sm shadow-blue-500/25"
                            : "opacity-60 hover:opacity-100 hover:bg-white/[0.06]"
                        }`}
                      >
                        <AccountMark publicKey={acct.publicKey} size={28} />
                      </button>
                    </Tooltip>
                  );
                })}
                <Tooltip label="Add Account" side="right">
                  <button
                    type="button"
                    aria-label="Add Account"
                    onClick={() => onAddAccount()}
                    className="flex h-9 w-9 items-center justify-center rounded-2xl border border-dashed border-white/20 text-neutral-400 hover:text-[var(--color-oncolor)] hover:bg-white/[0.06] transition-colors mt-1"
                  >
                    <IconPlus size={14} />
                  </button>
                </Tooltip>
              </div>
            )}
          </nav>
        </div>

        {/* Footer Controls */}
        <div className={`border-t border-white/[0.08] shrink-0 w-full ${sidebarCollapsed ? "p-2.5" : "p-4 space-y-2"}`}>
          {!sidebarCollapsed ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-y-2">
                <div className="flex items-center gap-1">
                  <Tooltip label={privacyMode ? "Show balances" : "Hide balances"}>
                    <button
                      type="button"
                      className="icon-btn !h-8 !w-8"
                      aria-label={privacyMode ? "Show balances" : "Hide balances"}
                      onClick={() => {
                        triggerHaptic("selection");
                        togglePrivacy();
                      }}
                    >
                      {privacyMode ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                    </button>
                  </Tooltip>
                  <Tooltip label="Refresh network data">
                    <button
                      type="button"
                      className="icon-btn !h-8 !w-8"
                      aria-label="Refresh network data"
                      onClick={() => {
                        triggerHaptic("light");
                        void refresh();
                      }}
                      disabled={dataLoading}
                    >
                      {dataLoading ? <Spinner /> : <IconRefresh size={15} />}
                    </button>
                  </Tooltip>
                  <Tooltip label="Calculator">
                    <button
                      type="button"
                      className="icon-btn !h-8 !w-8"
                      aria-label="Calculator"
                      onClick={() => {
                        triggerHaptic("selection");
                        onOpenConverter();
                      }}
                    >
                      <IconCalculator size={15} />
                    </button>
                  </Tooltip>
                  <Tooltip label="Send feedback">
                    <button
                      type="button"
                      className="icon-btn !h-8 !w-8"
                      aria-label="Send feedback"
                      onClick={() => {
                        triggerHaptic("selection");
                        const subject = encodeURIComponent("StellarKey feedback");
                        window.location.href = `mailto:${decodeContactAddress("support")}?subject=${subject}`;
                      }}
                    >
                      <IconMessageCircle size={15} />
                    </button>
                  </Tooltip>
                </div>
                <Tooltip label="Switch network">
                  <button
                    type="button"
                    aria-label="Switch network"
                    onClick={() => {
                      triggerHaptic("selection");
                      onOpenNetwork();
                    }}
                    className="cursor-pointer transition-transform active:scale-95"
                  >
                    <NetworkBadge network={network} />
                  </button>
                </Tooltip>
              </div>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic("warning");
                  lock();
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/[0.04] py-2 text-[12px] font-semibold text-neutral-400 hover:bg-white/[0.08] hover:text-[#FF453A] transition-colors"
              >
                <IconLock size={13} />
                <span>Lock Wallet</span>
              </button>
              <div
                aria-label="Build information"
                className="pt-1 text-center text-[10px] text-neutral-400"
              >
                <p className="whitespace-nowrap">
                  © {COPYRIGHT_YEAR} {COPYRIGHT_OWNER}
                  <span aria-hidden="true"> · </span>
                  <BuildIdentity className="transition-colors hover:text-neutral-200" />
                </p>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Tooltip label={privacyMode ? "Show balances" : "Hide balances"} side="right">
                <button
                  type="button"
                  className="icon-btn !h-9 !w-9"
                  aria-label={privacyMode ? "Show balances" : "Hide balances"}
                  onClick={() => {
                    triggerHaptic("selection");
                    togglePrivacy();
                  }}
                >
                  {privacyMode ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              </Tooltip>
              <Tooltip label={`Network: ${network}`} side="right">
                <button
                  type="button"
                  className="icon-btn !h-9 !w-9"
                  aria-label={`Network: ${network}`}
                  onClick={() => {
                    triggerHaptic("selection");
                    onOpenNetwork();
                  }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: network === "mainnet" ? "#30d158" : "#ff9f0a" }}
                  />
                </button>
              </Tooltip>
              <Tooltip label="Lock Wallet" side="right">
                <button
                  type="button"
                  className="icon-btn !h-9 !w-9 hover:!text-[#FF453A]"
                  aria-label="Lock Wallet"
                  onClick={() => {
                    triggerHaptic("warning");
                    lock();
                  }}
                >
                  <IconLock size={16} />
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      </aside>
  );
}
