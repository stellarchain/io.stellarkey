"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@/hooks/useWallet";
import { getHorizonUrl, NETWORKS } from "@/lib/stellar";
import { lookupKnownAsset } from "@/lib/assets";
import { assetMetadataCacheKey, fetchAssetLogo, getCachedAssetLogo } from "@/lib/toml";
import { parseSep7PayUri, type PayUriPayload } from "@/lib/payuri";
import {
  fmtAmount,
  fmtFiat,
  fmtUsd,
  formatActivityAmount,
  generateActivityCsv,
  shortenAddr,
  timeAgo,
} from "@/lib/format";
import type { AccountMeta, ActivityItem, AssetBalance } from "@/lib/types";
import type { PriceRange as PriceRangeT } from "@/lib/api";
import { triggerHaptic } from "@/lib/haptics";
import { fetchAssetPrices, estimatePortfolioUsd, getUnitPrice, type AssetPrices } from "@/lib/prices";
import { playTapSound } from "@/lib/sounds";
import { activityAssetPresentation } from "@/lib/transaction-intent";
import { pendingTransactionPresentation } from "@/lib/submission";
import { PriceChart } from "./PriceChart";
import { Sparkline } from "./Sparkline";
import type { NetworkKey } from "@/lib/stellar";
import type { SettingsSub } from "./SettingsPage";
import type { Contact } from "@/lib/contacts";
import { FiatValue } from "./FiatValue";
import { Avatar, Button, CopyButton, Dropdown, Modal, ModalHeader, NetworkBadge, Select, Spinner } from "./ui";
import {
  IconArrowDownLeft,
  IconAlert,
  IconTrezor,
  IconLedger,
  IconArrowUpRight,
  IconBook,
  IconCalculator,
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

const SettingsPage = dynamic(() => import("./SettingsPage").then((m) => m.SettingsPage), { ssr: false });
const AddAccountModal = dynamic(() => import("./AddAccountModal").then((m) => m.AddAccountModal), { ssr: false });
const AddressBookPage = dynamic(() => import("./AddressBookPage").then((m) => m.AddressBookPage), { ssr: false });
const BackupWizardModal = dynamic(() => import("./BackupWizardModal").then((m) => m.BackupWizardModal), { ssr: false });
const MultiSigStudioModal = dynamic(() => import("./MultiSigStudioModal").then((m) => m.MultiSigStudioModal), { ssr: false });
const AddAssetModal = dynamic(() => import("./AddAssetModal").then((m) => m.AddAssetModal), { ssr: false });
const AssetDetailModal = dynamic(() => import("./AssetDetailModal").then((m) => m.AssetDetailModal), { ssr: false });
const BatchSendModal = dynamic(() => import("./BatchSendModal").then((m) => m.BatchSendModal), { ssr: false });
const CommandPalette = dynamic(() => import("./CommandPalette").then((m) => m.CommandPalette), { ssr: false });
const ReceiveModal = dynamic(() => import("./ReceiveModal").then((m) => m.ReceiveModal), { ssr: false });
const SendModal = dynamic(() => import("./SendModal").then((m) => m.SendModal), { ssr: false });
const SwapPage = dynamic(() => import("./SwapPage").then((m) => m.SwapPage), { ssr: false });
const TxDetailModal = dynamic(() => import("./TxDetailModal").then((m) => m.TxDetailModal), { ssr: false });
const KeyboardShortcutsModal = dynamic(() => import("./KeyboardShortcutsModal").then((m) => m.KeyboardShortcutsModal), { ssr: false });
const CurrencyConverterModal = dynamic(() => import("./CurrencyConverterModal").then((m) => m.CurrencyConverterModal), { ssr: false });
const NetworkStatsModal = dynamic(() => import("./NetworkStatsModal").then((m) => m.NetworkStatsModal), { ssr: false });
const TrezorModal = dynamic(() => import("./TrezorModal").then((m) => m.TrezorModal), { ssr: false });
const RenameAccountModal = dynamic(() => import("./RenameAccountModal").then((m) => m.RenameAccountModal), { ssr: false });

type View = "home" | "activity" | "swap" | "contacts" | "settings";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}
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
    pendingTxs,
    retryPendingTransaction,
    accountBalances,
    claimableBalances,
    claimAirdrop,
    activity,
    activityCursor,
    dataLoading,
    dataError,
    loadingMore,
    xlmPriceUsd,
    priceData,
    unfunded,
    privacyMode,
    togglePrivacy,
    fiatCurrency,
    fiatRates,
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
  const [hideActivityDust, setHideActivityDust] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [batchSendOpen, setBatchSendOpen] = useState(false);
  const [sendPrefill, setSendPrefill] = useState<PayUriPayload | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [addAssetOpen, setAddAssetOpen] = useState(false);
  const [settingsSub, setSettingsSub] = useState<SettingsSub>("root");
  const [settingsKey, setSettingsKey] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [converterOpen, setConverterOpen] = useState(false);
  const [networkStatsOpen, setNetworkStatsOpen] = useState(false);
  const [trezorModalOpen, setTrezorModalOpen] = useState(false);
  const [renamingAccount, setRenamingAccount] = useState<AccountMeta | null>(null);
  const [activityAssetFilter, setActivityAssetFilter] = useState<string>("all");
  const [pinnedAssets, setPinnedAssets] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(window.localStorage.getItem("wallet.pinned-assets.v1") ?? "[]");
    } catch {
      return [];
    }
  });

  const togglePinAsset = (key: string) => {
    triggerHaptic("selection");
    setPinnedAssets((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        window.localStorage.setItem("wallet.pinned-assets.v1", JSON.stringify(next));
      } catch {
        // Ignore
      }
      return next;
    });
  };
  const [nodePing, setNodePing] = useState<number | null>(null);
  const [detailAsset, setDetailAsset] = useState<AssetBalance | null>(null);
  const [txDetail, setTxDetail] = useState<ActivityItem | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [fundBusy, setFundBusy] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const [networkModalOpen, setNetworkModalOpen] = useState(false);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [pullY, setPullY] = useState(0);
  const [refreshingPull, setRefreshingPull] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const pullYRef = useRef(0);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [portfolioView, setPortfolioView] = useState<"active" | "all">("active");
  const [assetPrices, setAssetPrices] = useState<AssetPrices>({});
  const [assetLogos, setAssetLogos] = useState<Record<string, string>>({});
  const [backupWizardOpen, setBackupWizardOpen] = useState(false);
  const [multisigOpen, setMultisigOpen] = useState(false);
  const [appHidden, setAppHidden] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const pendingAirdropClaim = pendingTxs.some(
    (transaction) => transaction.label === "Airdrop claim",
  );

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      const params = new URLSearchParams(window.location.search);
      const action = params.get("action");
      if (action === "send") {
        setSendPrefill(null);
        setSendOpen(true);
        window.history.replaceState(null, "", window.location.pathname);
        return;
      }
      if (action === "receive") {
        setReceiveOpen(true);
        window.history.replaceState(null, "", window.location.pathname);
        return;
      }
      if (action === "swap") {
        setView("swap");
        window.history.replaceState(null, "", window.location.pathname);
        return;
      }
      const uri = params.get("uri");
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

  // Testnet tokens have no monetary value, even when they reuse a production code.
  useEffect(() => {
    if (network !== "mainnet" || !balances || balances.length === 0) {
      return;
    }
    let alive = true;
    void (async () => {
      const pricedAssets = balances
        .filter((b) => !b.isNative && b.issuer !== null && parseFloat(b.balance) > 0)
        .map((b) => ({ code: b.code, issuer: b.issuer, network }));
      const prices = await fetchAssetPrices(pricedAssets);
      if (alive && Object.keys(prices).length > 0) setAssetPrices(prices);

      // Resolve token logos for custom assets (cached per code:issuer)
      const customAssets = balances.filter(
        (b): b is AssetBalance & { issuer: string } =>
          !b.isNative && b.issuer !== null && !lookupKnownAsset(b.code, b.issuer, network),
      );
      for (const b of customAssets) {
        const key = assetMetadataCacheKey(b.code, b.issuer, getHorizonUrl(network));
        if (assetLogos[key]) continue;
        const cached = getCachedAssetLogo(b.code, b.issuer, getHorizonUrl(network));
        if (cached) {
          setAssetLogos((prev) => ({ ...prev, [key]: cached }));
          continue;
        }
        void fetchAssetLogo(b.code, b.issuer, getHorizonUrl(network)).then((url) => {
          if (alive && url) setAssetLogos((prev) => ({ ...prev, [key]: url }));
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [network, balances, assetLogos]);

  // PWA install prompt capture
  useEffect(() => {
    function onInstallPrompt(e: Event) {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onInstallPrompt);
  }, []);

  // Native-feel pull-to-refresh on touch devices
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    const isFormTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };

    const onStart = (e: TouchEvent) => {
      if (isFormTarget(e.target)) return;
      if (window.scrollY <= 0 && !refreshingPull) {
        touchStartY.current = e.touches[0].clientY;
      }
    };

    const onMove = (e: TouchEvent) => {
      if (touchStartY.current === null || refreshingPull) return;
      const dy = e.touches[0].clientY - touchStartY.current;
      if (dy > 0 && window.scrollY <= 0) {
        // Resistance curve: harder to pull the further you go
        const y = Math.min(110, dy * 0.45);
        pullYRef.current = y;
        setPullY(y);
      }
    };

    const onEnd = () => {
      touchStartY.current = null;
      if (pullYRef.current >= 60) {
        setRefreshingPull(true);
        setPullY(52);
        void refresh().finally(() => {
          setRefreshingPull(false);
          pullYRef.current = 0;
          setPullY(0);
        });
      } else {
        pullYRef.current = 0;
        setPullY(0);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [refreshingPull, refresh]);

  // Live Horizon Node Latency Ping
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const start = performance.now();
        const res = await fetch(getHorizonUrl(network), { method: "GET", signal: AbortSignal.timeout(4000) });
        if (alive) setNodePing(res.ok ? Math.round(performance.now() - start) : null);
      } catch {
        if (alive) setNodePing(null);
      }
    };
    void ping();
    const iv = setInterval(ping, 30000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [network]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isInput =
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.tagName === "SELECT";

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "1") {
        e.preventDefault();
        switchTab("home");
      } else if ((e.metaKey || e.ctrlKey) && e.key === "2") {
        e.preventDefault();
        switchTab("activity");
      } else if ((e.metaKey || e.ctrlKey) && e.key === "3") {
        e.preventDefault();
        switchTab("swap");
      } else if ((e.metaKey || e.ctrlKey) && e.key === "4") {
        e.preventDefault();
        switchTab("contacts");
      } else if ((e.metaKey || e.ctrlKey) && e.key === "5") {
        e.preventDefault();
        openSettings("root");
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && !isInput) {
        e.preventDefault();
        setSendOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r" && !isInput) {
        e.preventDefault();
        setReceiveOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w" && !isInput) {
        e.preventDefault();
        switchTab("swap");
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b" && !isInput) {
        e.preventDefault();
        setBatchSendOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "h" && !isInput) {
        e.preventDefault();
        togglePrivacy();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l" && !isInput) {
        e.preventDefault();
        lock();
      } else if (e.key === "?" && !isInput && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [accounts, selectAccount, togglePrivacy, lock]);

  // Infinite scroll for Activity — iOS-style forever scroll: an IntersectionObserver
  // sentinel near the list end pulls the next page automatically.
  const loadMoreRef = useRef(loadMoreActivity);
  useEffect(() => {
    loadMoreRef.current = loadMoreActivity;
  }, [loadMoreActivity]);
  const activitySentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view !== "activity" || !activityCursor) return;
    const el = activitySentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMoreRef.current();
      },
      // Start fetching well before the user reaches the bottom
      { rootMargin: "600px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [view, activityCursor, loadingMore]);

  const xlm = useMemo(() => balances?.find((b) => b.isNative) ?? null, [balances]);
  // Only verified mainnet asset identities participate in portfolio valuation.
  const usdValue =
    network === "mainnet" && balances !== null && xlmPriceUsd !== null
      ? estimatePortfolioUsd(balances, xlmPriceUsd, assetPrices, network)
      : null;

  // Aggregated net worth across every account in the wallet
  const totalAllXlm = useMemo(
    () => Object.values(accountBalances).reduce((sum, n) => sum + n, 0),
    [accountBalances],
  );
  const totalAllUsd =
    network === "mainnet" && xlmPriceUsd !== null ? totalAllXlm * xlmPriceUsd : null;
  const heroXlm = portfolioView === "all" ? totalAllXlm : parseFloat(xlm?.balance ?? "0");
  const heroUsd =
    portfolioView === "all"
      ? totalAllUsd
      : usdValue;

  // Fiat value of an activity item's amount at current prices (null when unpriced)
  function activityFiat(item: ActivityItem): number | null {
    if (item.amount === null) return null;
    const amount = parseFloat(item.amount);
    if (!Number.isFinite(amount)) return null;
    const code = item.assetCode;
    if (!code) return null;
    const unit = getUnitPrice(
      code,
      item.assetIssuer,
      network,
      code === "XLM" && item.assetIssuer === null,
      xlmPriceUsd,
      assetPrices,
    );
    return unit === null ? null : amount * unit;
  }

  const q = query.trim().toLowerCase();
  const filteredAssets = useMemo(() => {
    let list = balances ?? [];
    if (hideDust) {
      list = list.filter((b) => b.isNative || parseFloat(b.balance) > 0.0001);
    }
    if (q) {
      list = list.filter(
        (b) =>
          b.code.toLowerCase().includes(q) ||
          (b.issuer ?? "").toLowerCase().includes(q) ||
          (lookupKnownAsset(b.code, b.issuer, network)?.name ?? "").toLowerCase().includes(q),
      );
    }
    return list.slice().sort((a, b) => {
      const aPinned = pinnedAssets.includes(a.key) ? 1 : 0;
      const bPinned = pinnedAssets.includes(b.key) ? 1 : 0;
      return bPinned - aPinned;
    });
  }, [balances, hideDust, network, q, pinnedAssets]);

  const filteredActivity = useMemo(() => {
    return activity.filter((a) => {
      if (counterpartyFilter && a.counterparty !== counterpartyFilter) return false;
      if (activityFilter === "in" && a.direction !== "in") return false;
      if (activityFilter === "out" && a.direction !== "out") return false;
      if (activityFilter === "swap" && a.direction !== "neutral") return false;
      if (activityFilter === "trust" && a.type !== "change_trust") return false;
      if (
        activityAssetFilter !== "all" &&
        activityAssetPresentation(a).identity !== activityAssetFilter
      ) return false;
      if (hideActivityDust && a.amount !== null && parseFloat(a.amount) < 0.1) return false;

      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        (a.assetCode ?? "").toLowerCase().includes(q) ||
        (a.assetIssuer ?? "").toLowerCase().includes(q) ||
        (a.counterparty ?? "").toLowerCase().includes(q) ||
        a.hash.toLowerCase().includes(q)
      );
    });
  }, [activity, activityFilter, activityAssetFilter, counterpartyFilter, hideActivityDust, q]);

  const activityAssetOptions = useMemo(() => {
    const assets = new Map<string, { value: string; label: string; sublabel?: string }>();
    for (const item of activity) {
      const presentedAsset = activityAssetPresentation(item);
      if (!presentedAsset.identity || !presentedAsset.code) continue;
      if (assets.has(presentedAsset.identity)) continue;
      assets.set(presentedAsset.identity, {
        value: presentedAsset.identity,
        label: presentedAsset.code,
        sublabel: presentedAsset.issuerDisplay ?? "Native",
      });
    }
    return [...assets.values()];
  }, [activity]);

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
    if (network !== "mainnet" || !balances || balances.length === 0) return [];
    const valued = balances.flatMap((balance) => {
      const unit = getUnitPrice(
        balance.code,
        balance.issuer,
        network,
        balance.isNative,
        xlmPriceUsd,
        assetPrices,
      );
      const amount = parseFloat(balance.balance);
      return unit !== null && Number.isFinite(amount) && amount > 0
        ? [{ balance, value: amount * unit }]
        : [];
    });
    const total = valued.reduce((sum, item) => sum + item.value, 0);
    if (total <= 0) return [];
    return valued.map(({ balance: b, value }) => {
      const known = lookupKnownAsset(b.code, b.issuer, network);
      const pct = (value / total) * 100;
      return {
        code: b.code,
        pct,
        color: known?.color ?? (b.isNative ? "#0A84FF" : `hsl(${assetHue(b.key)}, 70%, 50%)`),
      };
    });
  }, [assetPrices, balances, network, xlmPriceUsd]);

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
    if (claimableBalances.length === 0 || pendingAirdropClaim) return;
    setClaimingAll(true);
    triggerHaptic("selection");
    try {
      for (const item of claimableBalances) {
        const result = await claimAirdrop(item.id);
        if (result.status !== "confirmed") {
          triggerHaptic(result.status === "status_unknown" ? "warning" : "medium");
          return;
        }
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

  function handleSendToContact(c: Contact) {
    triggerHaptic("selection");
    setSendPrefill({ destination: c.address });
    setSendOpen(true);
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
      { id: "converter", label: "Live Currency Converter / Calculator", run: () => setConverterOpen(true) },
      { id: "stats", label: "Live Network Status", run: () => setNetworkStatsOpen(true) },
      { id: "trezor-suite", label: "Trezor Hardware Suite (Safe 3 / Model T / Model One)", run: () => setTrezorModalOpen(true) },
      { id: "shortcuts", label: "Keyboard Shortcuts", run: () => setShortcutsOpen(true) },
      { id: "rename-account", label: "Rename Active Account", hint: activeAccount?.label, run: () => setRenamingAccount(activeAccount) },
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
        label: "Backup & recovery wizard",
        run: () => setBackupWizardOpen(true),
      },
      { id: "phrase", label: "Reveal recovery phrase or secret key", run: () => setBackupWizardOpen(true) },
      { id: "accounts", label: "Manage accounts", run: () => openSettings("accounts") },
      { id: "multisig", label: "Multi-Sig Studio (signers & co-signing)", run: () => setMultisigOpen(true) },
      { id: "contacts", label: "Open Contacts", run: () => switchTab("contacts") },
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
    <div className="app-safe-top relative z-10 min-h-screen md:flex md:h-screen md:overflow-hidden">
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

      {/* Pull-to-refresh indicator */}
      {(pullY > 4 || refreshingPull) && (
        <div
          className="pointer-events-none fixed inset-x-0 z-40 flex justify-center transition-opacity"
          style={{
            top: `calc(env(safe-area-inset-top) + ${refreshingPull ? 56 : Math.max(12, pullY * 0.5)}px)`,
            opacity: refreshingPull ? 1 : Math.min(1, pullY / 60),
          }}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-neutral-900/90 shadow-lg backdrop-blur-md">
            <Spinner />
          </span>
        </div>
      )}

                                    {/* Apple Native iPadOS / macOS Desktop Sidebar (Hidden on Mobile) */}
      <aside
        className={`hidden md:flex flex-col shrink-0 border-r border-white/10 bg-white/[0.02] backdrop-blur-3xl sticky top-0 h-screen transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
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
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection");
                setSidebarCollapsed(false);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.08] shadow-sm border border-white/10 text-white hover:bg-white/[0.14] transition-all"
              title="Expand Sidebar"
              aria-label="Expand Sidebar"
            >
              <LogoMark size={20} className="text-white" />
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white/[0.08] shadow-sm border border-white/10">
                  <LogoMark size={20} className="text-white" />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-[15.5px] font-bold tracking-tight text-white leading-tight">
                    Wallet
                  </h1>
                  <p className="truncate text-[10.5px] text-neutral-400 font-medium">
                    Stellar Self-Custody
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
            {!sidebarCollapsed && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection");
                  setPaletteOpen(true);
                }}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] font-medium text-neutral-400 bg-white/[0.04] hover:bg-white/[0.08] hover:text-white transition-all mb-2 border border-white/5"
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
              className={`group relative flex w-full items-center rounded-xl transition-all ${
                sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "justify-between px-3 py-2"
              } text-[13.5px] font-semibold ${
                view === "home"
                  ? "bg-[#0A84FF] text-white shadow-sm"
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
              className={`group relative flex w-full items-center rounded-xl transition-all ${
                sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "justify-between px-3 py-2"
              } text-[13.5px] font-semibold ${
                view === "activity"
                  ? "bg-[#0A84FF] text-white shadow-sm"
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
              className={`group relative flex w-full items-center rounded-xl transition-all ${
                sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3 py-2"
              } text-[13.5px] font-semibold ${
                view === "swap"
                  ? "bg-[#0A84FF] text-white shadow-sm"
                  : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
              }`}
              title={sidebarCollapsed ? "DEX Swap (⌘3)" : undefined}
            >
              <IconSwap size={18} />
              {!sidebarCollapsed && <span>DEX Swap</span>}
            </button>

            <button
              type="button"
              onClick={() => switchTab("contacts")}
              className={`group relative flex w-full items-center rounded-xl transition-all ${
                sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "justify-between px-3 py-2"
              } text-[13.5px] font-semibold ${
                view === "contacts"
                  ? "bg-[#0A84FF] text-white shadow-sm"
                  : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
              }`}
              title={sidebarCollapsed ? "Contacts (⌘4)" : undefined}
            >
              <div className="flex items-center gap-2.5">
                <IconBook size={18} />
                {!sidebarCollapsed && <span>Contacts</span>}
              </div>
              {!sidebarCollapsed && contacts.length > 0 && (
                <span className="mono text-[11px] font-normal opacity-80">{contacts.length}</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => openSettings("root")}
              className={`group relative flex w-full items-center rounded-xl transition-all ${
                sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3 py-2"
              } text-[13.5px] font-semibold ${
                view === "settings"
                  ? "bg-[#0A84FF] text-white shadow-sm"
                  : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
              }`}
              title={sidebarCollapsed ? "Settings (⌘5)" : undefined}
            >
              <IconGear size={18} />
              {!sidebarCollapsed && <span>Settings</span>}
            </button>

            {/* Accounts Subgroup (Zero Outer Borders) */}
            {!sidebarCollapsed ? (
              <div className="pt-3 space-y-1">
                <div className="flex items-center justify-between px-2 pb-0.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                    Accounts ({accounts.length})
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTrezorModalOpen(true)}
                      className="text-[11px] font-semibold text-emerald-400 hover:underline flex items-center gap-1"
                      title="Open Trezor Hardware Suite"
                    >
                      <IconTrezor size={12} />
                      <span>Trezor</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddAccountOpen(true)}
                      className="text-[11.5px] font-semibold text-[#0A84FF] hover:underline"
                    >
                      + Add
                    </button>
                  </div>
                </div>

                <div className="space-y-0.5">
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
                        className={`flex w-full items-center rounded-xl px-2.5 py-2 text-left transition-colors ${
                          isActive
                            ? "bg-white/[0.09] text-white font-medium shadow-sm"
                            : "text-neutral-300 hover:bg-white/[0.04] hover:text-white"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <Avatar seed={acct.publicKey} size={24} />
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
                                : `${fmtAmount(accountBalances[acct.publicKey] ?? 0)} XLM`}
                            </p>
                          </div>
                        </div>
                        {/* Fiat value at the end of the row (Trezor Suite style) */}
                        <FiatValue
                          amount={accountBalances[acct.publicKey] ?? 0}
                          code="XLM"
                          prefix=""
                          className="mono shrink-0 pl-2 text-[11.5px] font-semibold text-neutral-300"
                        />
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
                  onClick={() => setAddAccountOpen(true)}
                  className="flex h-9 w-9 items-center justify-center rounded-2xl border border-dashed border-white/20 text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors mt-1"
                  title="Add Account"
                >
                  <IconPlus size={14} />
                </button>
              </div>
            )}
          </nav>
        </div>

        {/* Footer Controls */}
        <div className={`border-t border-white/[0.08] shrink-0 w-full ${sidebarCollapsed ? "p-2.5" : "p-4 space-y-2"}`}>
          {!sidebarCollapsed ? (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
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
                  <button
                    type="button"
                    className="icon-btn !h-8 !w-8"
                    onClick={() => {
                      triggerHaptic("selection");
                      setConverterOpen(true);
                    }}
                    title="Live Currency Converter & Calculator"
                  >
                    <IconCalculator size={15} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection");
                    setNetworkModalOpen(true);
                  }}
                  className="cursor-pointer transition-transform active:scale-95"
                  title="Switch Network"
                >
                  <NetworkBadge network={network} />
                </button>
              </div>

              {installEvt && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection");
                    void installEvt.prompt();
                    setInstallEvt(null);
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#0A84FF]/15 py-2 text-[12px] font-semibold text-[#0A84FF] hover:bg-[#0A84FF]/25 transition-colors"
                >
                  ⬇ <span>Install App</span>
                </button>
              )}

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
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                className="icon-btn !h-9 !w-9"
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
                className="icon-btn !h-9 !w-9"
                onClick={() => {
                  triggerHaptic("selection");
                  setNetworkModalOpen(true);
                }}
                title={`Network: ${network}`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: network === "mainnet" ? "#30d158" : "#ff9f0a" }}
                />
              </button>
              <button
                type="button"
                className="icon-btn !h-9 !w-9 hover:!text-[#FF453A]"
                onClick={() => {
                  triggerHaptic("warning");
                  lock();
                }}
                title="Lock Wallet"
              >
                <IconLock size={16} />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main data-app-scroll-owner className="flex-1 min-w-0 md:h-screen md:overflow-y-auto">
        {/* Desktop macOS Top Window Header Bar */}
        <header className="hidden md:flex h-[64px] shrink-0 items-center justify-between px-8 border-b border-white/[0.08] bg-white/[0.01] sticky top-0 z-20 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <h2 className="text-[20px] font-bold text-white tracking-tight">
              {view === "home" ? "Wallet Overview" : view === "swap" ? "In-App DEX Swap" : view === "contacts" ? "Contacts" : view.charAt(0).toUpperCase() + view.slice(1)}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {/* Live Horizon Latency Indicator */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection");
                setNetworkStatsOpen(true);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-[11px] font-mono text-neutral-300 transition-colors cursor-pointer"
              title="View observed network status"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: nodePing !== null ? "#30d158" : "#ff9f0a" }}
              />
              <span>{nodePing !== null ? `${nodePing}ms` : "Unavailable"}</span>
            </button>

            <div className="search-field !py-1.5 !px-3 w-64">
              <IconSearch size={14} className="text-neutral-400 shrink-0" />
              <input
                placeholder="Search assets, activity…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-transparent text-base text-white outline-none placeholder:text-neutral-500 sm:text-[13px]"
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
          </div>
        </header>
        {/* Mobile Sticky Nav bar (Hidden on Desktop) */}
        <div className={`md:hidden sticky top-0 z-30 transition-all ${scrolled ? "nav-blur" : ""}`}>
          <div className="mx-auto w-full max-w-[560px] px-4">
            <div className="flex h-[56px] items-center justify-between">
              <AccountMenu onManageAccounts={() => openSettings("accounts")} onOpenTrezor={() => setTrezorModalOpen(true)} />
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
                    className="w-full bg-transparent text-base text-white outline-none placeholder:text-neutral-500 sm:text-[13.5px]"
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
        <div className="mx-auto w-full max-w-[1200px] min-w-0 px-4 md:px-5 py-4 pb-[150px] md:py-8 md:pb-12">
          {dataError && (
            <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 px-4 py-3 text-[12.5px] text-[#FF9F0A]">
              <span className="flex min-w-0 items-center gap-2">
                <IconAlert size={15} className="shrink-0" />
                <span className="truncate">{dataError}</span>
              </span>
              <button type="button" className="shrink-0 font-semibold hover:underline" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          {view === "settings" ? (
            <SettingsPage key={settingsKey} initialSub={settingsSub} onOpenBackupWizard={() => setBackupWizardOpen(true)} onOpenMultisigStudio={() => setMultisigOpen(true)} />
          ) : view === "swap" ? (
            <SwapPage />
          ) : view === "contacts" ? (
            <AddressBookPage onSendTo={handleSendToContact} />
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
                {/* Live confirmation banner for broadcast-but-unconfirmed txs */}
                {pendingTxs.length > 0 && (
                  <div className="fade-up mb-3 space-y-2">
                    {pendingTxs.map((transaction) => {
                      const presentation = pendingTransactionPresentation(transaction);
                      return (
                        <div
                          key={`${transaction.network}:${transaction.hash}`}
                          className={`rounded-2xl border px-4 py-3 ${
                            presentation.caution
                              ? "border-[#FF9F0A]/35 bg-[#FF9F0A]/10"
                              : "border-[#0A84FF]/30 bg-[#0A84FF]/10"
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            {presentation.caution ? (
                              <IconAlert size={16} className="mt-0.5 shrink-0 text-[#FF9F0A]" />
                            ) : (
                              <Spinner />
                            )}
                            <div className="min-w-0">
                              <p className="text-[12.5px] font-semibold text-white">
                                {presentation.title}
                              </p>
                              <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-300">
                                {presentation.detail}
                              </p>
                              <p className="mt-1 break-all font-mono text-[10px] text-neutral-500">
                                {transaction.network} · {transaction.hash}
                              </p>
                              {presentation.manualCheck && (
                                <Button
                                  variant="secondary"
                                  className="mt-2 !min-h-8 !px-3 !py-1 text-[11px]"
                                  onClick={() => retryPendingTransaction(transaction)}
                                >
                                  Check Status
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

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
                      disabled={claimingAll || pendingAirdropClaim}
                      onClick={() => void handleClaimAllAirdrops()}
                    >
                      Claim All
                    </Button>
                  </div>
                )}

                {/* Hero Total Balance */}
                <section className="panel fade-up flex flex-col items-center p-6 text-center">
                  {accounts.length > 1 && (
                <div className="mb-3 flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-0.5">
                  {(
                    [
                      { id: "active", label: activeAccount?.label ?? "Active" },
                      { id: "all", label: `All (${accounts.length})` },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        triggerHaptic("selection");
                        setPortfolioView(opt.id);
                      }}
                      className={`max-w-[160px] truncate rounded-full px-3 py-1 text-[11.5px] font-semibold transition-all ${
                        portfolioView === opt.id
                          ? "bg-[#0A84FF] text-white shadow-sm"
                          : "text-neutral-400 hover:text-white"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[13px] font-semibold text-neutral-400">Total Portfolio</p>
                  <h2 className="mt-1.5 text-[44px] sm:text-[54px] font-bold leading-none tracking-tight text-white">
                    {balances === null ? (
                      <span className="skeleton inline-block h-[48px] w-60 rounded-2xl align-middle" />
                    ) : privacyMode ? (
                      "••••••"
                    ) : (
                      fmtAmount(heroXlm)
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
                        <span>≈ {fmtFiat(heroUsd ?? 0, fiatCurrency, fiatRates)}</span>
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

                  {/* Primary Actions — iOS-style circular quick actions */}
                  <div className="mt-8 flex w-full max-w-[360px] items-start justify-between px-4">
                    <ActionButton
                      icon={<IconSend size={21} />}
                      label="Send"
                      primary
                      disabled={activeAccount?.watchOnly === true}
                      onClick={() => {
                        setSendPrefill(null);
                        setSendOpen(true);
                      }}
                    />
                    <ActionButton
                      icon={<IconArrowDownLeft size={21} />}
                      label="Receive"
                      onClick={() => setReceiveOpen(true)}
                    />
                    <ActionButton
                      icon={<IconSwap size={21} />}
                      label="Swap"
                      onClick={() => switchTab("swap")}
                    />
                    <ActionButton
                      icon={<IconPlus size={21} />}
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
                      const known = lookupKnownAsset(asset.code, asset.issuer, network);
                      const hue = assetHue(asset.key);
                      const isPinned = pinnedAssets.includes(asset.key);
                      return (
                        <div
                          key={asset.key}
                          className={`group row-hover flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left ${
                            i > 0 ? "ios-sep" : ""
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => togglePinAsset(asset.key)}
                            className={`h-7 w-7 shrink-0 rounded-lg flex items-center justify-center text-[13px] transition-all ${
                              isPinned
                                ? "text-[#FFD60A] opacity-100"
                                : "text-neutral-600 opacity-0 group-hover:opacity-100 hover:text-neutral-300"
                            }`}
                            title={isPinned ? "Unpin asset" : "Pin asset to top"}
                          >
                            ★
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic("selection");
                              setDetailAsset(asset);
                            }}
                            className="flex-1 min-w-0 flex items-center gap-3.5 text-left py-1"
                          >
                            {(() => {
                              const logoUrl =
                                !asset.isNative && asset.issuer
                                ? assetLogos[
                                    assetMetadataCacheKey(
                                      asset.code,
                                      asset.issuer,
                                      getHorizonUrl(network),
                                    )
                                  ]
                                : undefined;
                              const bgStyle = known
                                ? { background: known.color }
                                : asset.isNative
                                  ? { background: "linear-gradient(135deg, #0A84FF, #5E5CE6)" }
                                  : {
                                      background: `linear-gradient(135deg, hsl(${hue}, 70%, 45%), hsl(${(hue + 60) % 360}, 70%, 35%))`,
                                    };
                              if (logoUrl) {
                                return (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={logoUrl}
                                    alt=""
                                    width={36}
                                    height={36}
                                    className="h-9 w-9 shrink-0 rounded-full object-cover shadow-inner"
                                  />
                                );
                              }
                              return (
                                <span
                                  className="mono flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-inner"
                                  style={bgStyle}
                                >
                                  {asset.code.slice(0, 3)}
                                </span>
                              );
                            })()}

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

                            {asset.isNative && priceData?.points && priceData.points.length > 5 && (
                            <div className="hidden sm:flex items-center gap-2 mr-2 shrink-0">
                              <Sparkline
                                values={priceData.points.slice(-12).map((p) => p.p)}
                                width={54}
                                height={22}
                                color={(priceData.changePct ?? 0) >= 0 ? "#30D158" : "#FF453A"}
                              />
                              {asset.isNative && priceData && (
                                <span
                                  className="mono text-[10.5px] font-semibold rounded px-1.5 py-0.5"
                                  style={{
                                    color: (priceData.changePct ?? 0) >= 0 ? "#30D158" : "#FF453A",
                                    background: (priceData.changePct ?? 0) >= 0 ? "rgba(48,209,88,0.14)" : "rgba(255,69,58,0.14)",
                                  }}
                                >
                                  {(priceData.changePct ?? 0) >= 0 ? "+" : ""}{priceData.changePct.toFixed(1)}%
                                </span>
                              )}
                            </div>
                            )}

                            <span className="text-right">
                              <span className="mono block text-[15.5px] font-medium leading-tight text-white">
                                {privacyMode ? "••••••" : fmtAmount(asset.balance)}
                              </span>
                              {asset.isNative && !privacyMode && xlmPriceUsd !== null && (
                                <span className="block text-[12px] leading-tight text-neutral-400">
                                  {fmtFiat(parseFloat(asset.balance) * xlmPriceUsd, fiatCurrency, fiatRates)}
                                </span>
                              )}
                            </span>
                            <Chevron />
                          </button>
                        </div>
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
                        const presentedAsset = activityAssetPresentation(item);
                        const presentedAmount = formatActivityAmount(item);
                        const matchedContact = contacts.find((c) => c.address === item.counterparty);
                        const fiatValue = privacyMode ? null : activityFiat(item);
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
                                  {presentedAsset.issuerDisplay
                                    ? ` · ${presentedAsset.issuerDisplay}`
                                    : ""}
                                </p>
                              </div>
                            </div>
                            {item.amount !== null && (
                              <span className="shrink-0 text-right">
                                <span
                                  className="mono block text-[13px] font-medium leading-tight"
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
                                    : `${presentedAmount}${presentedAsset.code ? ` ${presentedAsset.code}` : ""}`}
                                </span>
                                {fiatValue !== null && (
                                  <span className="block text-[10.5px] leading-tight text-neutral-500">
                                    ≈ {fmtFiat(fiatValue, fiatCurrency, fiatRates)}
                                  </span>
                                )}
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
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pb-2.5 pt-1">
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

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection");
                      setHideActivityDust((d) => !d);
                    }}
                    title="Hide payments below 0.1 (spam dust)"
                    className={`shrink-0 text-[12px] font-medium transition-colors ${
                      hideActivityDust
                        ? "text-[#0A84FF] font-semibold"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    {hideActivityDust ? "Dust Hidden" : "Hide Dust"}
                  </button>

                  {/* Asset Code Filter */}
                  <Select
                    size="sm"
                    value={activityAssetFilter}
                    onChange={setActivityAssetFilter}
                    ariaLabel="Filter by asset"
                    className="mono !h-7 !py-0 !px-2 text-[11.5px] !bg-white/[0.04] !text-neutral-300"
                    options={[
                      { value: "all", label: "All Assets" },
                      ...activityAssetOptions,
                    ]}
                  />

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
                          const presentedAsset = activityAssetPresentation(item);
                          const presentedAmount = formatActivityAmount(item);
                          const matchedContact = contacts.find((c) => c.address === item.counterparty);
                          const fiatValue = privacyMode ? null : activityFiat(item);
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
                                  {presentedAsset.issuerDisplay
                                    ? ` · ${presentedAsset.issuerDisplay}`
                                    : ""}
                                </span>
                              </span>
                              {item.amount !== null && (
                                <span className="shrink-0 text-right">
                                  <span
                                    className="mono block text-[15px] font-medium leading-tight"
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
                                      : `${presentedAmount}${presentedAsset.code ? ` ${presentedAsset.code}` : ""}`}
                                  </span>
                                  {fiatValue !== null && (
                                    <span className="block text-[11.5px] leading-tight text-neutral-500">
                                      ≈ {fmtFiat(fiatValue, fiatCurrency, fiatRates)}
                                    </span>
                                  )}
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

              {/* Infinite-scroll sentinel — forever scroll, no button */}
              {activityCursor && (
                <div ref={activitySentinelRef} className="flex justify-center py-5">
                  {loadingMore && <Spinner size={18} />}
                </div>
              )}
              {!activityCursor && filteredActivity.length > 0 && (
                <p className="py-5 text-center text-[11.5px] text-neutral-500">
                  You&rsquo;re all caught up
                </p>
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
          className={`tab-item ${view === "contacts" ? "active" : ""}`}
          onClick={() => switchTab("contacts")}
        >
          <IconBook size={22} />
          <span>Contacts</span>
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
      <AssetDetailModal
        key={`${network}:${detailAsset?.key ?? "closed"}`}
        asset={detailAsset}
        onClose={() => setDetailAsset(null)}
      />
      <TxDetailModal key={txDetail?.hash ?? "closed"} item={txDetail} onClose={() => setTxDetail(null)} />
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <NetworkStatsModal open={networkStatsOpen} onClose={() => setNetworkStatsOpen(false)} />
      <TrezorModal open={trezorModalOpen} onClose={() => setTrezorModalOpen(false)} />
      <RenameAccountModal
        account={renamingAccount}
        onClose={() => setRenamingAccount(null)}
      />
      <CurrencyConverterModal
        open={converterOpen}
        onClose={() => setConverterOpen(false)}
        onOpenSwap={() => switchTab("swap")}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
      />
      <NetworkModal
        open={networkModalOpen}
        onClose={() => setNetworkModalOpen(false)}
        network={network}
        onSwitch={switchNetwork}
      />
      <AddAccountModal open={addAccountOpen} onClose={() => setAddAccountOpen(false)} />
      <BackupWizardModal open={backupWizardOpen} onClose={() => setBackupWizardOpen(false)} />
      <MultiSigStudioModal open={multisigOpen} onClose={() => setMultisigOpen(false)} />
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
  primary = false,
  disabled = false,
}: {
  icon: React.ReactNode;
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
        triggerHaptic("selection");
        playTapSound();
        onClick();
      }}
      className="group flex w-[68px] flex-col items-center gap-2 outline-none disabled:cursor-not-allowed"
    >
      <span
        className={`flex h-[60px] w-[60px] items-center justify-center rounded-full transition-all duration-250 ease-[cubic-bezier(0.34,1.4,0.64,1)] group-focus-visible:ring-2 group-focus-visible:ring-white/60 group-active:scale-[0.84] group-active:duration-[90ms] ${
          primary
            ? "bg-gradient-to-b from-[#2f94ff] to-[#0a7aff] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_1px_rgba(0,0,0,0.15),0_10px_26px_-8px_rgba(10,132,255,0.6)] group-hover:brightness-110"
            : "border border-white/[0.1] bg-white/[0.07] text-neutral-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_10px_22px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl group-hover:border-white/[0.16] group-hover:bg-white/[0.12]"
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

function NetworkModal({
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
  if (!open) return null;
  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        title="Switch Network"
        subtitle="Select active Stellar blockchain environment"
        onClose={onClose}
      />
      <div className="space-y-4 p-4 sm:p-6">
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
              onClick={() => {
                triggerHaptic("selection");
                onSwitch(n.id);
                onClose();
              }}
              className={`flex w-full items-start justify-between rounded-2xl border p-4 text-left transition-all ${
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
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0A84FF] text-white shrink-0">
                  <IconCheck size={11} />
                </span>
              )}
            </button>
          );
        })}
        <Button variant="ghost" className="w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

function AccountMenu({
  onManageAccounts,
  onOpenTrezor,
  compact = false,
}: {
  onManageAccounts: () => void;
  onOpenTrezor?: () => void;
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
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] hover:bg-white/[0.12] active:scale-95 py-1 pl-1.5 pr-3 shadow-sm transition-all cursor-pointer"
          >
            <Avatar seed={activeAccount.publicKey} size={28} />
            <span className="text-left min-w-0 max-w-[110px]">
              <span className="block truncate text-[13.5px] font-semibold leading-tight text-white">
                {activeAccount.label}
              </span>
              <span className="mono block truncate text-[10.5px] text-neutral-400">
                {shortenAddr(activeAccount.publicKey, 4, 4)}
              </span>
            </span>
            <IconChevronDown size={11} className="text-neutral-400 shrink-0 ml-0.5" />
          </button>
        )
      }
    >
      {(close) => (
        <div className="p-1 space-y-1">
          <p className="px-3 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">
            Switch Account
          </p>
          {accounts.map((acct) => {
            const isActive = acct.id === activeAccount.id;
            return (
              <button
                key={acct.id}
                type="button"
                className={`menu-item !rounded-xl !py-2 !px-3 ${
                  isActive ? "bg-white/[0.08] text-white font-semibold" : ""
                }`}
                onClick={() => {
                  triggerHaptic("selection");
                  selectAccount(acct.id);
                  close();
                }}
              >
                <Avatar seed={acct.publicKey} size={24} />
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
                    {shortenAddr(acct.publicKey, 4, 4)}
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
            className="menu-item !rounded-xl !py-2 !px-3"
            onClick={() => {
              triggerHaptic("selection");
              if (onOpenTrezor) onOpenTrezor();
              close();
            }}
          >
            <IconTrezor size={14} className="text-emerald-400" /> <span>Trezor Hardware Suite</span>
          </button>
          <button
            type="button"
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
        Stellar accounts must meet the network&apos;s current minimum balance to exist on-chain.{" "}
        {network === "testnet"
          ? "On testnet, Friendbot will fund your account with 10,000 free test XLM instantly."
          : "On mainnet, transfer enough XLM from an existing wallet to cover the live reserve and transaction fees."}
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
  const {
    priceData,
    priceRange,
    changePriceRange,
    priceLoading,
    accountBalances,
    accounts,
    activeAccount,
    network,
    fiatCurrency,
    fiatRates,
  } = useWallet();
  const ranges: PriceRangeT[] = ["1D", "7D", "1M", "1Y"];
  const [chartMode, setChartMode] = useState<"market" | "portfolio">("market");

  const totalAllXlm = useMemo(
    () => Object.values(accountBalances).reduce((sum, n) => sum + n, 0),
    [accountBalances],
  );
  const canShowPortfolio = network === "mainnet" && totalAllXlm > 0 && priceData !== null;
  const mode = canShowPortfolio ? chartMode : "market";

  // Portfolio series: your total balance × historical XLM price
  const portfolioPoints = useMemo(
    () =>
      priceData && canShowPortfolio
        ? priceData.points.map((pt) => ({ t: pt.t, p: pt.p * totalAllXlm }))
        : [],
    [priceData, canShowPortfolio, totalAllXlm],
  );

  const headerLabel =
    mode === "portfolio"
      ? `Your Portfolio · ${accounts.length > 1 ? `${accounts.length} accounts` : activeAccount?.label ?? ""}`
      : "XLM Market";

  const currentValue =
    mode === "portfolio"
      ? portfolioPoints.length > 0
        ? portfolioPoints[portfolioPoints.length - 1].p
        : null
      : priceData?.current ?? null;

  const changePct =
    mode === "portfolio"
      ? (() => {
          if (portfolioPoints.length < 2 || currentValue === null) return null;
          const firstP = portfolioPoints[0].p;
          if (!firstP) return null;
          return ((currentValue - firstP) / firstP) * 100;
        })()
      : priceData?.changePct ?? null;

  const up = (changePct ?? 0) >= 0;

  return (
    <section className="panel fade-up relative p-5">
      {/* Mode toggle */}
      {canShowPortfolio && (
        <div className="mb-3 flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-0.5">
          {(
            [
              { id: "market", label: "Market" },
              { id: "portfolio", label: "Your Portfolio" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                triggerHaptic("selection");
                setChartMode(opt.id);
              }}
              className={`flex-1 rounded-full px-3 py-1 text-[11.5px] font-semibold transition-all ${
                mode === opt.id
                  ? "bg-[#0A84FF] text-white shadow-sm"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-neutral-400">{headerLabel}</p>
          <div className="mt-0.5 flex flex-nowrap items-center gap-2.5">
            <span className="whitespace-nowrap text-[24px] font-bold tracking-tight text-white">
              {mode === "portfolio" && currentValue !== null
                ? fmtUsd(currentValue)
                : priceData
                  ? fmtUsd(priceData.current)
                  : "—"}
            </span>
            {mode === "portfolio"
              ? currentValue !== null && fiatCurrency !== "USD" && (
                  <span className="mono shrink-0 whitespace-nowrap text-[12px] text-neutral-400">
                    ≈ {fmtFiat(currentValue, fiatCurrency, fiatRates)}
                  </span>
                )
              : null}
            {changePct !== null && (
              <span
                className="shrink-0 whitespace-nowrap rounded-lg px-2 py-0.5 text-[12px] font-semibold"
                style={{
                  color: up ? "#30D158" : "#FF453A",
                  background: up ? "rgba(48,209,88,0.15)" : "rgba(255,69,58,0.15)",
                }}
              >
                {up ? "+" : ""}
                {changePct.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3">
        {mode === "portfolio" && portfolioPoints.length > 1 ? (
          <PriceChart points={portfolioPoints} range={priceRange} />
        ) : priceData && priceData.points.length > 1 ? (
          <PriceChart points={priceData.points} range={priceRange} />
        ) : (
          <div className="skeleton h-[140px] w-full rounded-2xl" />
        )}
      </div>
      {/* Range selector — own full-width row under the chart (iOS Stocks style),
          so the header can never wrap and change height between tabs */}
      <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-white/[0.06] p-1">
        {ranges.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => {
              triggerHaptic("selection");
              void changePriceRange(r);
            }}
            className={`rounded-lg px-2.5 py-1 text-center text-[12px] font-semibold transition-all ${
              priceRange === r ? "bg-white/[0.18] text-white shadow-sm" : "text-neutral-400 hover:text-white"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      {/* Reserved footer slot — identical height in both tab modes */}
      <p className="mt-2 flex h-[16px] items-center text-[10.5px] text-neutral-500">
        {mode === "portfolio"
          ? "Estimated from your current balance × historical XLM price."
          : ""}
      </p>
      {priceLoading && (
        <p className="pointer-events-none absolute bottom-3.5 right-4 text-[10px] text-neutral-500">
          Updating…
        </p>
      )}
    </section>
  );
}
