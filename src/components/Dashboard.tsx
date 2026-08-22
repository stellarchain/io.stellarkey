"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { NETWORKS } from "@/lib/stellar";
import { lookupKnownAsset } from "@/lib/assets";
import { parseSep7PayUri, type PayUriPayload } from "@/lib/payuri";
import { fmtAmount, fmtFiat, fmtUsd, generateActivityCsv, shortenAddr, timeAgo } from "@/lib/format";
import type { ActivityItem, AssetBalance } from "@/lib/types";
import type { PriceRange as PriceRangeT } from "@/lib/api";
import { triggerHaptic } from "@/lib/haptics";
import { PriceChart } from "./PriceChart";
import { Sparkline } from "./Sparkline";
import type { NetworkKey } from "@/lib/stellar";
import type { SettingsSub } from "./SettingsPage";
import { SettingsPage } from "./SettingsPage";
import { Avatar, Button, CopyButton, Dropdown, NetworkBadge, Spinner } from "./ui";
import { AddAssetModal } from "./AddAssetModal";
import { AssetDetailModal } from "./AssetDetailModal";
import { BatchSendModal } from "./BatchSendModal";
import { CommandPalette } from "./CommandPalette";
import { ReceiveModal } from "./ReceiveModal";
import { SendModal } from "./SendModal";
import { SwapPage } from "./SwapPage";
import { TxDetailModal } from "./TxDetailModal";
import {
  IconArrowDownLeft,
  IconArrowUpRight,
  IconCheck,
  IconChevronDown,
  IconClose,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconGear,
  IconHome,
  IconKey,
  IconList,
  IconLock,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconShield,
  IconSwap,
  IconWallet,
  LogoMark,
} from "./icons";

type View = "home" | "activity" | "swap" | "settings";
type ActivityFilter = "all" | "in" | "out" | "swap" | "trust";

export function Dashboard() {
  const {
    network,
    switchNetwork,
    accounts,
    activeAccount,
    selectAccount,
    contacts,
    balances,
    claimableBalances,
    claimAirdrop,
    activity,
    activityCursor,
    dataLoading,
    loadingMore,
    xlmPriceUsd,
    unfunded,
    privacyMode,
    togglePrivacy,
    fiatCurrency,
    cycleFiatCurrency,
    refresh,
    loadMoreActivity,
    lock,
    fundFromFriendbot,
  } = useWallet();

  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [counterpartyFilter, setCounterpartyFilter] = useState<string | null>(null);
  const [hideDust, setHideDust] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [batchSendOpen, setBatchSendOpen] = useState(false);
  const [sendPrefill, setSendPrefill] = useState<PayUriPayload | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [addAssetOpen, setAddAssetOpen] = useState(false);
  const [settingsSub, setSettingsSub] = useState<SettingsSub>("root");
  const [settingsKey, setSettingsKey] = useState(0);
  const [detailAsset, setDetailAsset] = useState<AssetBalance | null>(null);
  const [txDetail, setTxDetail] = useState<ActivityItem | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [fundBusy, setFundBusy] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const [appHidden, setAppHidden] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      const uri = new URLSearchParams(window.location.search).get("uri");
      if (!uri) return;
      const parsed = parseSep7PayUri(uri);
      if (parsed) {
        setSendPrefill(parsed);
        setSendOpen(true);
        window.history.replaceState(null, "", window.location.pathname);
      }
    })();
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onVisChange = () => {
      setAppHidden(document.visibilityState === "hidden");
    };
    document.addEventListener("visibilitychange", onVisChange);
    return () => document.removeEventListener("visibilitychange", onVisChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        const index = parseInt(e.key, 10) - 1;
        if (accounts[index]) {
          e.preventDefault();
          selectAccount(accounts[index].id);
          triggerHaptic("selection");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [accounts, selectAccount]);

  const xlm = useMemo(() => balances?.find((b) => b.isNative) ?? null, [balances]);
  const usdValue =
    network === "mainnet" && xlmPriceUsd !== null
      ? parseFloat(xlm?.balance ?? "0") * xlmPriceUsd
      : null;

  const q = query.trim().toLowerCase();
  const filteredAssets = useMemo(() => {
    let list = balances ?? [];
    if (hideDust) {
      list = list.filter((b) => b.isNative || parseFloat(b.balance) > 0.0001);
    }
    if (!q) return list;
    return list.filter(
      (b) =>
        b.code.toLowerCase().includes(q) ||
        (b.issuer ?? "").toLowerCase().includes(q) ||
        (lookupKnownAsset(b.code)?.name ?? "").toLowerCase().includes(q),
    );
  }, [balances, hideDust, q]);

  const filteredActivity = useMemo(() => {
    return activity.filter((a) => {
      if (counterpartyFilter && a.counterparty !== counterpartyFilter) return false;
      if (activityFilter === "in" && a.direction !== "in") return false;
      if (activityFilter === "out" && a.direction !== "out") return false;
      if (activityFilter === "swap" && a.direction !== "neutral") return false;
      if (activityFilter === "trust" && a.type !== "change_trust") return false;

      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        (a.assetCode ?? "").toLowerCase().includes(q) ||
        (a.counterparty ?? "").toLowerCase().includes(q) ||
        a.hash.toLowerCase().includes(q)
      );
    });
  }, [activity, activityFilter, counterpartyFilter, q]);

  // Group activity deterministically by date label
  const groupedActivity = useMemo(() => {
    const map = new Map<string, ActivityItem[]>();
    for (const item of filteredActivity) {
      const d = new Date(item.createdAt);
      const key = Number.isNaN(d.getTime())
        ? "Activity"
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const existing = map.get(key);
      if (existing) {
        existing.push(item);
      } else {
        map.set(key, [item]);
      }
    }
    return Array.from(map.entries()).map(([title, items]) => ({ title, items }));
  }, [filteredActivity]);

  // Allocation distribution calculation
  const allocationShares = useMemo(() => {
    if (!balances || balances.length === 0) return [];
    const total = balances.reduce((acc, b) => acc + Math.max(0, parseFloat(b.balance)), 0);
    if (total <= 0) return [];
    return balances.map((b) => {
      const known = lookupKnownAsset(b.code);
      const val = Math.max(0, parseFloat(b.balance));
      const pct = (val / total) * 100;
      return {
        code: b.code,
        pct,
        color: known?.color ?? (b.isNative ? "#0A84FF" : `hsl(${assetHue(b.key)}, 70%, 50%)`),
      };
    });
  }, [balances]);

  async function handleFund() {
    if (!activeAccount) return;
    setFundBusy(true);
    setFundError(null);
    try {
      await fundFromFriendbot();
      triggerHaptic("success");
    } catch (e) {
      triggerHaptic("error");
      setFundError(e instanceof Error ? e.message : "Funding failed.");
    } finally {
      setFundBusy(false);
    }
  }

  async function handleClaimAllAirdrops() {
    if (claimableBalances.length === 0) return;
    setClaimingAll(true);
    triggerHaptic("selection");
    try {
      for (const item of claimableBalances) {
        await claimAirdrop(item.id);
      }
      triggerHaptic("success");
    } catch {
      triggerHaptic("error");
    } finally {
      setClaimingAll(false);
    }
  }

  function handleExportCsv() {
    if (filteredActivity.length === 0) return;
    triggerHaptic("selection");
    const csv = generateActivityCsv(filteredActivity, network);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wallet-activity-${network}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    triggerHaptic("success");
  }

  function openSettings(sub: SettingsSub) {
    triggerHaptic("selection");
    setSettingsSub(sub);
    setSettingsKey((k) => k + 1);
    setView("settings");
    window.scrollTo({ top: 0 });
  }

  function switchTab(v: View) {
    triggerHaptic("selection");
    setView(v);
    window.scrollTo({ top: 0 });
  }

  const paletteActions = useMemo(
    () => [
      {
        id: "send",
        label: "Send payment",
        run: () => {
          setSendPrefill(null);
          setSendOpen(true);
        },
      },
      {
        id: "batch-send",
        label: "Batch payment disperse (Multi-Send)",
        run: () => setBatchSendOpen(true),
      },
      { id: "receive", label: "Receive funds", run: () => setReceiveOpen(true) },
      { id: "swap", label: "Swap assets", run: () => switchTab("swap") },
      { id: "add-asset", label: "Add asset trustline", run: () => setAddAssetOpen(true) },
      {
        id: "copy",
        label: "Copy your address",
        hint: shortenAddr(activeAccount?.publicKey ?? "", 6, 6),
        run: () => {
          if (activeAccount) void navigator.clipboard.writeText(activeAccount.publicKey);
        },
      },
      ...accounts.map((acc) => ({
        id: `acc-${acc.id}`,
        label: `Switch account: ${acc.label}`,
        hint: shortenAddr(acc.publicKey, 4, 4),
        run: () => selectAccount(acc.id),
      })),
      ...contacts.map((c) => ({
        id: `contact-${c.address}`,
        label: `Send to contact: ${c.name}`,
        hint: shortenAddr(c.address, 4, 4),
        run: () => {
          setSendPrefill({ destination: c.address });
          setSendOpen(true);
        },
      })),
      {
        id: "privacy",
        label: privacyMode ? "Show balances" : "Hide balances",
        run: togglePrivacy,
      },
      {
        id: "currency",
        label: `Cycle currency (${fiatCurrency})`,
        run: cycleFiatCurrency,
      },
      {
        id: "net",
        label: network === "testnet" ? "Switch to Mainnet" : "Switch to Testnet",
        run: () => switchNetwork(network === "testnet" ? "mainnet" : "testnet"),
      },
      {
        id: "secret",
        label: "Reveal secret key",
        run: () => openSettings("reveal"),
      },
      { id: "phrase", label: "View recovery phrase", run: () => openSettings("phrase") },
      { id: "accounts", label: "Manage accounts", run: () => openSettings("accounts") },
      { id: "contacts", label: "Manage contacts", run: () => openSettings("contacts") },
      { id: "lock", label: "Lock wallet", run: lock },
    ],
    [
      accounts,
      contacts,
      activeAccount,
      privacyMode,
      network,
      fiatCurrency,
      cycleFiatCurrency,
      togglePrivacy,
      switchNetwork,
      selectAccount,
      lock,
    ],
  );

  return (
    <div className="relative z-10 min-h-screen md:flex md:h-screen md:overflow-hidden">
      {/* Privacy Shield */}
      {appHidden && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-2xl transition-opacity">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/10 text-white shadow-2xl">
              <IconShield size={32} />
            </span>
            <p className="text-[17px] font-bold text-white tracking-tight">Wallet Privacy Shield</p>
            <p className="text-[13px] text-neutral-400">Balances hidden while multitasking</p>
          </div>
        </div>
      )}

                              {/* Trezor-Style iPadOS / macOS Desktop Sidebar (Hidden on Mobile) */}
      <aside
        className={`hidden md:flex flex-col shrink-0 min-h-screen border-r border-white/10 bg-white/[0.02] backdrop-blur-3xl sticky top-0 h-screen overflow-y-auto transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          sidebarCollapsed ? "w-[76px] p-3 items-center" : "w-[260px] lg:w-[280px] p-5"
        }`}
      >
        {/* App Title & Header Controls */}
        <div className={`flex items-center pb-4 border-b border-white/[0.08] w-full ${sidebarCollapsed ? "flex-col gap-2.5 items-center" : "justify-between"}`}>
          <div className={`flex items-center gap-3 ${sidebarCollapsed ? "flex-col items-center" : ""}`}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/[0.08] shadow-md border border-white/10">
              <LogoMark size={22} className="text-white" />
            </div>
            {!sidebarCollapsed && (
              <div>
                <h1 className="text-[17px] font-bold tracking-tight text-white leading-tight">Wallet</h1>
                <p className="text-[11px] text-neutral-400 font-medium">Stellar Self-Custody</p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection");
              setSidebarCollapsed((c) => !c);
            }}
            className="icon-btn !h-8 !w-8 text-neutral-400 hover:text-white"
            title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            aria-label={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
        </div>

        {/* Sidebar Nav Links */}
        <nav className="mt-4 space-y-1.5 w-full" aria-label="Desktop Primary Navigation">
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection");
                setPaletteOpen(true);
              }}
              className="flex w-full items-center justify-between rounded-xl px-3.5 py-2 text-left text-[13px] font-medium text-neutral-400 bg-white/[0.04] hover:bg-white/[0.08] hover:text-white transition-all mb-3 border border-white/5"
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

          <button
            type="button"
            onClick={() => switchTab("home")}
            className={`group relative flex w-full items-center rounded-2xl transition-all ${
              sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "justify-between px-3.5 py-2.5"
            } text-[14px] font-semibold ${
              view === "home"
                ? "bg-[#0A84FF] text-white shadow-md shadow-blue-500/20"
                : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
            }`}
            title={sidebarCollapsed ? "Home (⌘1)" : undefined}
          >
            <div className="flex items-center gap-2.5">
              <IconHome size={18} />
              {!sidebarCollapsed && <span>Home</span>}
            </div>
          </button>

          <button
            type="button"
            onClick={() => switchTab("activity")}
            className={`group relative flex w-full items-center rounded-2xl transition-all ${
              sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "justify-between px-3.5 py-2.5"
            } text-[14px] font-semibold ${
              view === "activity"
                ? "bg-[#0A84FF] text-white shadow-md shadow-blue-500/20"
                : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
            }`}
            title={sidebarCollapsed ? "Activity (⌘2)" : undefined}
          >
            <div className="flex items-center gap-2.5">
              <IconList size={18} />
              {!sidebarCollapsed && <span>Activity</span>}
            </div>
            {!sidebarCollapsed && activity.length > 0 && (
              <span className="mono text-[11px] font-normal opacity-80">{activity.length}</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => switchTab("swap")}
            className={`group relative flex w-full items-center rounded-2xl transition-all ${
              sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3.5 py-2.5"
            } text-[14px] font-semibold ${
              view === "swap"
                ? "bg-[#0A84FF] text-white shadow-md shadow-blue-500/20"
                : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
            }`}
            title={sidebarCollapsed ? "DEX Swap (⌘3)" : undefined}
          >
            <IconSwap size={18} />
            {!sidebarCollapsed && <span>DEX Swap</span>}
          </button>

          <button
            type="button"
            onClick={() => openSettings("root")}
            className={`group relative flex w-full items-center rounded-2xl transition-all ${
              sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3.5 py-2.5"
            } text-[14px] font-semibold ${
              view === "settings"
                ? "bg-[#0A84FF] text-white shadow-md shadow-blue-500/20"
                : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
            }`}
            title={sidebarCollapsed ? "Settings (⌘4)" : undefined}
          >
            <IconGear size={18} />
            {!sidebarCollapsed && <span>Settings</span>}
          </button>
        </nav>

                                {/* Apple HIG Multi-Account Section */}
        <div className="mt-5 pt-4 border-t border-white/[0.08] flex-1 w-full space-y-2">
          {!sidebarCollapsed ? (
            <>
              {/* Accounts Header */}
              <div className="flex items-center justify-between px-2 pb-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
                  Accounts ({accounts.length})
                </span>
                <button
                  type="button"
                  onClick={() => openSettings("addAccount")}
                  className="text-[12px] font-semibold text-[#0A84FF] hover:underline"
                >
                  + Add
                </button>
              </div>

              {/* Accounts List */}
              <div className="space-y-1 max-h-[260px] overflow-y-auto pr-0.5 scrollbar-none">
                {accounts.map((acct) => {
                  const isActive = acct.id === activeAccount?.id;
                  
                  return (
                    <button
                      key={acct.id}
                      type="button"
                      onClick={() => {
                        triggerHaptic("selection");
                        selectAccount(acct.id);
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-all ${
                        isActive
                          ? "bg-white/[0.09] text-white font-semibold shadow-sm"
                          : "text-neutral-300 hover:bg-white/[0.04] hover:text-white"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <Avatar seed={acct.publicKey} size={28} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] leading-tight font-medium text-white">
                            {acct.label}
                          </p>
                          <p className="mono truncate text-[11px] text-neutral-400 pt-0.5">
                            {isActive && balances
                              ? `${fmtAmount(xlm?.balance ?? "0")} XLM`
                              : shortenAddr(acct.publicKey, 4, 4)}
                          </p>
                        </div>
                      </div>
                      {isActive && (
                        <IconCheck size={16} className="text-[#0A84FF] shrink-0 ml-1" />
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 pt-1">
              {accounts.map((acct) => {
                const isActive = acct.id === activeAccount?.id;
                return (
                  <button
                    key={acct.id}
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection");
                      selectAccount(acct.id);
                    }}
                    className={`relative flex h-10 w-10 items-center justify-center rounded-2xl transition-all ${
                      isActive
                        ? "ring-2 ring-[#0A84FF] bg-white/[0.12] scale-105 shadow-sm shadow-blue-500/25"
                        : "opacity-60 hover:opacity-100 hover:bg-white/[0.06]"
                    }`}
                    title={`${acct.label} - ${shortenAddr(acct.publicKey, 4, 4)}`}
                  >
                    <Avatar seed={acct.publicKey} size={28} />
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => openSettings("addAccount")}
                className="flex h-9 w-9 items-center justify-center rounded-2xl border border-dashed border-white/20 text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors mt-1"
                title="Add Account"
              >
                <IconPlus size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Bottom Controls */}
        <div className="pt-3 border-t border-white/[0.08] space-y-2 w-full">

          {!sidebarCollapsed ? (
            <>
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  className="icon-btn !h-8 !w-8"
                  onClick={() => {
                    triggerHaptic("selection");
                    togglePrivacy();
                  }}
                  title={privacyMode ? "Show balances" : "Hide balances"}
                >
                  {privacyMode ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
                <button
                  type="button"
                  className="icon-btn !h-8 !w-8"
                  onClick={() => {
                    triggerHaptic("light");
                    void refresh();
                  }}
                  disabled={dataLoading}
                  title="Refresh Network Data"
                >
                  {dataLoading ? <Spinner /> : <IconRefresh size={15} />}
                </button>
                <NetworkDropdown network={network} onSwitch={switchNetwork} />
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
            </>
          ) : (
            <div className="flex flex-col items-center gap-1.5 pt-1">
              <button
                type="button"
                className="icon-btn !h-8 !w-8"
                onClick={() => {
                  triggerHaptic("selection");
                  togglePrivacy();
                }}
                title={privacyMode ? "Show balances" : "Hide balances"}
              >
                {privacyMode ? <IconEyeOff size={15} /> : <IconEye size={15} />}
              </button>
              <button
                type="button"
                className="icon-btn !h-8 !w-8 hover:!text-[#FF453A]"
                onClick={() => {
                  triggerHaptic("warning");
                  lock();
                }}
                title="Lock Wallet"
              >
                <IconLock size={15} />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 md:h-screen md:overflow-y-auto">
        {/* Desktop macOS Top Window Header Bar */}
        <header className="hidden md:flex items-center justify-between px-8 py-4 border-b border-white/[0.08] bg-white/[0.01] sticky top-0 z-20 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <h2 className="text-[20px] font-bold text-white tracking-tight">
              {view === "home" ? "Wallet Overview" : view === "swap" ? "In-App DEX Swap" : view.charAt(0).toUpperCase() + view.slice(1)}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <div className="search-field !py-1.5 !px-3 w-64">
              <IconSearch size={14} className="text-neutral-400 shrink-0" />
              <input
                placeholder="Search assets, activity…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-transparent text-[13px] text-white outline-none placeholder:text-neutral-500"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection");
                    setQuery("");
                  }}
                  className="text-neutral-400 hover:text-white"
                >
                  <IconClose size={13} />
                </button>
              )}
            </div>
            <NetworkDropdown network={network} onSwitch={switchNetwork} />
          </div>
        </header>
        {/* Mobile Sticky Nav bar (Hidden on Desktop) */}
        <div className={`md:hidden sticky top-0 z-30 transition-all ${scrolled ? "nav-blur" : ""}`}>
          <div className="mx-auto w-full max-w-[560px] px-5">
            <div className="flex h-[56px] items-center justify-between">
              <AccountMenu onManageAccounts={() => openSettings("accounts")} />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    triggerHaptic("selection");
                    togglePrivacy();
                  }}
                  aria-label={privacyMode ? "Show balances" : "Hide balances"}
                >
                  {privacyMode ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    triggerHaptic("light");
                    void refresh();
                  }}
                  disabled={dataLoading}
                  aria-label="Refresh"
                >
                  {dataLoading ? <Spinner /> : <IconRefresh size={17} />}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => openSettings("root")}
                  aria-label="Settings"
                >
                  <IconGear size={18} />
                </button>
              </div>
            </div>

            {scrolled ? (
              <div className="-mt-1 pb-2.5 text-center">
                <span className="text-[17px] font-semibold tracking-tight text-white">
                  {view === "home" ? "Wallet" : view.charAt(0).toUpperCase() + view.slice(1)}
                </span>
              </div>
            ) : (
              <div className="flex items-end justify-between pb-2">
                <h1 className="display-h text-[34px] leading-tight text-white font-bold">
                  {view === "home" ? "Wallet" : view.charAt(0).toUpperCase() + view.slice(1)}
                </h1>
                {view === "home" && <NetworkDropdown network={network} onSwitch={switchNetwork} />}
              </div>
            )}

            {(view === "home" || view === "activity") && (
              <div className="pb-3">
                <div className="search-field flex items-center gap-2">
                  <IconSearch size={15} className="text-neutral-400 shrink-0" />
                  <input
                    placeholder="Search assets, activity, contacts..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search"
                    className="w-full bg-transparent text-[13.5px] text-white outline-none placeholder:text-neutral-500"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic("selection");
                        setQuery("");
                      }}
                      className="text-neutral-400 hover:text-white"
                    >
                      <IconClose size={14} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Responsive Content Body */}
        <div className="mx-auto w-full max-w-[1200px] px-5 py-4 md:py-8 pb-[150px] md:pb-12">
          {view === "settings" ? (
            <SettingsPage key={settingsKey} initialSub={settingsSub} />
          ) : view === "swap" ? (
            <SwapPage />
          ) : view === "home" && unfunded ? (
            <>
              <UnfundedCard
                network={network}
                fundBusy={fundBusy}
                fundError={fundError}
                onFund={() => void handleFund()}
              />
              <div className="mt-5 max-w-[560px] mx-auto">
                <PriceCard />
              </div>
            </>
          ) : view === "home" ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Hero Portfolio & Assets */}
              <div className="lg:col-span-7 space-y-6">
                {/* Pending Airdrops / Claimable Balances Alert Banner */}
                {claimableBalances.length > 0 && (
                  <div className="fade-up flex items-center justify-between gap-3 rounded-2xl border border-[#30D158]/30 bg-[#30D158]/10 p-3.5 shadow-sm">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-[20px] shrink-0">🎁</span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-white">
                          {claimableBalances.length} Pending Airdrop{claimableBalances.length > 1 ? "s" : ""}
                        </p>
                        <p className="truncate text-[11px] text-neutral-300">
                          {claimableBalances.map((c) => `${fmtAmount(c.amount)} ${c.assetCode}`).join(", ")}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      className="!h-8 !px-3 !text-[12px] shrink-0"
                      loading={claimingAll}
                      disabled={claimingAll}
                      onClick={() => void handleClaimAllAirdrops()}
                    >
                      Claim All
                    </Button>
                  </div>
                )}

                {/* Hero Total Balance */}
                <section className="panel fade-up flex flex-col items-center p-6 text-center">
                  <p className="text-[13px] font-semibold text-neutral-400">Total Portfolio</p>
                  <h2 className="mt-1.5 text-[44px] sm:text-[54px] font-bold leading-none tracking-tight text-white">
                    {balances === null ? (
                      <span className="skeleton inline-block h-[48px] w-60 rounded-2xl align-middle" />
                    ) : privacyMode ? (
                      "••••••"
                    ) : (
                      fmtAmount(xlm?.balance ?? "0")
                    )}
                    {!privacyMode && balances !== null && (
                      <span className="mono text-[22px] sm:text-[24px] font-normal text-neutral-400 ml-2">XLM</span>
                    )}
                  </h2>
                  <div className="mt-2 flex min-h-[24px] items-center justify-center">
                    {privacyMode ? (
                      <p className="text-[13px] text-neutral-500">Balances hidden</p>
                    ) : usdValue !== null ? (
                      <button
                        type="button"
                        onClick={cycleFiatCurrency}
                        className="flex items-center gap-1.5 rounded-full bg-white/[0.05] border border-white/10 px-3.5 py-1 text-[13.5px] font-medium text-neutral-200 hover:text-white transition-colors cursor-pointer"
                        title="Click to cycle currency"
                      >
                        <span>≈ {fmtFiat(usdValue, fiatCurrency)}</span>
                        <span className="text-[10px] text-neutral-500 font-mono font-bold uppercase ml-0.5">
                          {fiatCurrency}
                        </span>
                      </button>
                    ) : network === "testnet" ? (
                      <p className="text-[13px] text-neutral-500">
                        Testnet Lumens — No real value
                      </p>
                    ) : (
                      <p className="text-[13px] text-neutral-500">Fetching live rates…</p>
                    )}
                  </div>

                  {/* Portfolio Allocation Distribution Bar & Legend */}
                  {allocationShares.length > 0 && !privacyMode && (
                    <div className="mt-4 w-full max-w-[360px]">
                      <div className="h-2 w-full overflow-hidden rounded-full flex bg-white/10">
                        {allocationShares.map((s) => (
                          <div
                            key={s.code}
                            style={{ width: `${s.pct}%`, background: s.color }}
                            className="h-full transition-all"
                            title={`${s.code}: ${s.pct.toFixed(1)}%`}
                          />
                        ))}
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-neutral-400">
                        {allocationShares.map((s) => (
                          <span key={s.code} className="flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                            <span className="font-semibold text-neutral-200">{s.code}</span>
                            <span>{s.pct.toFixed(1)}%</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 4 Primary Action Buttons */}
                  <div className="mt-6 grid w-full max-w-[420px] grid-cols-4 gap-2.5">
                    <ActionButton
                      icon={<IconSend size={18} />}
                      label="Send"
                      filled
                      onClick={() => {
                        setSendPrefill(null);
                        setSendOpen(true);
                      }}
                    />
                    <ActionButton
                      icon={<IconArrowDownLeft size={18} />}
                      label="Receive"
                      onClick={() => setReceiveOpen(true)}
                    />
                    <ActionButton
                      icon={<IconSwap size={18} />}
                      label="Swap"
                      onClick={() => switchTab("swap")}
                    />
                    <ActionButton
                      icon={<IconPlus size={18} />}
                      label="Add"
                      onClick={() => setAddAssetOpen(true)}
                    />
                  </div>

                  {activeAccount && (
                    <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                      <CopyButton
                        value={activeAccount.publicKey}
                        label={shortenAddr(activeAccount.publicKey, 8, 8)}
                      />
                      <a
                        className="chip"
                        href={NETWORKS[network].explorerAccountUrl(activeAccount.publicKey)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => triggerHaptic("light")}
                      >
                        Stellarchain
                      </a>
                    </div>
                  )}
                </section>

                {/* Assets List with Sparklines */}
                <section className="fade-up">
                  <div className="flex items-center justify-between px-1 pb-2.5">
                    <h2 className="text-[16px] font-bold text-white tracking-tight">Your Assets</h2>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic("selection");
                          setHideDust((d) => !d);
                        }}
                        className={`text-[12px] font-medium transition-colors ${
                          hideDust ? "text-[#0A84FF] font-semibold" : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        {hideDust ? "Dust Hidden" : "Hide Dust"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic("selection");
                          setBatchSendOpen(true);
                        }}
                        className="text-[12px] font-medium text-neutral-400 hover:text-white"
                      >
                        Multi-Send
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic("selection");
                          setAddAssetOpen(true);
                        }}
                        className="text-[13px] font-semibold text-[#0A84FF] hover:underline"
                      >
                        + Add Asset
                      </button>
                    </div>
                  </div>
                  <div className="list-group">
                    {balances === null &&
                      [0, 1].map((i) => (
                        <div
                          key={i}
                          className={`flex items-center gap-3.5 px-4 py-3.5 ${
                            i > 0 ? "ios-sep" : ""
                          }`}
                        >
                          <div className="skeleton h-[36px] w-[36px] rounded-full" />
                          <div className="skeleton h-4 w-28 rounded" />
                          <div className="skeleton ml-auto h-4 w-16 rounded" />
                        </div>
                      ))}
                    {balances?.length === 0 && (
                      <p className="px-4 py-8 text-center text-[14px] text-neutral-500">
                        No assets in wallet
                      </p>
                    )}
                    {filteredAssets?.map((asset, i) => {
                      const known = lookupKnownAsset(asset.code);
                      const hue = assetHue(asset.key);
                      return (
                        <button
                          key={asset.key}
                          type="button"
                          className={`row-hover flex w-full items-center gap-3.5 px-4 py-3.5 text-left ${
                            i > 0 ? "ios-sep" : ""
                          }`}
                          onClick={() => {
                            triggerHaptic("selection");
                            setDetailAsset(asset);
                          }}
                        >
                          <span
                            className="mono flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-inner"
                            style={
                              known
                                ? { background: known.color }
                                : asset.isNative
                                  ? { background: "linear-gradient(135deg, #0A84FF, #5E5CE6)" }
                                  : {
                                      background: `linear-gradient(135deg, hsl(${hue}, 70%, 45%), hsl(${
                                        (hue + 60) % 360
                                      }, 70%, 35%))`,
                                    }
                            }
                          >
                            {asset.code.slice(0, 3)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15.5px] font-semibold leading-tight text-white">
                              {asset.code}
                            </span>
                            <span className="block truncate text-[12px] leading-tight text-neutral-400">
                              {asset.isNative
                                ? "Stellar Lumens"
                                : known
                                  ? known.name
                                  : shortenAddr(asset.issuer ?? "", 6, 6)}
                            </span>
                          </span>
                          <div className="hidden sm:block mr-2">
                            <Sparkline
                              values={[0.12, 0.124, 0.122, 0.129, 0.135, 0.132, 0.141]}
                              width={60}
                              height={24}
                              color={known?.color ?? (asset.isNative ? "#30D158" : "#0A84FF")}
                            />
                          </div>
                          <span className="text-right">
                            <span className="mono block text-[15.5px] font-medium leading-tight text-white">
                              {privacyMode ? "••••••" : fmtAmount(asset.balance)}
                            </span>
                            {asset.isNative && !privacyMode && network === "mainnet" && xlmPriceUsd !== null && (
                              <span className="block text-[12px] leading-tight text-neutral-400">
                                {fmtFiat(parseFloat(asset.balance) * xlmPriceUsd, fiatCurrency)}
                              </span>
                            )}
                          </span>
                          <Chevron />
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>

              {/* Right Column: Live Chart & Recent Activity Stream */}
              <div className="lg:col-span-5 space-y-6">
                {/* Live XLM Price Chart */}
                <PriceCard />

                {/* Recent Activity Mini-Feed */}
                <div className="panel p-5 fade-up">
                  <div className="flex items-center justify-between pb-3">
                    <h3 className="text-[15px] font-bold text-white">Recent Activity</h3>
                    <button
                      type="button"
                      onClick={() => switchTab("activity")}
                      className="text-[12px] font-semibold text-[#0A84FF] hover:underline"
                    >
                      View All
                    </button>
                  </div>
                  {activity.length === 0 ? (
                    <p className="text-center py-6 text-[13px] text-neutral-500">
                      No recent activity
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {activity.slice(0, 5).map((item) => {
                        const incoming = item.direction === "in";
                        const neutral = item.direction === "neutral";
                        const matchedContact = contacts.find((c) => c.address === item.counterparty);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              triggerHaptic("selection");
                              setTxDetail(item);
                            }}
                            className="flex w-full items-center justify-between rounded-xl p-2 text-left hover:bg-white/[0.04] transition-colors"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px]"
                                style={{
                                  color: neutral ? "#64D2FF" : incoming ? "#30D158" : "#FF453A",
                                  background: neutral
                                    ? "rgba(100,210,255,0.12)"
                                    : incoming
                                      ? "rgba(48,209,88,0.14)"
                                      : "rgba(255,69,58,0.14)",
                                }}
                              >
                                {incoming ? "↓" : "↑"}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-[13px] font-semibold text-white leading-tight">
                                  {item.title}
                                </p>
                                <p className="truncate text-[11px] text-neutral-400">
                                  {matchedContact ? matchedContact.name : timeAgo(item.createdAt)}
                                </p>
                              </div>
                            </div>
                            {item.amount && (
                              <span
                                className="mono text-[13px] font-medium shrink-0"
                                style={{ color: incoming ? "#30D158" : "#FF453A" }}
                              >
                                {incoming ? "+" : "−"}{fmtAmount(item.amount)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : view === "activity" ? (
            <section className="fade-up pt-2 max-w-[1000px] mx-auto">
              {/* Filter Pills & Export CSV */}
              <div className="flex items-center justify-between gap-2 pb-2.5 pt-1">
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none sm:bg-white/[0.04] sm:p-1 sm:rounded-2xl sm:border sm:border-white/10">
                  {(
                    [
                      { id: "all", label: "All" },
                      { id: "in", label: "Received" },
                      { id: "out", label: "Sent" },
                      { id: "swap", label: "Swaps" },
                      { id: "trust", label: "Trustlines" },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        triggerHaptic("selection");
                        setActivityFilter(f.id);
                      }}
                      className={`rounded-full sm:rounded-xl px-3.5 py-1 text-[12px] font-medium transition-all shrink-0 ${
                        activityFilter === f.id
                          ? "bg-white text-black font-semibold shadow-sm"
                          : "bg-white/[0.08] sm:bg-transparent text-neutral-400 hover:text-white sm:hover:bg-white/[0.06]"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {filteredActivity.length > 0 && (
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="chip !py-1 !px-2.5 text-[11.5px] shrink-0 flex items-center gap-1"
                    title="Export activity to CSV"
                  >
                    <IconDownload size={12} />
                    <span>CSV</span>
                  </button>
                )}
              </div>

              {/* Active Counterparty Filter Pill */}
              {counterpartyFilter && (
                <div className="mb-3 flex items-center justify-between rounded-xl bg-white/[0.06] border border-white/10 px-3 py-1.5 text-[12px]">
                  <span className="mono truncate text-neutral-300">
                    Filtered by: {shortenAddr(counterpartyFilter, 6, 6)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection");
                      setCounterpartyFilter(null);
                    }}
                    className="text-[#0A84FF] font-semibold hover:underline"
                  >
                    Clear
                  </button>
                </div>
              )}

              {filteredActivity.length === 0 ? (
                <div className="list-group mt-2">
                  <p className="px-4 py-12 text-center text-[14px] text-neutral-500">
                    No activity found
                  </p>
                </div>
              ) : (
                <div className="space-y-4 mt-2">
                  {groupedActivity.map((group) => (
                    <div key={group.title}>
                      <div className="flex items-center justify-between px-2 pb-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                          {group.title}
                        </p>
                        <span className="text-[11px] text-neutral-500 hidden sm:inline">
                          {group.items.length} transaction{group.items.length > 1 ? "s" : ""}
                        </span>
                      </div>
                      <div className="list-group">
                        {group.items.map((item, i) => {
                          const incoming = item.direction === "in";
                          const neutral = item.direction === "neutral";
                          const matchedContact = contacts.find((c) => c.address === item.counterparty);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className={`row-hover flex w-full items-center gap-3.5 px-4 py-3.5 text-left ${
                                i > 0 ? "ios-sep" : ""
                              }`}
                              onClick={() => {
                                triggerHaptic("selection");
                                setTxDetail(item);
                              }}
                            >
                              <span
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                                style={{
                                  color: neutral ? "#64D2FF" : incoming ? "#30D158" : "#FF453A",
                                  background: neutral
                                    ? "rgba(100,210,255,0.12)"
                                    : incoming
                                      ? "rgba(48,209,88,0.14)"
                                      : "rgba(255,69,58,0.14)",
                                }}
                              >
                                {item.type === "change_trust" ? (
                                  <IconShield size={16} />
                                ) : neutral ? (
                                  <IconSwap size={16} />
                                ) : incoming ? (
                                  <IconArrowDownLeft size={16} />
                                ) : (
                                  <IconArrowUpRight size={16} />
                                )}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[15px] font-semibold leading-tight text-white">
                                  {item.title}
                                </span>
                                <span className="block truncate text-[12px] leading-tight text-neutral-400">
                                  {timeAgo(item.createdAt)}
                                  {matchedContact
                                    ? ` · ${matchedContact.name}`
                                    : item.counterparty
                                      ? ` · ${shortenAddr(item.counterparty, 4, 4)}`
                                      : ""}
                                </span>
                              </span>
                              {item.amount !== null && (
                                <span
                                  className="mono shrink-0 text-right text-[15px] font-medium"
                                  style={{
                                    color: privacyMode
                                      ? "var(--color-faint)"
                                      : neutral
                                        ? "#FFFFFF"
                                        : incoming
                                          ? "#30D158"
                                          : "#FF453A",
                                  }}
                                >
                                  {privacyMode
                                    ? "••••••"
                                    : `${incoming ? "+" : "−"}${fmtAmount(item.amount)}`}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activityCursor && (
                <button
                  type="button"
                  className="mt-4 w-full rounded-2xl bg-white/[0.08] py-3.5 text-center text-[15px] font-semibold text-[#0A84FF] hover:bg-white/[0.12] transition-colors"
                  onClick={() => {
                    triggerHaptic("selection");
                    void loadMoreActivity();
                  }}
                >
                  {loadingMore ? <Spinner /> : "Load More Activity"}
                </button>
              )}
            </section>
          ) : null}
        </div>
      </main>

      {/* Floating iOS Tab Bar (Mobile Only - Hidden on Desktop/iPad) */}
      <nav className="tab-bar md:hidden" aria-label="Tabs">
        <button
          type="button"
          className={`tab-item ${view === "home" ? "active" : ""}`}
          onClick={() => switchTab("home")}
        >
          <IconHome size={22} />
          <span>Home</span>
        </button>
        <button
          type="button"
          className={`tab-item ${view === "activity" ? "active" : ""}`}
          onClick={() => switchTab("activity")}
        >
          <IconList size={22} />
          <span>Activity</span>
        </button>
        <button
          type="button"
          className={`tab-item ${view === "swap" ? "active" : ""}`}
          onClick={() => switchTab("swap")}
        >
          <IconSwap size={22} />
          <span>Swap</span>
        </button>
        <button
          type="button"
          className={`tab-item ${view === "settings" ? "active" : ""}`}
          onClick={() => openSettings("root")}
        >
          <IconGear size={22} />
          <span>Settings</span>
        </button>
      </nav>

      <SendModal open={sendOpen} onClose={() => setSendOpen(false)} prefill={sendPrefill} />
      <BatchSendModal open={batchSendOpen} onClose={() => setBatchSendOpen(false)} />
      <ReceiveModal open={receiveOpen} onClose={() => setReceiveOpen(false)} />
      <AddAssetModal open={addAssetOpen} onClose={() => setAddAssetOpen(false)} />
      <AssetDetailModal asset={detailAsset} onClose={() => setDetailAsset(null)} />
      <TxDetailModal item={txDetail} onClose={() => setTxDetail(null)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
      />
    </div>
  );
}

function Chevron() {
  return (
    <svg
      className="chevron"
      width="8"
      height="14"
      viewBox="0 0 8 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m1.5 1.5 5 5.5-5 5.5" />
    </svg>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  filled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  filled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        triggerHaptic("selection");
        onClick();
      }}
      className={`flex h-[52px] items-center justify-center gap-1.5 rounded-2xl text-[14px] font-semibold transition-all active:scale-[0.96] shadow-sm ${
        filled
          ? "bg-[#0A84FF] text-white hover:bg-[#0071E3]"
          : "bg-white/[0.08] text-white hover:bg-white/[0.12]"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function NetworkDropdown({
  network,
  onSwitch,
}: {
  network: NetworkKey;
  onSwitch: (n: NetworkKey) => void;
}) {
  return (
    <Dropdown
      trigger={() => (
        <span className="cursor-pointer">
          <NetworkBadge network={network} />
        </span>
      )}
    >
      {(close) => (
        <>
          {(["testnet", "mainnet"] as NetworkKey[]).map((n) => (
            <button
              key={n}
              type="button"
              className="menu-item"
              onClick={() => {
                triggerHaptic("selection");
                onSwitch(n);
                close();
              }}
            >
              <span
                className="badge-dot"
                style={{ background: n === "mainnet" ? "#30d158" : "#ff9f0a" }}
              />
              <span className="capitalize">{n}</span>
              {n === network && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#0A84FF]" />
              )}
            </button>
          ))}
        </>
      )}
    </Dropdown>
  );
}

function AccountMenu({
  onManageAccounts,
  compact = false,
}: {
  onManageAccounts: () => void;
  compact?: boolean;
}) {
  const { accounts, activeAccount, selectAccount, lock, network } = useWallet();
  if (!activeAccount) return null;
  return (
    <Dropdown
      align="left"
      trigger={() =>
        compact ? (
          <button
            type="button"
            className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] transition-all hover:bg-white/[0.08] hover:border-white/20 active:scale-95 shadow-sm"
            title={`${activeAccount.label} (${shortenAddr(activeAccount.publicKey, 4, 4)})`}
          >
            <Avatar seed={activeAccount.publicKey} size={28} />
            <span
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#18181b]"
              style={{ background: network === "mainnet" ? "#30d158" : "#ff9f0a" }}
            />
          </button>
        ) : (
          <button
            type="button"
            className="flex items-center gap-2.5 rounded-full py-1 pr-3 pl-1 transition-colors hover:bg-white/[0.06]"
          >
            <Avatar seed={activeAccount.publicKey} size={34} />
            <span className="text-left">
              <span className="block text-[15px] font-semibold leading-tight text-white">
                {activeAccount.label}
              </span>
              <span className="mono block max-w-[86px] truncate text-[11px] leading-tight text-neutral-400">
                {shortenAddr(activeAccount.publicKey, 4, 4)}
              </span>
            </span>
            <IconChevronDown size={12} className="text-neutral-400" />
          </button>
        )
      }
    >
      {(close) => (
        <>
          <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Switch Account
          </p>
          {accounts.map((acct) => (
            <button
              key={acct.id}
              type="button"
              className="menu-item"
              onClick={() => {
                triggerHaptic("selection");
                selectAccount(acct.id);
                close();
              }}
            >
              <Avatar seed={acct.publicKey} size={22} />
              <span className="truncate">{acct.label}</span>
              {acct.id === activeAccount.id && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#0A84FF]" />
              )}
            </button>
          ))}
          <div className="my-1.5 h-px bg-white/10" />
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              onManageAccounts();
              close();
            }}
          >
            <IconKey size={15} /> Manage Accounts
          </button>
          <button
            type="button"
            className="menu-item danger"
            onClick={() => {
              triggerHaptic("warning");
              lock();
              close();
            }}
          >
            <IconLock size={15} /> Lock Wallet
          </button>
        </>
      )}
    </Dropdown>
  );
}

function UnfundedCard({
  network,
  fundBusy,
  fundError,
  onFund,
}: {
  network: NetworkKey;
  fundBusy: boolean;
  fundError: string | null;
  onFund: () => void;
}) {
  return (
    <section className="fade-up flex flex-col items-center px-6 py-12 text-center panel max-w-xl mx-auto">
      <span className="gold-bubble h-[76px] w-[76px] shadow-xl">
        <IconWallet size={32} />
      </span>
      <h2 className="display-h mt-6 text-[28px] text-white font-bold">Activate your account</h2>
      <p className="mt-3 max-w-md text-[15px] leading-relaxed text-neutral-300">
        Stellar accounts must hold a minimum base reserve of 1 XLM to exist on-chain.{" "}
        {network === "testnet"
          ? "On testnet, Friendbot will fund your account with 10,000 free test XLM instantly."
          : "On mainnet, transfer at least 1 XLM from an existing wallet to activate your public address."}
      </p>
      {network === "testnet" && (
        <Button
          className="mt-8 w-full max-w-[360px] !py-3.5 text-[15px] font-semibold"
          loading={fundBusy}
          disabled={fundBusy}
          onClick={onFund}
        >
          Claim 10,000 Test XLM (Friendbot)
        </Button>
      )}
      {fundError && <p className="mt-4 max-w-md text-xs text-[#FF453A]">{fundError}</p>}
    </section>
  );
}

function assetHue(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 33 + key.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function PriceCard() {
  const { priceData, priceRange, changePriceRange, priceLoading } = useWallet();
  const ranges: PriceRangeT[] = ["1D", "7D", "1M", "1Y"];
  const up = (priceData?.changePct ?? 0) >= 0;
  return (
    <section className="panel fade-up p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-semibold text-neutral-400">XLM Market</p>
          <div className="mt-0.5 flex items-center gap-2.5">
            <span className="text-[24px] font-bold tracking-tight text-white">
              {priceData ? fmtUsd(priceData.current) : "—"}
            </span>
            {priceData && (
              <span
                className="rounded-lg px-2 py-0.5 text-[12px] font-semibold"
                style={{
                  color: up ? "#30D158" : "#FF453A",
                  background: up ? "rgba(48,209,88,0.15)" : "rgba(255,69,58,0.15)",
                }}
              >
                {up ? "+" : ""}
                {priceData.changePct.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1 pt-1 bg-white/[0.06] p-1 rounded-xl">
          {ranges.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                triggerHaptic("selection");
                void changePriceRange(r);
              }}
              className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-all ${
                priceRange === r ? "bg-white/[0.18] text-white shadow-sm" : "text-neutral-400 hover:text-white"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        {priceData && priceData.points.length > 1 ? (
          <PriceChart points={priceData.points} range={priceRange} />
        ) : (
          <div className="skeleton h-[140px] w-full rounded-2xl" />
        )}
      </div>
      {priceLoading && <p className="mt-1 text-right text-[10px] text-neutral-500">Updating…</p>}
    </section>
  );
}
