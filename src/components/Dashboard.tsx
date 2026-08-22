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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    <div className="relative z-10 min-h-screen">
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
      {/* Dynamic Nav bar */}
      <div className={`sticky top-0 z-30 transition-all ${scrolled ? "nav-blur" : ""}`}>
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

      {/* Main View Content */}
      <div className="mx-auto w-full max-w-[560px] px-5 pb-[150px]">
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
            <div className="mt-5">
              <PriceCard />
            </div>
          </>
        ) : view === "home" ? (
          <>
            {/* Pending Airdrops / Claimable Balances Alert Banner */}
            {claimableBalances.length > 0 && (
              <div className="fade-up mb-4 flex items-center justify-between gap-3 rounded-2xl border border-[#30D158]/30 bg-[#30D158]/10 p-3.5 shadow-sm">
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
            <section className="fade-up flex flex-col items-center pb-6 pt-4 text-center">
              <p className="text-[13px] font-semibold text-neutral-400">Total Portfolio</p>
              <h2 className="mt-1.5 text-[48px] font-bold leading-none tracking-tight text-white sm:text-[56px]">
                {balances === null ? (
                  <span className="skeleton inline-block h-[48px] w-60 rounded-2xl align-middle" />
                ) : privacyMode ? (
                  "••••••"
                ) : (
                  fmtAmount(xlm?.balance ?? "0")
                )}
                {!privacyMode && balances !== null && (
                  <span className="mono text-[24px] font-normal text-neutral-400 ml-2">XLM</span>
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
                    title="Click to cycle currency (USD, EUR, GBP, JPY...)"
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

              {/* Portfolio Allocation Distribution Bar */}
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

            {/* Live XLM Price Chart Card */}
            <div className="mt-2">
              <PriceCard />
            </div>

            {/* Assets List with Sparklines */}
            <section className="fade-up mt-6">
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
          </>
        ) : view === "activity" ? (
          <section className="fade-up pt-2">
            {/* Filter Pills & Export CSV */}
            <div className="flex items-center justify-between gap-2 pb-2.5 pt-1">
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
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
                    className={`rounded-full px-3.5 py-1 text-[12px] font-medium transition-all shrink-0 ${
                      activityFilter === f.id
                        ? "bg-white text-black font-semibold shadow-sm"
                        : "bg-white/[0.08] text-neutral-400 hover:text-white"
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
                    <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                      {group.title}
                    </p>
                    <div className="list-group">
                      {group.items.map((item, i) => {
                        const incoming = item.direction === "in";
                        const neutral = item.direction === "neutral";
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
                                {item.counterparty
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

      {/* Floating iOS Tab Bar */}
      <nav className="tab-bar" aria-label="Tabs">
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

function AccountMenu({ onManageAccounts }: { onManageAccounts: () => void }) {
  const { accounts, activeAccount, selectAccount, lock } = useWallet();
  if (!activeAccount) return null;
  return (
    <Dropdown
      align="left"
      trigger={() => (
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
      )}
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
    <section className="fade-up flex flex-col items-center px-4 pb-10 pt-14 text-center">
      <span className="gold-bubble h-[72px] w-[72px]">
        <IconWallet size={28} />
      </span>
      <h2 className="display-h mt-6 text-[26px] text-white">Activate your account</h2>
      <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-neutral-300">
        Stellar accounts must hold a minimum reserve of 1 XLM to exist.{" "}
        {network === "testnet"
          ? "On testnet, Friendbot will fund you with 10,000 free XLM instantly."
          : "On mainnet, have someone send you at least 1 XLM from an existing account."}
      </p>
      {network === "testnet" && (
        <Button
          className="mt-8 w-full max-w-[360px]"
          loading={fundBusy}
          disabled={fundBusy}
          onClick={onFund}
        >
          Claim 10,000 Test XLM
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
