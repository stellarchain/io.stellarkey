"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@/hooks/useWallet";
import { useMerchantRuntime, useMerchantShell } from "@/hooks/useMerchantRuntime";
import { NETWORKS } from "@/lib/stellar";
import {
  getHorizonUrl,
  STELLAR_ENDPOINTS_CHANGED_EVENT,
  testHorizonEndpoint,
} from "@/lib/stellar-endpoints";
import { lookupKnownAsset } from "@/lib/assets";
import { assetMetadataCacheKey, fetchAssetLogo, getCachedAssetLogo } from "@/lib/toml";
import { parseSep7PayUri } from "@/lib/payuri";
import {
  fmtAmount,
  fmtFiat,
  fmtUsd,
  activityAmountLines,
  generateActivityCsv,
  timeAgo,
  type FiatCurrency,
} from "@/lib/format";
import { formatTrezorAddress } from "@/lib/address-display";
import type { AccountMeta, ActivityItem, AssetBalance } from "@/lib/types";
import type { PriceRange as PriceRangeT } from "@/lib/api";
import { triggerHaptic } from "@/lib/haptics";
import { fetchAssetPrices, getUnitPrice, type AssetPrices } from "@/lib/prices";
import { aggregatePortfolio, portfolioSnapshotKey } from "@/lib/portfolio";
import { playTapSound } from "@/lib/sounds";
import { activityAssetPresentation } from "@/lib/transaction-intent";
import { pendingTransactionPresentation } from "@/lib/submission";
import {
  getInstallHandoff,
  readIosDevice,
  readStandaloneDisplay,
  type InstallHandoffAction,
} from "@/lib/install-handoff";
import {
  BACKUP_HEALTH_CHANGED_EVENT,
  loadBackupHealth,
} from "@/lib/backup-health";
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
  IconFileText,
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
  IconUsers,
  IconWallet,
  LogoMark,
} from "./icons";
import { IconBars, IconReceipt, IconStorefront, IconTag } from "./merchant/icons";
import { ModeSwitcher, type ShellMode } from "./merchant/ModeSwitcher";
import type { MerchantSub } from "./merchant/MerchantPage";
import type {
  SettlementSwapIntent,
  SettlementSweepIntent,
} from "@/lib/merchant/settlement";
import type { SendPrefill } from "./SendModal";

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
const RenameAccountModal = dynamic(() => import("./RenameAccountModal").then((m) => m.RenameAccountModal), { ssr: false });
const MerchantPage = dynamic(() => import("./merchant/MerchantPage").then((m) => m.MerchantPage), { ssr: false });
const SetupWizard = dynamic(() => import("./merchant/SetupWizard").then((m) => m.SetupWizard), { ssr: false });

type View =
  | "home"
  | "activity"
  | "swap"
  | "contacts"
  | "settings"
  | "merchant"
  | "orders"
  | "catalogue"
  | "invoices"
  | "links"
  | "customers"
  | "insights";

/** The views Merchant Mode owns; everything else is the wallet's. */
const MERCHANT_VIEWS = [
  "merchant",
  "orders",
  "catalogue",
  "invoices",
  "links",
  "customers",
  "insights",
] as const satisfies readonly View[];

function isMerchantView(view: View): boolean {
  return (MERCHANT_VIEWS as readonly View[]).includes(view);
}

/** The till is the shell's "merchant" view; every other merchant view is its own sub. */
function merchantSubForView(view: View): MerchantSub {
  return view === "merchant" || !isMerchantView(view) ? "pos" : (view as MerchantSub);
}

function viewForMerchantSub(sub: MerchantSub): View {
  return sub === "pos" ? "merchant" : sub;
}

/** Window-header title. Merchant views name themselves rather than slugging. */
function desktopViewTitle(view: View): string {
  switch (view) {
    case "home":
      return "Wallet Overview";
    case "swap":
      return "In-App DEX Swap";
    case "contacts":
      return "Contacts";
    case "merchant":
      return "Point of Sale";
    case "orders":
      return "Orders";
    case "catalogue":
      return "Catalogue";
    case "invoices":
      return "Invoices";
    case "links":
      return "Counter codes";
    case "customers":
      return "Customers";
    case "insights":
      return "Insights";
    default:
      return view.charAt(0).toUpperCase() + view.slice(1);
  }
}

function mobileViewTitle(view: View): string {
  switch (view) {
    case "home":
      return "Wallet";
    case "merchant":
      return "Point of Sale";
    case "orders":
      return "Orders";
    case "catalogue":
      return "Catalogue";
    case "invoices":
      return "Invoices";
    case "links":
      return "Counter codes";
    case "customers":
      return "Customers";
    case "insights":
      return "Insights";
    default:
      return view.charAt(0).toUpperCase() + view.slice(1);
  }
}


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
    accountPortfolioSnapshots,
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

  const {
    enabled: merchantEnabled,
    unmatched: merchantUnmatched,
    charges: merchantCharges,
    activeShift: merchantActiveShift,
  } = useMerchantShell();
  const {
    intent: merchantRuntimeIntent,
    requestRuntime,
    consumeIntent: consumeMerchantRuntimeIntent,
    releaseRuntime,
  } = useMerchantRuntime();

  const [storedView, setView] = useState<View>(() =>
    merchantRuntimeIntent === "settings"
      ? "settings"
      : merchantRuntimeIntent === "merchant"
        ? "merchant"
        : "home",
  );
  // The sidebar shows one mode's navigation at a time. Settings is global, so
  // opening it must not knock the sidebar back to the wallet's rows — which is
  // why the mode is held rather than derived from the view.
  const [storedMode, setMode] = useState<ShellMode>(() =>
    merchantRuntimeIntent === "merchant" ? "merchant" : "wallet",
  );
  // Turning Merchant Mode off leaves the shell exactly as it was before it was
  // ever turned on, without a render pass that writes state back.
  const mode: ShellMode = merchantEnabled ? storedMode : "wallet";
  const view: View =
    merchantEnabled || !isMerchantView(storedView) ? storedView : "home";
  const [query, setQuery] = useState("");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [counterpartyFilter, setCounterpartyFilter] = useState<string | null>(null);
  const [hideDust, setHideDust] = useState(false);
  const [hideActivityDust, setHideActivityDust] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [batchSendOpen, setBatchSendOpen] = useState(false);
  const [sendPrefill, setSendPrefill] = useState<SendPrefill | null>(null);
  const [swapPrefill, setSwapPrefill] = useState<SettlementSwapIntent | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [addAssetOpen, setAddAssetOpen] = useState(false);
  const [settingsSub, setSettingsSub] = useState<SettingsSub>("root");
  const [settingsKey, setSettingsKey] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [converterOpen, setConverterOpen] = useState(false);
  const [networkStatsOpen, setNetworkStatsOpen] = useState(false);
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
  const [endpointRevision, setEndpointRevision] = useState(0);
  const [detailAsset, setDetailAsset] = useState<AssetBalance | null>(null);
  const [txDetail, setTxDetail] = useState<ActivityItem | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [fundBusy, setFundBusy] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const [networkModalOpen, setNetworkModalOpen] = useState(false);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installEnvironment, setInstallEnvironment] = useState({ ios: false, standalone: false });
  const [backupExported, setBackupExported] = useState(false);
  const [installDialog, setInstallDialog] = useState<InstallHandoffAction | null>(null);
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
  // Mounted on the shell, not inside Settings: turning Merchant Mode on
  // re-renders the toggle's own row, and a wizard owned by that row would be
  // torn down in the same pass that asked for it.
  const [setupWizardOpen, setSetupWizardOpen] = useState(
    () => merchantRuntimeIntent === "setup",
  );
  // The shift sheet lives in MerchantPage; the shell holds the flag so the
  // desktop sidebar and the command palette can open that same sheet.
  const [shiftOpen, setShiftOpen] = useState(false);
  const pendingAirdropClaim = pendingTxs.some(
    (transaction) => transaction.label === "Airdrop claim",
  );

  useEffect(() => {
    if (!merchantRuntimeIntent) return;
    const timer = window.setTimeout(consumeMerchantRuntimeIntent, 0);
    return () => window.clearTimeout(timer);
  }, [consumeMerchantRuntimeIntent, merchantRuntimeIntent]);

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

  const valuationBalances = useMemo(() => {
    const exactAssets = new Map<string, AssetBalance>();
    for (const balance of balances ?? []) exactAssets.set(balance.key, balance);
    for (const snapshot of Object.values(accountPortfolioSnapshots)) {
      if (snapshot.network !== network || snapshot.status !== "ready") continue;
      for (const balance of snapshot.balances ?? []) exactAssets.set(balance.key, balance);
    }
    return [...exactAssets.values()];
  }, [accountPortfolioSnapshots, balances, network]);

  // Testnet tokens have no monetary value, even when they reuse a production code.
  useEffect(() => {
    if (network !== "mainnet" || valuationBalances.length === 0) {
      return;
    }
    let alive = true;
    void (async () => {
      const pricedAssets = valuationBalances
        .filter((b) => !b.isNative && b.issuer !== null && parseFloat(b.balance) > 0)
        .map((b) => ({ code: b.code, issuer: b.issuer, network }));
      const prices = await fetchAssetPrices(pricedAssets);
      if (alive && Object.keys(prices).length > 0) setAssetPrices(prices);

      // Resolve custom-asset logos concurrently, then publish one React state
      // update so a page of trustlines does not render once per TOML response.
      const customAssets = (balances ?? []).filter(
        (b): b is AssetBalance & { issuer: string } =>
          !b.isNative && b.issuer !== null && !lookupKnownAsset(b.code, b.issuer, network),
      );
      const horizonUrl = getHorizonUrl(network);
      const resolvedLogos = await Promise.all(customAssets.map(async (asset) => ({
        key: assetMetadataCacheKey(asset.code, asset.issuer, horizonUrl),
        url: getCachedAssetLogo(asset.code, asset.issuer, horizonUrl) ??
          await fetchAssetLogo(asset.code, asset.issuer, horizonUrl),
      })));
      if (alive) {
        setAssetLogos((previous) => {
          const next = { ...previous };
          let changed = false;
          for (const { key, url } of resolvedLogos) {
            if (url && next[key] !== url) {
              next[key] = url;
              changed = true;
            }
          }
          return changed ? next : previous;
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [network, balances, valuationBalances]);

  // PWA install prompt capture
  useEffect(() => {
    function onInstallPrompt(e: Event) {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onInstallPrompt);
  }, []);

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const updateEnvironment = () => {
      setInstallEnvironment({ ios: readIosDevice(), standalone: readStandaloneDisplay() });
    };
    const updateBackupHealth = () => {
      setBackupExported(Boolean(loadBackupHealth()?.lastExportedAt));
    };
    updateEnvironment();
    updateBackupHealth();
    displayMode.addEventListener?.("change", updateEnvironment);
    window.addEventListener(BACKUP_HEALTH_CHANGED_EVENT, updateBackupHealth);
    window.addEventListener("storage", updateBackupHealth);
    return () => {
      displayMode.removeEventListener?.("change", updateEnvironment);
      window.removeEventListener(BACKUP_HEALTH_CHANGED_EVENT, updateBackupHealth);
      window.removeEventListener("storage", updateBackupHealth);
    };
  }, []);

  const installHandoff = getInstallHandoff({
    standalone: installEnvironment.standalone,
    ios: installEnvironment.ios,
    nativePromptAvailable: Boolean(installEvt),
    backupExported,
  });

  function handleInstallApp() {
    triggerHaptic("selection");
    if (installHandoff.action === "backup-first" || installHandoff.action === "ios-guide") {
      setInstallDialog(installHandoff.action);
      return;
    }
    if (!installEvt || installHandoff.action !== "native-prompt") return;
    void installEvt.prompt();
    setInstallEvt(null);
  }

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
        const result = await testHorizonEndpoint(network, getHorizonUrl(network), { timeoutMs: 4_000 });
        if (alive) setNodePing(result.latencyMs);
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
  }, [network, endpointRevision]);

  useEffect(() => {
    const refreshEndpoint = () => setEndpointRevision((revision) => revision + 1);
    const refreshStoredEndpoint = (event: StorageEvent) => {
      if (event.key?.startsWith("wallet.endpoint.") || event.key?.startsWith("wallet.horizon.")) {
        refreshEndpoint();
      }
    };
    window.addEventListener(STELLAR_ENDPOINTS_CHANGED_EVENT, refreshEndpoint);
    window.addEventListener("storage", refreshStoredEndpoint);
    return () => {
      window.removeEventListener(STELLAR_ENDPOINTS_CHANGED_EVENT, refreshEndpoint);
      window.removeEventListener("storage", refreshStoredEndpoint);
    };
  }, []);

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
      } else if ((e.metaKey || e.ctrlKey) && e.key === "6") {
        if (!merchantEnabled) return;
        e.preventDefault();
        switchTab("merchant");
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
  }, [accounts, selectAccount, togglePrivacy, lock, merchantEnabled]);

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
  const activePortfolio = useMemo(() => {
    if (!activeAccount) {
      return aggregatePortfolio({
        accounts: [],
        snapshots: {},
        network,
        xlmPriceUsd,
        assetPrices,
      });
    }
    const key = portfolioSnapshotKey(network, activeAccount.publicKey);
    const snapshots = balances === null
      ? accountPortfolioSnapshots
      : {
          ...accountPortfolioSnapshots,
          [key]: {
            publicKey: activeAccount.publicKey,
            network,
            status: "ready" as const,
            balances,
            updatedAt: accountPortfolioSnapshots[key]?.updatedAt ?? null,
            error: null,
          },
        };
    return aggregatePortfolio({
      accounts: [activeAccount.publicKey],
      snapshots,
      network,
      xlmPriceUsd,
      assetPrices,
    });
  }, [accountPortfolioSnapshots, activeAccount, assetPrices, balances, network, xlmPriceUsd]);
  const usdValue = activePortfolio.totalUsd;

  const allPortfolio = useMemo(
    () => aggregatePortfolio({
      accounts: accounts.map((account) => account.publicKey),
      snapshots: accountPortfolioSnapshots,
      network,
      xlmPriceUsd,
      assetPrices,
    }),
    [accountPortfolioSnapshots, accounts, assetPrices, network, xlmPriceUsd],
  );
  const allPortfolioReady = allPortfolio.completeness === "complete";
  const heroXlm = portfolioView === "all"
    ? allPortfolio.nativeBalance
    : xlm?.balance ?? "0.0000000";
  const heroUsd =
    portfolioView === "all"
      ? allPortfolio.totalUsd
      : usdValue;
  const heroLoading = portfolioView === "all"
    ? allPortfolio.completeness === "loading"
    : balances === null && !dataError;
  const heroUnavailable = portfolioView === "all"
    ? allPortfolio.completeness === "partial"
    : balances === null && Boolean(dataError);
  const heroReady = portfolioView === "all" ? allPortfolioReady : balances !== null;
  const heroDisplayAmount = privacyMode ? "••••••" : fmtAmount(heroXlm ?? "0.0000000");
  const heroBalanceDensity = heroDisplayAmount.length >= 18
    ? "long"
    : heroDisplayAmount.length >= 13
      ? "medium"
      : "compact";

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
      if (activityFilter === "swap" && !a.swap) return false;
      if (activityFilter === "trust" && a.type !== "change_trust") return false;
      if (activityAssetFilter !== "all") {
        const assetIdentities = [
          activityAssetPresentation(a).identity,
          ...(a.swap
            ? [
                activityAssetPresentation(a.swap.debit).identity,
                activityAssetPresentation(a.swap.credit).identity,
              ]
            : []),
        ];
        if (!assetIdentities.includes(activityAssetFilter)) return false;
      }
      if (hideActivityDust && a.amount !== null && parseFloat(a.amount) < 0.1) return false;

      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        (a.assetCode ?? "").toLowerCase().includes(q) ||
        (a.assetIssuer ?? "").toLowerCase().includes(q) ||
        (a.swap?.debit.assetCode ?? "").toLowerCase().includes(q) ||
        (a.swap?.debit.assetIssuer ?? "").toLowerCase().includes(q) ||
        (a.swap?.credit.assetCode ?? "").toLowerCase().includes(q) ||
        (a.swap?.credit.assetIssuer ?? "").toLowerCase().includes(q) ||
        (a.counterparty ?? "").toLowerCase().includes(q) ||
        a.hash.toLowerCase().includes(q)
      );
    });
  }, [activity, activityFilter, activityAssetFilter, counterpartyFilter, hideActivityDust, q]);

  const activityAssetOptions = useMemo(() => {
    const assets = new Map<string, { value: string; label: string; sublabel?: string }>();
    for (const item of activity) {
      const presentations = [
        activityAssetPresentation(item),
        ...(item.swap
          ? [
              activityAssetPresentation(item.swap.debit),
              activityAssetPresentation(item.swap.credit),
            ]
          : []),
      ];
      for (const presentedAsset of presentations) {
        if (!presentedAsset.identity || !presentedAsset.code) continue;
        if (assets.has(presentedAsset.identity)) continue;
        assets.set(presentedAsset.identity, {
          value: presentedAsset.identity,
          label: presentedAsset.code,
          sublabel: presentedAsset.issuerDisplay ?? "Native",
        });
      }
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
    const hasIncompleteValuation = portfolioView === "all"
      ? allPortfolio.unpricedAssets.length > 0
      : activePortfolio.unpricedAssets.length > 0;
    if (hasIncompleteValuation) return [];
    const allocationBalances = portfolioView === "all"
      ? allPortfolioReady
        ? allPortfolio.assets
        : []
      : balances ?? [];
    if (network !== "mainnet" || allocationBalances.length === 0) return [];
    const valued = allocationBalances.flatMap((balance) => {
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
  }, [activePortfolio.unpricedAssets.length, allPortfolio.assets, allPortfolio.unpricedAssets.length, allPortfolioReady, assetPrices, balances, network, portfolioView, xlmPriceUsd]);

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
    a.download = `stellarkey-activity-${network}-${new Date().toISOString().slice(0, 10)}.csv`;
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

  /**
   * The Settings row. Merchant Mode's own settings are the ones a shop wants
   * from behind the counter, so in merchant mode the row opens Settings →
   * Merchant directly rather than the wallet's root. Nothing is closed off: that
   * sub-page's back button still lands on the settings root, ⌘5 opens it from
   * anywhere, and the palette carries "Wallet settings" too.
   */
  function openSettingsForMode() {
    openSettings(mode === "merchant" ? "merchant" : "root");
  }

  function switchTab(v: View) {
    triggerHaptic("selection");
    if (v === "swap") setSwapPrefill(null);
    setView(v);
    if (isMerchantView(v)) {
      setMode("merchant");
    } else if (v !== "settings") {
      setMode("wallet");
    }
    window.scrollTo({ top: 0 });
  }

  /**
   * The sheet is mounted by MerchantPage, so the counter has to be on screen
   * before it can be shown — a shift opened from Settings would otherwise ask
   * for a sheet nothing is rendering. The current view is read through the
   * setter rather than the render, so a merchant view already open is kept.
   */
  function openShift() {
    triggerHaptic("selection");
    setView((current) => (isMerchantView(current) ? current : "merchant"));
    setMode("merchant");
    setShiftOpen(true);
    window.scrollTo({ top: 0 });
  }

  /** Merchant selects the till, Wallet returns Home. */
  function switchMode(next: ShellMode) {
    switchTab(next === "merchant" ? "merchant" : "home");
  }

  function handleSendToContact(c: Contact) {
    triggerHaptic("selection");
    setSendPrefill({ destination: c.address });
    setSendOpen(true);
  }

  /** Anything on the counter a person still has to deal with. */
  const merchantAttention = useMemo(
    () =>
      merchantUnmatched.length +
      merchantCharges.filter((c) => c.status === "awaiting" && c.network === network).length,
    [merchantCharges, merchantUnmatched.length, network],
  );

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
      { id: "add-account", label: "Add account", run: () => setAddAccountOpen(true) },
      { id: "shortcuts", label: "Keyboard Shortcuts", run: () => setShortcutsOpen(true) },
      { id: "rename-account", label: "Rename Active Account", hint: activeAccount?.label, run: () => setRenamingAccount(activeAccount) },
      { id: "add-asset", label: "Add asset trustline", run: () => setAddAssetOpen(true) },
      {
        id: "copy",
        label: "Copy your address",
        hint: formatTrezorAddress(activeAccount?.publicKey ?? ""),
        run: () => {
          if (activeAccount) void navigator.clipboard.writeText(activeAccount.publicKey);
        },
      },
      ...accounts.map((acc) => ({
        id: `acc-${acc.id}`,
        label: `Switch account: ${acc.label}`,
        hint: formatTrezorAddress(acc.publicKey),
        run: () => selectAccount(acc.id),
      })),
      ...contacts.map((c) => ({
        id: `contact-${c.address}`,
        label: `Send to contact: ${c.name}`,
        hint: formatTrezorAddress(c.address),
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
      { id: "settings", label: "Wallet settings", run: () => openSettings("root") },
      { id: "accounts", label: "Manage accounts", run: () => openSettings("accounts") },
      { id: "multisig", label: "Multi-Sig Studio (signers & co-signing)", run: () => setMultisigOpen(true) },
      { id: "contacts", label: "Open Contacts", run: () => switchTab("contacts") },
      ...(merchantEnabled
        ? [
            {
              id: "merchant-charge",
              label: "New charge",
              hint: "Point of Sale",
              run: () => switchTab("merchant"),
            },
            { id: "merchant-orders", label: "Merchant orders", run: () => switchTab("orders") },
            { id: "merchant-catalogue", label: "Catalogue", run: () => switchTab("catalogue") },
            {
              id: "merchant-invoice",
              label: "New invoice",
              hint: "Invoices",
              run: () => switchTab("invoices"),
            },
            { id: "merchant-links", label: "Counter codes", run: () => switchTab("links") },
            { id: "merchant-customers", label: "Customers", run: () => switchTab("customers") },
            {
              id: "merchant-shift",
              label: merchantActiveShift ? `Shift ${merchantActiveShift.number}` : "Open shift",
              hint: merchantActiveShift
                ? `${merchantActiveShift.terminalName} · ${merchantActiveShift.network}`
                : "Required before taking tender",
              run: openShift,
            },
            { id: "merchant-insights", label: "Merchant insights", run: () => switchTab("insights") },
          ]
        : []),
      { id: "lock", label: "Lock wallet", run: lock },
    ],
    [
      accounts,
      merchantEnabled,
      merchantActiveShift,
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
    <div className="app-safe-dashboard relative z-10 min-h-screen w-full min-w-0 md:flex md:h-screen md:overflow-hidden">
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
        className={`app-safe-sticky-top hidden md:flex flex-col shrink-0 border-r border-white/10 bg-white/[0.02] backdrop-blur-3xl sticky h-screen transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
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
            {/*
              Mode is a higher-level choice than search, and search is scoped to
              the mode you are in — so the switcher sits directly under the app
              header and above the palette button, and the sidebar shows one
              mode's navigation at a time instead of two stacked lists.
            */}
            {merchantEnabled &&
              (sidebarCollapsed ? (
                <button
                  type="button"
                  onClick={() => switchMode(mode === "merchant" ? "wallet" : "merchant")}
                  className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-neutral-300 transition-all hover:bg-white/[0.08] hover:text-white"
                  title={mode === "merchant" ? "Switch to Wallet" : "Switch to Merchant"}
                  aria-label={mode === "merchant" ? "Switch to Wallet" : "Switch to Merchant"}
                >
                  {mode === "merchant" ? (
                    <IconStorefront size={18} className="text-[#30D158]" />
                  ) : (
                    <IconWallet size={18} />
                  )}
                </button>
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

            {mode === "merchant" ? (
              <>
                <button
                  type="button"
                  onClick={() => switchTab("merchant")}
                  className={`group relative flex w-full items-center rounded-xl transition-all ${
                    sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3 py-2"
                  } text-[13.5px] font-semibold ${
                    view === "merchant"
                      ? "bg-[#0A84FF] text-white shadow-sm"
                      : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                  }`}
                  title={sidebarCollapsed ? "Point of Sale (⌘6)" : undefined}
                >
                  <IconStorefront size={18} />
                  {!sidebarCollapsed && <span>Point of Sale</span>}
                </button>

                <button
                  type="button"
                  onClick={() => switchTab("orders")}
                  className={`group relative flex w-full items-center rounded-xl transition-all ${
                    sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "justify-between px-3 py-2"
                  } text-[13.5px] font-semibold ${
                    view === "orders"
                      ? "bg-[#0A84FF] text-white shadow-sm"
                      : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                  }`}
                  title={
                    sidebarCollapsed
                      ? merchantAttention > 0
                        ? `Orders (${merchantAttention} need attention)`
                        : "Orders"
                      : undefined
                  }
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

                <button
                  type="button"
                  onClick={() => switchTab("catalogue")}
                  className={`group relative flex w-full items-center rounded-xl transition-all ${
                    sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3 py-2"
                  } text-[13.5px] font-semibold ${
                    view === "catalogue"
                      ? "bg-[#0A84FF] text-white shadow-sm"
                      : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                  }`}
                  title={sidebarCollapsed ? "Catalogue" : undefined}
                >
                  <IconTag size={18} />
                  {!sidebarCollapsed && <span>Catalogue</span>}
                </button>

                {/* Counter codes is the other half of Invoices, so it lights this row. */}
                <button
                  type="button"
                  onClick={() => switchTab("invoices")}
                  className={`group relative flex w-full items-center rounded-xl transition-all ${
                    sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3 py-2"
                  } text-[13.5px] font-semibold ${
                    view === "invoices" || view === "links"
                      ? "bg-[#0A84FF] text-white shadow-sm"
                      : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                  }`}
                  title={sidebarCollapsed ? "Invoices" : undefined}
                >
                  <IconFileText size={18} />
                  {!sidebarCollapsed && <span>Invoices</span>}
                </button>

                <button
                  type="button"
                  onClick={() => switchTab("customers")}
                  className={`group relative flex w-full items-center rounded-xl transition-all ${
                    sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3 py-2"
                  } text-[13.5px] font-semibold ${
                    view === "customers"
                      ? "bg-[#0A84FF] text-white shadow-sm"
                      : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                  }`}
                  title={sidebarCollapsed ? "Customers" : undefined}
                >
                  <IconUsers size={18} />
                  {!sidebarCollapsed && <span>Customers</span>}
                </button>

                <button
                  type="button"
                  onClick={() => switchTab("insights")}
                  className={`group relative flex w-full items-center rounded-xl transition-all ${
                    sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3 py-2"
                  } text-[13.5px] font-semibold ${
                    view === "insights"
                      ? "bg-[#0A84FF] text-white shadow-sm"
                      : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                  }`}
                  title={sidebarCollapsed ? "Insights" : undefined}
                >
                  <IconBars size={18} />
                  {!sidebarCollapsed && <span>Insights</span>}
                </button>

              </>
            ) : (
              <>
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
              </>
            )}

            <button
              type="button"
              onClick={openSettingsForMode}
              className={`group relative flex w-full items-center rounded-xl transition-all ${
                sidebarCollapsed ? "h-11 w-11 justify-center mx-auto" : "gap-2.5 px-3 py-2"
              } text-[13.5px] font-semibold ${
                view === "settings"
                  ? "bg-[#0A84FF] text-white shadow-sm"
                  : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
              }`}
              title={
                sidebarCollapsed
                  ? mode === "merchant"
                    ? "Merchant settings"
                    : "Settings (⌘5)"
                  : undefined
              }
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
                  <div className="flex items-center">
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
                      title={`${acct.label} - ${formatTrezorAddress(acct.publicKey)}`}
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
        <header className="app-scroll-sticky-top hidden md:flex h-[64px] shrink-0 items-center justify-between px-8 border-b border-white/[0.08] bg-white/[0.01] sticky z-20 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <h2 className="text-[20px] font-bold text-white tracking-tight">
              {desktopViewTitle(view)}
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
        <div className={`app-mobile-sticky-header md:hidden sticky z-30 transition-all ${scrolled ? "nav-blur" : ""}`}>
          <div className="mx-auto w-full max-w-[560px] px-4">
            <div className="flex h-[44px] min-w-0 items-center justify-between gap-1">
              <AccountMenu
                onAddAccount={() => setAddAccountOpen(true)}
                onManageAccounts={() => openSettings("accounts")}
              />
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  className="icon-btn !h-11 !w-11"
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
                  className="icon-btn !h-11 !w-11"
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
                  className="icon-btn !h-11 !w-11"
                  onClick={openSettingsForMode}
                  aria-label={mode === "merchant" ? "Merchant settings" : "Settings"}
                >
                  <IconGear size={18} />
                </button>
              </div>
            </div>

            {scrolled ? (
              <div className="-mt-1 pb-2.5 text-center">
                <span className="text-[17px] font-semibold tracking-tight text-white">
                  {mobileViewTitle(view)}
                </span>
              </div>
            ) : (
              <div className="flex items-end justify-between pb-2">
                <h1 className="display-h text-[34px] leading-tight text-white font-bold">
                  {mobileViewTitle(view)}
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
            <SettingsPage
              key={settingsKey}
              initialSub={settingsSub}
              merchantOnly={mode === "merchant"}
              installAvailable={installHandoff.available}
              installDescription={
                installHandoff.action === "backup-first"
                  ? "Encrypted backup required first"
                  : installHandoff.action === "ios-guide"
                    ? "Add to your iPhone Home Screen"
                    : "Add StellarKey to this device"
              }
              onInstallApp={handleInstallApp}
              onOpenBackupWizard={() => setBackupWizardOpen(true)}
              onOpenMultisigStudio={() => setMultisigOpen(true)}
              onOpenSetupWizard={() => requestRuntime("setup")}
              onOpenSwap={(intent: SettlementSwapIntent) => {
                switchTab("swap");
                setSwapPrefill(intent);
              }}
              onOpenSend={(intent: SettlementSweepIntent) => {
                setSendPrefill({
                  destination: intent.destination,
                  amount: intent.amount,
                  ...(intent.asset.issuer
                    ? { assetCode: intent.asset.code, assetIssuer: intent.asset.issuer }
                    : {}),
                  msg: "Merchant treasury sweep",
                  settlementIntent: intent,
                });
                setSendOpen(true);
              }}
            />
          ) : view === "swap" ? (
            <SwapPage
              key={swapPrefill?.contextId ?? "manual-swap"}
              prefill={swapPrefill}
              onDone={() => switchTab("home")}
              onViewActivity={() => switchTab("activity")}
            />
          ) : view === "contacts" ? (
            <AddressBookPage onSendTo={handleSendToContact} />
          ) : isMerchantView(view) ? (
            <MerchantPage
              sub={merchantSubForView(view)}
              onSubChange={(next) => switchTab(viewForMerchantSub(next))}
              onOpenStaff={() => openSettings("staff")}
              shiftOpen={shiftOpen}
              onShiftOpenChange={setShiftOpen}
            />
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
                <section className="panel fade-up flex flex-col items-center p-4 text-center sm:p-6">
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
              <p className="text-[13px] font-semibold text-neutral-400">
                {portfolioView === "all" ? "XLM across all accounts" : "Native balance"}
              </p>
                  <h2
                    className="balance-display mt-1.5 text-white"
                    data-density={heroBalanceDensity}
                  >
                    {heroUnavailable ? (
                      <span className="text-[18px] font-semibold text-neutral-400">Portfolio incomplete</span>
                    ) : heroLoading ? (
                      <span className="skeleton inline-block h-[48px] w-60 rounded-2xl align-middle" />
                    ) : (
                      <span className="balance-display-value">{heroDisplayAmount}</span>
                    )}
                    {!privacyMode && heroReady && (
                      <span className="balance-display-unit">XLM</span>
                    )}
                  </h2>
                  <div className="mt-2 flex min-h-[24px] items-center justify-center">
                    {privacyMode ? (
                      <p className="text-[13px] text-neutral-500">Balances hidden</p>
                    ) : portfolioView === "all" && allPortfolio.completeness === "partial" ? (
                      <p className="text-[13px] text-amber-300">
                        {allPortfolio.unavailableAccounts.length} account{allPortfolio.unavailableAccounts.length === 1 ? "" : "s"} unavailable · refresh to retry
                      </p>
                    ) : portfolioView === "all" && allPortfolio.completeness === "loading" ? (
                      <p className="text-[13px] text-neutral-500">Checking every account…</p>
                    ) : portfolioView === "all" && allPortfolio.unpricedAssets.length > 0 ? (
                      <p className="text-[13px] text-amber-300">
                        Total unavailable · {allPortfolio.unpricedAssets.length} asset{allPortfolio.unpricedAssets.length === 1 ? " has" : "s have"} no verified price
                      </p>
                    ) : portfolioView === "active" && activePortfolio.unpricedAssets.length > 0 ? (
                      <p className="text-[13px] text-amber-300">
                        Total unavailable · {activePortfolio.unpricedAssets.length} asset{activePortfolio.unpricedAssets.length === 1 ? " has" : "s have"} no verified price
                      </p>
                    ) : heroUsd !== null ? (
                      <button
                        type="button"
                        onClick={cycleFiatCurrency}
                        className="flex items-center gap-1.5 rounded-full bg-white/[0.05] border border-white/10 px-3.5 py-1 text-[13.5px] font-medium text-neutral-200 hover:text-white transition-colors cursor-pointer"
                        title="Click to cycle currency"
                      >
                        <span>{portfolioView === "all" ? "Total portfolio " : "≈ "}{fmtFiat(heroUsd, fiatCurrency, fiatRates)}</span>
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
                  <div className="mt-8 grid w-full max-w-[360px] grid-cols-4 gap-2">
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
                        label={formatTrezorAddress(activeAccount.publicKey)}
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
                  <div
                    data-mobile-asset-toolbar
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2.5"
                  >
                    <h2 className="order-1 mr-auto text-[16px] font-bold tracking-tight text-white sm:order-none">
                      Your Assets
                    </h2>
                    <div className="order-3 flex w-full items-center justify-end gap-3 sm:order-none sm:w-auto">
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
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic("selection");
                        setAddAssetOpen(true);
                      }}
                      className="order-2 text-[13px] font-semibold text-[#0A84FF] hover:underline sm:order-none"
                    >
                      + Add Asset
                    </button>
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
                      return (
                        <button
                          key={asset.key}
                          type="button"
                          onClick={() => {
                            triggerHaptic("selection");
                            setDetailAsset(asset);
                          }}
                          className={`row-hover flex w-full min-w-0 items-center gap-3.5 px-4 py-3.5 text-left ${
                            i > 0 ? "ios-sep" : ""
                          }`}
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
                                    : formatTrezorAddress(asset.issuer ?? "")}
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

                            <span className="min-w-0 max-w-[48%] text-right">
                              <span className="mono block break-words text-[13px] font-medium leading-tight text-white sm:text-[15.5px]">
                                {privacyMode ? "••••••" : fmtAmount(asset.balance)}
                              </span>
                              {asset.isNative && !privacyMode && xlmPriceUsd !== null && (
                                <span className="block break-words text-[11px] leading-tight text-neutral-400 sm:text-[12px]">
                                  {fmtFiat(parseFloat(asset.balance) * xlmPriceUsd, fiatCurrency, fiatRates)}
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
                        const presentedAsset = activityAssetPresentation(item);
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
                                {neutral ? (
                                  <IconSwap size={12} />
                                ) : incoming ? (
                                  "↓"
                                ) : (
                                  "↑"
                                )}
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
                            <ActivityAmountDisplay
                              item={item}
                              privacyMode={privacyMode}
                              fiatValue={fiatValue}
                              fiatCurrency={fiatCurrency}
                              fiatRates={fiatRates}
                              compact
                            />
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
                    Filtered by: {formatTrezorAddress(counterpartyFilter)}
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
                                      ? ` · ${formatTrezorAddress(item.counterparty)}`
                                      : ""}
                                  {presentedAsset.issuerDisplay
                                    ? ` · ${presentedAsset.issuerDisplay}`
                                    : ""}
                                </span>
                              </span>
                              <ActivityAmountDisplay
                                item={item}
                                privacyMode={privacyMode}
                                fiatValue={fiatValue}
                                fiatCurrency={fiatCurrency}
                                fiatRates={fiatRates}
                              />
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
        {/*
          Merchant takes the Contacts slot while the counter is open; Contacts
          stays reachable from the command palette and from Settings.
        */}
        {merchantEnabled ? (
          <button
            type="button"
            className={`tab-item ${isMerchantView(view) ? "active" : ""}`}
            onClick={() => switchTab("merchant")}
          >
            <IconStorefront size={22} />
            <span>Merchant</span>
          </button>
        ) : (
          <button
            type="button"
            className={`tab-item ${view === "contacts" ? "active" : ""}`}
            onClick={() => switchTab("contacts")}
          >
            <IconBook size={22} />
            <span>Contacts</span>
          </button>
        )}
        <button
          type="button"
          className={`tab-item ${view === "settings" ? "active" : ""}`}
          onClick={openSettingsForMode}
        >
          <IconGear size={22} />
          <span>Settings</span>
        </button>
      </nav>

      <SendModal
        open={sendOpen}
        onClose={() => {
          setSendOpen(false);
          setSendPrefill(null);
        }}
        prefill={sendPrefill}
      />
      <BatchSendModal open={batchSendOpen} onClose={() => setBatchSendOpen(false)} />
      <ReceiveModal open={receiveOpen} onClose={() => setReceiveOpen(false)} />
      <AddAssetModal open={addAssetOpen} onClose={() => setAddAssetOpen(false)} />
      <AssetDetailModal
        key={`${network}:${detailAsset?.key ?? "closed"}`}
        asset={detailAsset}
        favorite={detailAsset ? pinnedAssets.includes(detailAsset.key) : false}
        onToggleFavorite={togglePinAsset}
        onClose={() => setDetailAsset(null)}
      />
      <TxDetailModal key={txDetail?.hash ?? "closed"} item={txDetail} onClose={() => setTxDetail(null)} />
      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        merchantEnabled={merchantEnabled}
      />
      <NetworkStatsModal open={networkStatsOpen} onClose={() => setNetworkStatsOpen(false)} />
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
      <Modal open={installDialog !== null} onClose={() => setInstallDialog(null)}>
        <ModalHeader
          title={installDialog === "backup-first" ? "Back up before installing" : "Add to Home Screen"}
          subtitle="Keep your self-custodial wallet recoverable"
          onClose={() => setInstallDialog(null)}
        />
        {installDialog === "backup-first" ? (
          <div className="space-y-4 p-4 sm:p-6">
            <div className="rounded-2xl border border-[#FF9F0A]/25 bg-[#FF9F0A]/[0.08] p-4">
              <p className="text-[13px] font-semibold text-white">Export an encrypted backup first</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-neutral-300">
                iOS can give a Home Screen app its own local storage. Your browser wallet may
                therefore look empty after installation. A current encrypted backup is the safe
                handoff between them.
              </p>
            </div>
            <Button
              className="w-full"
              onClick={() => {
                setInstallDialog(null);
                setBackupWizardOpen(true);
              }}
            >
              Open Backup
            </Button>
          </div>
        ) : (
          <div className="space-y-4 p-4 sm:p-6">
            <ol className="space-y-3 text-[13px] leading-relaxed text-neutral-200">
              <li><span className="mr-2 font-semibold text-[#0A84FF]">1.</span>Tap the Share button in Safari.</li>
              <li><span className="mr-2 font-semibold text-[#0A84FF]">2.</span>Choose <strong className="text-white">Add to Home Screen</strong>.</li>
              <li><span className="mr-2 font-semibold text-[#0A84FF]">3.</span>Open StellarKey from its new icon. If it starts empty, restore the encrypted backup you just exported.</li>
            </ol>
            <div className="rounded-2xl border border-[#30D158]/20 bg-[#30D158]/[0.07] p-3 text-[12px] leading-relaxed text-neutral-300">
              Backup ready. It remains encrypted by your wallet password and never leaves this device unless you move it.
            </div>
            <Button variant="ghost" className="w-full" onClick={() => setInstallDialog(null)}>
              Done
            </Button>
          </div>
        )}
      </Modal>
      <MultiSigStudioModal open={multisigOpen} onClose={() => setMultisigOpen(false)} />
      {setupWizardOpen && (
        <SetupWizard
          open
          onClose={() => {
            setSetupWizardOpen(false);
            releaseRuntime();
          }}
          onComplete={() => switchTab("merchant")}
        />
      )}
    </div>
  );
}

function ActivityAmountDisplay({
  item,
  privacyMode,
  fiatValue,
  fiatCurrency,
  fiatRates,
  compact = false,
}: {
  item: ActivityItem;
  privacyMode: boolean;
  fiatValue: number | null;
  fiatCurrency: FiatCurrency;
  fiatRates: Partial<Record<FiatCurrency, number>>;
  compact?: boolean;
}) {
  const lines = activityAmountLines(item);
  if (lines.length === 0) return null;

  if (item.swap) {
    return (
      <span
        className="shrink-0 text-right"
        aria-label={privacyMode ? "Swap amounts hidden" : lines.map((line) => line.display).join(", ")}
      >
        {lines.map((line) => (
          <span
            key={line.direction}
            className={`mono block whitespace-nowrap font-semibold leading-tight ${
              compact ? "text-[12px]" : "text-[14px]"
            } ${
              privacyMode
                ? "text-neutral-500"
                : line.direction === "out"
                  ? "text-[#FF453A]"
                  : "text-[#30D158]"
            }`}
          >
            {privacyMode ? "••••••" : line.display}
          </span>
        ))}
      </span>
    );
  }

  const [line] = lines;
  return (
    <span className="shrink-0 text-right">
      <span
        className={`mono block whitespace-nowrap font-medium leading-tight ${compact ? "text-[13px]" : "text-[15px]"} ${
          privacyMode
            ? "text-neutral-500"
            : line.direction === "in"
              ? "text-[#30D158]"
              : line.direction === "out"
                ? "text-[#FF453A]"
                : "text-white"
        }`}
      >
        {privacyMode ? "••••••" : line.display}
      </span>
      {fiatValue !== null && (
        <span className={`block leading-tight text-neutral-500 ${compact ? "text-[10.5px]" : "text-[11.5px]"}`}>
          ≈ {fmtFiat(fiatValue, fiatCurrency, fiatRates)}
        </span>
      )}
    </span>
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
      className="group flex w-full min-w-0 flex-col items-center gap-2 outline-none disabled:cursor-not-allowed"
    >
      <span
        className={`flex h-[clamp(48px,16vw,60px)] w-[clamp(48px,16vw,60px)] items-center justify-center rounded-full transition-all duration-250 ease-[cubic-bezier(0.34,1.4,0.64,1)] group-focus-visible:ring-2 group-focus-visible:ring-white/60 group-active:scale-[0.84] group-active:duration-[90ms] ${
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
            className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] transition-all hover:bg-white/[0.08] hover:border-white/20 active:scale-95 shadow-sm"
            title={`${activeAccount.label} (${formatTrezorAddress(activeAccount.publicKey)})`}
          >
            <Avatar seed={activeAccount.publicKey} size={28} />
            <span
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#18181b]"
              style={{ background: network === "mainnet" ? "#30d158" : "#ff9f0a" }}
            />
          </button>
        ) : (
          <button
            {...triggerProps}
            aria-label={`Open account menu for ${activeAccount.label}`}
            className="flex min-h-11 min-w-0 flex-1 w-full max-w-[180px] items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] hover:bg-white/[0.12] active:scale-95 py-1 pl-1.5 pr-3 shadow-sm transition-all cursor-pointer"
          >
            <Avatar seed={activeAccount.publicKey} size={28} />
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
          <p className="px-3 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-wider text-neutral-400">
            Switch Account
          </p>
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
