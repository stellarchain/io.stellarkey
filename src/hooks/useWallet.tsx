"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Asset } from "@stellar/stellar-sdk";
import * as api from "@/lib/api";
import type { PriceRange, ClaimableBalanceItem } from "@/lib/api";
import * as swapLib from "@/lib/swap";
import * as msig from "@/lib/multisig";
import type { CosignOutcome, MultisigConfig } from "@/lib/multisig";
import {
  addStoredAccount,
  addHardwareAccount as addHardwareAccountVault,
  addWatchOnlyAccount,
  getArchivedAccounts,
  hasDeletedVault,
  hasMnemonic,
  revealMnemonic as revealMnemonicVault,
  getSecretKey,
  initializeVault,
  initializeHardwareVault,
  loadAutoLockPref,
  loadNetworkPref,
  loadVault,
  lockVault,
  removeStoredAccount,
  restoreAccountByIndex as restoreAccountByIndexVault,
  restoreArchivedAccount as restoreArchivedAccountVault,
  restoreDeletedVault,
  restoreVaultBackup,
  saveAutoLockPref,
  saveNetworkPref,
  setActiveStoredAccount,
  unlockVault,
  updateAccountLabel,
  wipeVault,
  clearSessionSecrets,
  type InitializeOptions,
  type VaultRestoreResult,
} from "@/lib/vault";
import { deleteContact, loadContacts, saveContact, toggleFavoriteContact, type Contact } from "@/lib/contacts";
import { useToast } from "@/components/Toast";
import { triggerHaptic } from "@/lib/haptics";
import type { FiatCurrency } from "@/lib/format";
import { fetchFiatRates, type FiatRates } from "@/lib/prices";
import type { AccountMeta, ActivityItem, AssetBalance, StoredAccount } from "@/lib/types";
import { warmTrezorConnect, type HardwareSigner } from "@/lib/hardware";
import { getHorizonUrl, type NetworkKey } from "@/lib/stellar";
import type { StellarMemoInput } from "@/lib/stellar-domain";

type Phase = "loading" | "empty" | "locked" | "unlocked";

function stripSecret(account: StoredAccount): AccountMeta {
  return {
    id: account.id,
    label: account.label,
    publicKey: account.publicKey,
    createdAt: account.createdAt,
    ...(account.index !== undefined ? { index: account.index, path: account.path } : {}),
    ...(account.watchOnly || account.hardware === "ledger" ? { watchOnly: true } : {}),
    ...(account.hardware ? { hardware: account.hardware } : {}),
  };
}

function hardwareSignerFor(acc: AccountMeta | null): HardwareSigner | undefined {
  if (!acc?.hardware) return undefined;
  if (acc.hardware === "ledger") {
    throw new Error("Ledger transaction signing is not yet supported in this build.");
  }
  return {
    device: "trezor",
    publicKey: acc.publicKey,
    path: acc.path ?? "m/44'/148'/0'",
  };
}

const POLL_MS = 15_000;
const FIAT_LIST: FiatCurrency[] = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"];

interface WalletContextValue {
  phase: Phase;
  network: NetworkKey;
  accounts: AccountMeta[];
  activeAccount: AccountMeta | null;
  archivedAccounts: AccountMeta[];
  hasDeletedWalletBackup: boolean;
  balances: AssetBalance[] | null;
  minimumBalanceXlm: string | null;
  dataError: string | null;
  /** Native XLM balance per publicKey — kept warm so the sidebar never flashes zero */
  accountBalances: Record<string, number>;
  claimableBalances: ClaimableBalanceItem[];
  activity: ActivityItem[];
  activityCursor: string | null;
  /** Transactions broadcast but not yet confirmed on-chain */
  pendingTxs: Array<{ hash: string; label: string }>;
  dataLoading: boolean;
  loadingMore: boolean;
  xlmPriceUsd: number | null;
  priceData: api.PriceSeries | null;
  priceRange: api.PriceRange;
  changePriceRange: (r: api.PriceRange) => Promise<void>;
  priceLoading: boolean;
  unfunded: boolean;
  privacyMode: boolean;
  togglePrivacy: () => void;
  fiatCurrency: FiatCurrency;
  fiatRates: FiatRates;
  cycleFiatCurrency: () => void;
  changeFiatCurrency: (currency: FiatCurrency) => void;
  autoLockMs: number;
  changeAutoLockMs: (ms: number) => void;
  contacts: Contact[];
  addContact: (contact: Contact) => void;
  removeContact: (address: string) => void;
  toggleContactFavorite: (address: string) => void;

  createWallet: (
    password: string,
    opts?: { secret?: string; mnemonic?: string; label?: string },
  ) => Promise<{ account: AccountMeta; revealed: string; kind: "mnemonic" | "secret" }>;
  /** Create a vault around a hardware-only account (Trezor/Ledger) — no phrase, no local secrets */
  createHardwareVault: (
    password: string,
    account: {
      publicKey: string;
      path: string;
      index: number;
      device: "ledger" | "trezor";
      label?: string;
    },
  ) => Promise<{ account: AccountMeta }>;
  revealRecoveryPhrase: (password: string) => Promise<string>;
  completeSetup: () => void;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  resetWallet: () => void;
  restoreDeletedWallet: (password: string) => Promise<void>;
  /** Replace the entire wallet from a backup file; wallet returns to locked state */
  restoreWalletFromBackup: (json: string, password?: string) => Promise<VaultRestoreResult>;
  selectAccount: (id: string) => void;
  addAccount: (opts: { secret?: string; label?: string }) => Promise<AccountMeta>;
  /** Track a public key without holding its secret (read-only) */
  addWatchOnly: (publicKey: string, label?: string) => Promise<AccountMeta>;
  /** Add a hardware wallet account (Ledger or Trezor) */
  addHardwareAccount: (params: {
    publicKey: string;
    device: "ledger" | "trezor";
    path: string;
    label?: string;
    index?: number;
  }) => Promise<AccountMeta>;
  removeAccount: (id: string) => void;
  renameAccount: (id: string, newLabel: string) => void;
  restoreArchivedAccount: (id: string) => Promise<AccountMeta>;
  restoreAccountByIndex: (index: number) => Promise<AccountMeta>;
  switchNetwork: (network: NetworkKey) => void;
  refresh: () => Promise<void>;
  loadMoreActivity: () => Promise<void>;

  send: (params: {
    destination: string;
    amount: string;
    assetCode: string;
    issuer?: string | null;
    memo?: StellarMemoInput;
    feeStroops?: number;
  }) => Promise<{ hash: string }>;
  sendBatch: (params: {
    payments: Array<{
      destination: string;
      amount: string;
      assetCode: string;
      issuer?: string | null;
    }>;
    memo?: StellarMemoInput;
  }) => Promise<{ hash: string }>;
  claimAirdrop: (balanceId: string) => Promise<{ hash: string }>;
  mergeAccount: (destination: string) => Promise<{ hash: string }>;
  trustAsset: (params: { code: string; issuer: string; add: boolean }) => Promise<{ hash: string }>;
  /** Atomically add multiple trustlines in one transaction */
  trustAssets: (assets: Array<{ code: string; issuer: string }>) => Promise<{ hash: string; added: number }>;
  swap: (params: {
    sendCode: string;
    sendIssuer?: string | null;
    sendAmount: string;
    destCode: string;
    destIssuer?: string | null;
    destMin: string;
    intermediates: Asset[];
  }) => Promise<{ hash: string }>;
  /** Apply a multi-sig signer/threshold configuration to the active account */
  applyMultisigConfig: (config: MultisigConfig) => Promise<{ hash: string }>;
  /** Remove all cosigners and reset thresholds to single-sig defaults */
  disableMultisig: () => Promise<{ hash: string }>;
  /** Sign a payment with our key only and return the envelope XDR for co-signing */
  prepareCosignPayment: (params: {
    destination: string;
    amount: string;
    assetCode: string;
    issuer?: string | null;
    memo?: StellarMemoInput;
    feeStroops?: number;
  }) => Promise<{ xdr: string }>;
  /** Co-sign a shared envelope XDR; submits automatically once weight suffices */
  cosignTransaction: (xdr: string) => Promise<CosignOutcome>;
  fundFromFriendbot: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("loading");
  const [network, setNetworkState] = useState<NetworkKey>("testnet");
  const [accounts, setAccounts] = useState<AccountMeta[]>([]);
  const [archivedAccounts, setArchivedAccounts] = useState<AccountMeta[]>([]);
  const [hasDeletedWalletBackup, setHasDeletedWalletBackup] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [balances, setBalances] = useState<AssetBalance[] | null>(null);
  const [minimumBalanceXlm, setMinimumBalanceXlm] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({});
  // Session-scoped cache so switching accounts shows last-known data instantly (no zero flash)
  const snapshotCache = useRef<
    Map<string, {
      balances: AssetBalance[];
      activity: ActivityItem[];
      cursor: string | null;
      minimumBalanceXlm: string;
    }>
  >(new Map());
  const refreshGeneration = useRef(0);
  const accountBalanceGeneration = useRef(0);
  const [claimableBalances, setClaimableBalances] = useState<ClaimableBalanceItem[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  // Mirror of `activity` for readers inside callbacks (declared before any effect)
  const activityRef = useRef<ActivityItem[]>([]);
  const [pendingTxs, setPendingTxs] = useState<Array<{ hash: string; label: string }>>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [xlmPriceUsd, setXlmPriceUsd] = useState<number | null>(null);
  const [priceData, setPriceData] = useState<api.PriceSeries | null>(null);
  const [priceRange, setPriceRangeState] = useState<PriceRange>("7D");
  const [priceLoading, setPriceLoading] = useState(false);
  const priceCache = useRef<Partial<Record<PriceRange, api.PriceSeries>>>({});
  const [privacyMode, setPrivacyMode] = useState(false);
  const [fiatCurrency, setFiatCurrencyState] = useState<FiatCurrency>("USD");
  const [fiatRates, setFiatRates] = useState<FiatRates>({ USD: 1 });
  const [autoLockMs, setAutoLockMsState] = useState(15 * 60 * 1000);
  const [contacts, setContacts] = useState<Contact[]>([]);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeId) ?? null,
    [accounts, activeId],
  );
  const unfunded = phase === "unlocked" && balances !== null && balances.length === 0;

  // Load the Connect bundle before a transaction click. The Trezor-hosted
  // popup must be opened while browser user activation is still available,
  // so signing should not first wait for a cold dynamic import.
  useEffect(() => {
    if (phase === "unlocked" && activeAccount?.hardware === "trezor") {
      warmTrezorConnect();
    }
  }, [phase, activeAccount?.hardware]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      const net = loadNetworkPref();
      setNetworkState(net);
      setPrivacyMode(window.localStorage.getItem("polaris.privacy.v1") === "1");
      const storedFiat = window.localStorage.getItem("wallet.currency.v1") as FiatCurrency;
      if (storedFiat && FIAT_LIST.includes(storedFiat)) {
        setFiatCurrencyState(storedFiat);
      } else {
        // First run: guess display currency from the browser locale (e.g. en-GB -> GBP)
        try {
          const locale = Intl.DateTimeFormat().resolvedOptions().locale || "";
          const region = (locale.split("-")[1] ?? "").toUpperCase();
          const regionToFiat: Record<string, FiatCurrency> = {
            US: "USD", GB: "GBP", JP: "JPY", CA: "CAD", AU: "AUD", CH: "CHF",
          };
          if (region in regionToFiat) {
            setFiatCurrencyState(regionToFiat[region]);
          } else {
            // Eurozone locales
            const euroRegions = ["FR","DE","ES","IT","NL","IE","AT","PT","FI","BE","GR","LU","SK","SI"];
            if (euroRegions.includes(region)) setFiatCurrencyState("EUR");
          }
        } catch {
          void 0;
        }
      }
      setAutoLockMsState(loadAutoLockPref());
      setContacts(loadContacts());
      setHasDeletedWalletBackup(hasDeletedVault());
      const vault = loadVault();
      if (!vault || vault.accounts.length === 0) {
        setPhase("empty");
        return;
      }
      setAccounts(vault.accounts.map(stripSecret));
      setArchivedAccounts((vault.archivedAccounts ?? []).map(stripSecret));
      setActiveId(vault.activeAccountId ?? vault.accounts[0].id);
      setPhase("locked");
    })();
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!activeAccount) return;
    const generation = ++refreshGeneration.current;
    const cacheKey = `${network}:${activeAccount.publicKey}`;
    setDataLoading(true);
    setDataError(null);
    try {
      const cachedSeries = priceCache.current[priceRange];
      const [bals, minimumBalance, claims, acts, price, series, currentFiatRates] = await Promise.all([
        api.fetchBalances(activeAccount.publicKey, network),
        api.fetchMinimumNativeBalance(activeAccount.publicKey, network),
        api.fetchClaimableBalances(activeAccount.publicKey, network),
        api.fetchActivity(activeAccount.publicKey, network),
        // The market chart remains useful on testnet, but portfolio valuation
        // explicitly ignores all testnet balances.
        api.fetchXlmPrice(),
        cachedSeries ? Promise.resolve(cachedSeries) : api.fetchXlmSeries(priceRange),
        fetchFiatRates(),
      ]);
      if (generation !== refreshGeneration.current) return;
      setBalances(bals);
      setMinimumBalanceXlm(minimumBalance);
      setClaimableBalances(claims);
      // Merge the fresh first page into any already-loaded history instead of
      // replacing it — the poll must never wipe pages the user scrolled through.
      const hadHistory = activityRef.current.length > 0;
      setActivity((prev) => {
        if (prev.length === 0) return acts.items;
        const seen = new Set(prev.map((i) => i.id));
        const fresh = acts.items.filter((i) => !seen.has(i.id));
        return fresh.length > 0 ? [...fresh, ...prev] : prev;
      });
      if (!hadHistory) setActivityCursor(acts.nextCursor);
      snapshotCache.current.set(cacheKey, {
        balances: bals,
        activity: acts.items,
        cursor: acts.nextCursor,
        minimumBalanceXlm: minimumBalance,
      });
      const nativeBal = bals.find((b) => b.isNative);
      setAccountBalances((prev) => ({
        ...prev,
        [activeAccount.publicKey]: nativeBal ? parseFloat(nativeBal.balance) : 0,
      }));
      if (price !== null) setXlmPriceUsd(price);
      setFiatRates(currentFiatRates);
      if (series !== null) {
        priceCache.current[series.range] = series;
        setPriceData(series);
      }
    } catch (error) {
      if (generation === refreshGeneration.current) {
        setDataError(error instanceof Error ? error.message : "Unable to refresh wallet data.");
      }
    } finally {
      if (generation === refreshGeneration.current) setDataLoading(false);
    }
  }, [activeAccount, network, priceRange]);

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  // Keep a fresh XLM balance for every account in the vault — the sidebar
  // and the aggregate portfolio read this map, so it must cover all
  // accounts, not just ones visited this session.
  const refreshAccountBalances = useCallback(async () => {
    if (accounts.length === 0) return;
    const generation = ++accountBalanceGeneration.current;
    const results = await Promise.allSettled(
      accounts.map(async (acct) => ({
        key: acct.publicKey,
        bal: await api.fetchNativeBalance(acct.publicKey, network),
      })),
    );
    if (generation !== accountBalanceGeneration.current) return;
    setAccountBalances((prev) => {
      const next = { ...prev };
      for (const r of results) {
        // Record 0 for unfunded wallets too; only skip true network failures (null)
        if (r.status === "fulfilled" && r.value.bal !== null) {
          next[r.value.key] = r.value.bal;
        }
      }
      return next;
    });
  }, [accounts, network]);

  const accountBalancesRef = useRef(refreshAccountBalances);
  useEffect(() => {
    accountBalancesRef.current = refreshAccountBalances;
  }, [refreshAccountBalances]);

  useEffect(() => {
    if (phase !== "unlocked" || !activeAccount) return;
    void refreshRef.current();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refreshRef.current();
      void accountBalancesRef.current();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase, activeAccount, network]);

  // Real-time Horizon Server-Sent Event stream
  useEffect(() => {
    if (
      phase !== "unlocked" ||
      !activeAccount ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return;
    }
    const horizonUrl = getHorizonUrl(network);
    let es: EventSource | null = null;
    try {
      es = new EventSource(
        `${horizonUrl}/accounts/${activeAccount.publicKey}/operations?cursor=now`,
      );
      es.onmessage = () => {
        triggerHaptic("success");
        void refreshRef.current();
      };
    } catch {
      // Ignore
    }

    return () => {
      if (es) es.close();
    };
  }, [phase, activeAccount, network]);


  useEffect(() => {
    if (phase !== "unlocked" || accounts.length === 0) return;
    void accountBalancesRef.current();
  }, [phase, accounts, network]);

  const lockVaultAndReset = useCallback(() => {
    lockVault();
    refreshGeneration.current += 1;
    accountBalanceGeneration.current += 1;
    setPhase("locked");
    setDataLoading(false);
  }, []);

  useEffect(() => {
    if (phase !== "unlocked" || autoLockMs <= 0) return;
    let lastActivity = Date.now();
    let timer: number;
    const schedule = () => {
      window.clearTimeout(timer);
      const remaining = Math.max(0, autoLockMs - (Date.now() - lastActivity));
      timer = window.setTimeout(checkExpired, remaining);
    };
    const checkExpired = () => {
      if (Date.now() - lastActivity >= autoLockMs) {
        lockVaultAndReset();
        return;
      }
      schedule();
    };
    const bump = () => {
      lastActivity = Date.now();
      schedule();
    };
    const onVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") checkExpired();
    };
    schedule();
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    window.addEventListener("focus", onVisibilityOrFocus);
    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
      window.removeEventListener("focus", onVisibilityOrFocus);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
    };
  }, [phase, autoLockMs, lockVaultAndReset]);

  const confirmAndRefresh = useCallback(
    async (hash: string, label: string) => {
      setPendingTxs((prev) => [...prev, { hash, label }]);
      const outcome = await api.waitForTransaction(network, hash);
      setPendingTxs((prev) => prev.filter((p) => p.hash !== hash));
      if (outcome === true) {
        toast(`${label} confirmed`, "success");
      } else if (outcome === false) {
        toast(`${label} failed on-chain`, "error");
      } else {
        toast(`${label} is still confirming`, "info");
      }
      await refreshRef.current();
    },
    [network, toast],
  );

  const createWallet = useCallback(
    async (
      password: string,
      opts?: { secret?: string; mnemonic?: string; label?: string },
    ) => {
      const initOpts: InitializeOptions = {};
      if (opts?.secret) initOpts.secret = opts.secret;
      if (opts?.mnemonic) initOpts.mnemonic = opts.mnemonic;
      const { account, revealed } = await initializeVault(password, initOpts);
      setAccounts([stripSecret(account)]);
      setArchivedAccounts([]);
      setActiveId(account.id);
      setBalances(null);
      setMinimumBalanceXlm(null);
      setDataError(null);
      setClaimableBalances([]);
      setActivity([]);
      setHasDeletedWalletBackup(false);
      return {
        account,
        revealed,
        kind: (hasMnemonic() ? "mnemonic" : "secret") as "mnemonic" | "secret",
      };
    },
    [],
  );

  const createHardwareVault = useCallback(
    async (
      password: string,
      account: {
        publicKey: string;
        path: string;
        index: number;
        device: "ledger" | "trezor";
        label?: string;
      },
    ) => {
      const result = await initializeHardwareVault(password, account);
      setAccounts([result.account]);
      setArchivedAccounts([]);
      setActiveId(result.account.id);
      setBalances(null);
      setMinimumBalanceXlm(null);
      setDataError(null);
      setClaimableBalances([]);
      setActivity([]);
      setHasDeletedWalletBackup(false);
      return result;
    },
    [],
  );

  const revealRecoveryPhrase = useCallback(async (password: string) => {
    return revealMnemonicVault(password);
  }, []);

  const completeSetup = useCallback(() => {
    setPhase("unlocked");
  }, []);

  const unlock = useCallback(async (password: string) => {
    const vault = await unlockVault(password);
    setAccounts(vault.accounts.map(stripSecret));
    setArchivedAccounts((vault.archivedAccounts ?? []).map(stripSecret));
    setActiveId(vault.activeAccountId ?? vault.accounts[0]?.id ?? null);
    setBalances(null);
    setMinimumBalanceXlm(null);
    setDataError(null);
    setClaimableBalances([]);
    setActivity([]);
    setPhase("unlocked");
  }, []);

  const lock = useCallback(() => {
    lockVaultAndReset();
  }, [lockVaultAndReset]);

  const resetWallet = useCallback(() => {
    wipeVault();
    setAccounts([]);
    setArchivedAccounts([]);
    setActiveId(null);
    setBalances(null);
    setMinimumBalanceXlm(null);
    setDataError(null);
    setAccountBalances({});
    snapshotCache.current.clear();
    setActivity([]);
    setPriceData(null);
    setHasDeletedWalletBackup(false);
    setPhase("empty");
  }, []);

  const restoreDeletedWallet = useCallback(async (password: string) => {
    const vault = await restoreDeletedVault(password);
    setAccounts(vault.accounts.map(stripSecret));
    setArchivedAccounts((vault.archivedAccounts ?? []).map(stripSecret));
    setActiveId(vault.activeAccountId ?? vault.accounts[0]?.id ?? null);
    setBalances(null);
    setActivity([]);
    setHasDeletedWalletBackup(false);
    setPhase("unlocked");
  }, []);

  const restoreWalletFromBackup = useCallback(async (json: string, password?: string): Promise<VaultRestoreResult> => {
    const result = await restoreVaultBackup(json, password);
    const vault = loadVault();
    if (vault) {
      setAccounts(vault.accounts.map(stripSecret));
      setArchivedAccounts((vault.archivedAccounts ?? []).map(stripSecret));
      setActiveId(vault.activeAccountId ?? vault.accounts[0]?.id ?? null);
    }
    setContacts(loadContacts());
    setBalances(null);
    setClaimableBalances([]);
    setActivity([]);
    setActivityCursor(null);
    setPendingTxs([]);
    clearSessionSecrets();
    setHasDeletedWalletBackup(false);
    // Wallet is restored but LOCKED — unlock with the backup's password
    setPhase("locked");
    return result;
  }, []);

  const selectAccount = useCallback((id: string) => {
    const vault = setActiveStoredAccount(id);
    if (!vault) return;
    const target = vault.accounts.find((a) => a.id === id);
    refreshGeneration.current += 1;
    const cached = target
      ? snapshotCache.current.get(`${network}:${target.publicKey}`)
      : undefined;
    // Show last-known snapshot instantly; background poll refreshes it within POLL_MS
    if (cached) {
      setBalances(cached.balances);
      setActivity(cached.activity);
      setActivityCursor(cached.cursor);
      setMinimumBalanceXlm(cached.minimumBalanceXlm);
    } else {
      setBalances(null);
      setActivity([]);
      setActivityCursor(null);
      setMinimumBalanceXlm(null);
    }
    setClaimableBalances([]);
    setDataError(null);
    setActiveId(id);
  }, [network]);

  const addAccount = useCallback(async (opts: { secret?: string; label?: string }) => {
    const account = await addStoredAccount(opts);
    setAccounts((prev) => [...prev, stripSecret(account)]);
    setActiveId(account.id);
    setBalances(null);
    setMinimumBalanceXlm(null);
    setDataError(null);
    setClaimableBalances([]);
    setActivity([]);
    setActivityCursor(null);
    return account;
  }, []);

  const addHardwareAccount = useCallback(
    async (params: {
      publicKey: string;
      device: "ledger" | "trezor";
      path: string;
      label?: string;
      index?: number;
    }) => {
      const account = await addHardwareAccountVault(params);
      setAccounts((prev) => [...prev, stripSecret(account)]);
      setActiveId(account.id);
      setBalances(null);
      setMinimumBalanceXlm(null);
      setDataError(null);
      setActivity([]);
      setActivityCursor(null);
      void refresh();
      return account;
    },
    [refresh],
  );

  const addWatchOnly = useCallback(async (publicKey: string, label?: string) => {
    const account = await addWatchOnlyAccount(publicKey.trim(), label);
    setAccounts((prev) => [...prev, stripSecret(account)]);
    setActiveId(account.id);
    setBalances(null);
    setMinimumBalanceXlm(null);
    setDataError(null);
    setClaimableBalances([]);
    setActivity([]);
    setActivityCursor(null);
    return account;
  }, []);

  const removeAccount = useCallback((id: string) => {
    const remaining = removeStoredAccount(id);
    if (!remaining) {
      setAccounts([]);
      setArchivedAccounts([]);
      setActiveId(null);
      setBalances(null);
      setActivity([]);
      setPhase("empty");
      return;
    }
    setAccounts(remaining.accounts.map(stripSecret));
    setArchivedAccounts((remaining.archivedAccounts ?? []).map(stripSecret));
    setActiveId(remaining.activeAccountId);
    setBalances(null);
    setActivity([]);
    setActivityCursor(null);
  }, []);

  const renameAccount = useCallback((id: string, newLabel: string) => {
    updateAccountLabel(id, newLabel);
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, label: newLabel.trim() || a.label } : a)),
    );
  }, []);

  const restoreArchivedAccount = useCallback(async (id: string) => {
    const restored = await restoreArchivedAccountVault(id);
    setAccounts((prev) => [...prev, restored]);
    setArchivedAccounts(getArchivedAccounts());
    setActiveId(restored.id);
    setBalances(null);
    setMinimumBalanceXlm(null);
    setDataError(null);
    setClaimableBalances([]);
    setActivity([]);
    setActivityCursor(null);
    return restored;
  }, []);

  const restoreAccountByIndex = useCallback(async (index: number) => {
    const restored = await restoreAccountByIndexVault(index);
    setAccounts((prev) => {
      if (prev.some((a) => a.id === restored.id)) return prev;
      return [...prev, restored];
    });
    setActiveId(restored.id);
    setBalances(null);
    setMinimumBalanceXlm(null);
    setDataError(null);
    setClaimableBalances([]);
    setActivity([]);
    setActivityCursor(null);
    return restored;
  }, []);

  const switchNetwork = useCallback((net: NetworkKey) => {
    refreshGeneration.current += 1;
    accountBalanceGeneration.current += 1;
    saveNetworkPref(net);
    setNetworkState(net);
    setBalances(null);
    setMinimumBalanceXlm(null);
    setDataError(null);
    setAccountBalances({});
    setClaimableBalances([]);
    setActivity([]);
    setActivityCursor(null);
    setXlmPriceUsd(null);
    setPriceData(null);
  }, []);

  const loadMoreActivity = useCallback(async () => {
    if (!activeAccount || !activityCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await api.fetchActivity(
        activeAccount.publicKey,
        network,
        30,
        activityCursor,
      );
      setActivity((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...more.items.filter((i) => !seen.has(i.id))];
      });
      setActivityCursor(more.nextCursor);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Unable to load more activity.");
    } finally {
      setLoadingMore(false);
    }
  }, [activeAccount, activityCursor, loadingMore, network]);

  const addContact = useCallback((contact: Contact) => {
    setContacts(saveContact(contact));
  }, []);
  const removeContact = useCallback((address: string) => {
    setContacts(deleteContact(address));
  }, []);
  const toggleContactFavorite = useCallback((address: string) => {
    setContacts(toggleFavoriteContact(address));
  }, []);

  const send = useCallback(
    async (params: {
      destination: string;
      amount: string;
      assetCode: string;
      issuer?: string | null;
      memo?: StellarMemoInput;
      feeStroops?: number;
    }) => {
      if (!activeAccount) throw new Error("No active account");
      if (activeAccount.watchOnly) {
        throw new Error("This is a watch-only account — switch to a signing account to send.");
      }
      const hw = hardwareSignerFor(activeAccount);
      const secretKey = hw ? undefined : getSecretKey(activeAccount.id);
      const result = await api.sendPayment({ network, secretKey, hardwareSigner: hw, ...params });
      toast("Transaction submitted — confirming…", "info");
      void confirmAndRefresh(result.hash, "Payment");
      return result;
    },
    [activeAccount, network, toast, confirmAndRefresh],
  );

  const sendBatch = useCallback(
    async (params: {
      payments: Array<{
        destination: string;
        amount: string;
        assetCode: string;
        issuer?: string | null;
      }>;
      memo?: StellarMemoInput;
    }) => {
      if (!activeAccount) throw new Error("No active account");
      if (activeAccount.watchOnly) {
        throw new Error("Watch-only accounts cannot sign transactions.");
      }
      const hw = hardwareSignerFor(activeAccount);
      const secretKey = hw ? undefined : getSecretKey(activeAccount.id);
      const result = await api.sendBatchPayments({ network, secretKey, hardwareSigner: hw, ...params });
      toast("Batch transaction submitted — confirming…", "info");
      void confirmAndRefresh(result.hash, "Batch Payment");
      return result;
    },
    [activeAccount, network, toast, confirmAndRefresh],
  );

  const claimAirdrop = useCallback(
    async (balanceId: string) => {
      if (!activeAccount) throw new Error("No active account");
      const hw = hardwareSignerFor(activeAccount);
      const secretKey = hw ? undefined : getSecretKey(activeAccount.id);
      const result = await api.claimClaimableBalance({ network, secretKey, hardwareSigner: hw, balanceId });
      toast("Claiming airdrop — confirming…", "info");
      void confirmAndRefresh(result.hash, "Airdrop claim");
      return result;
    },
    [activeAccount, network, toast, confirmAndRefresh],
  );

  const mergeAccount = useCallback(
    async (destination: string) => {
      if (!activeAccount) throw new Error("No active account");
      const hw = hardwareSignerFor(activeAccount);
      const secretKey = hw ? undefined : getSecretKey(activeAccount.id);
      const result = await api.mergeAccount({ network, secretKey, hardwareSigner: hw, destination });
      toast("Merging account — confirming…", "info");
      void confirmAndRefresh(result.hash, "Account merge");
      return result;
    },
    [activeAccount, network, toast, confirmAndRefresh],
  );

  const trustAsset = useCallback(
    async (params: { code: string; issuer: string; add: boolean }) => {
      if (!activeAccount) throw new Error("No active account");
      const hw = hardwareSignerFor(activeAccount);
      const secretKey = hw ? undefined : getSecretKey(activeAccount.id);
      const result = await api.changeTrust({ network, secretKey, hardwareSigner: hw, ...params });
      toast(params.add ? "Trustline submitted — confirming…" : "Removing trustline…", "info");
      void confirmAndRefresh(result.hash, params.add ? "Trustline" : "Trustline removal");
      return result;
    },
    [activeAccount, network, toast, confirmAndRefresh],
  );

  const trustAssets = useCallback(
    async (assets: Array<{ code: string; issuer: string }>) => {
      if (!activeAccount) throw new Error("No active account");
      const hw = hardwareSignerFor(activeAccount);
      const secretKey = hw ? undefined : getSecretKey(activeAccount.id);
      const result = await api.changeTrustBatch({ network, secretKey, hardwareSigner: hw, assets });
      toast(
        `${result.added} trustlines submitted in 1 transaction — confirming…`,
        "info",
      );
      void confirmAndRefresh(result.hash, `${result.added} trustlines`);
      return result;
    },
    [activeAccount, network, toast, confirmAndRefresh],
  );

  const swap = useCallback(
    async (params: {
      sendCode: string;
      sendIssuer?: string | null;
      sendAmount: string;
      destCode: string;
      destIssuer?: string | null;
      destMin: string;
      intermediates: Asset[];
    }) => {
      if (!activeAccount) throw new Error("No active account");
      const hw = hardwareSignerFor(activeAccount);
      const secretKey = hw ? undefined : getSecretKey(activeAccount.id);
      const result = await swapLib.swapStrictSend({ network, secretKey, hardwareSigner: hw, ...params });
      toast("Swap submitted — confirming…", "info");
      void confirmAndRefresh(result.hash, "Swap");
      return result;
    },
    [activeAccount, network, toast, confirmAndRefresh],
  );

  const fundFromFriendbot = useCallback(async () => {
    if (!activeAccount) throw new Error("No active account");
    await api.fundWithFriendbot(activeAccount.publicKey, network);
    await refreshRef.current();
  }, [activeAccount, network]);

  const applyMultisigConfig = useCallback(
    async (config: MultisigConfig) => {
      if (!activeAccount) throw new Error("No active account");
      if (activeAccount.watchOnly) {
        throw new Error("Watch-only accounts cannot sign transactions.");
      }
      const hw = hardwareSignerFor(activeAccount);
      const secretKey = hw ? undefined : getSecretKey(activeAccount.id);
      const result = await msig.applyMultisigConfig({
        network,
        accountPublicKey: activeAccount.publicKey,
        config,
        secretKey,
        hardwareSigner: hw,
      });
      toast("Multi-sig configuration submitted — confirming…", "info");
      void confirmAndRefresh(result.hash, "Multi-sig update");
      return result;
    },
    [activeAccount, network, toast, confirmAndRefresh],
  );

  const disableMultisig = useCallback(async () => {
    if (!activeAccount) throw new Error("No active account");
    if (activeAccount.watchOnly) {
      throw new Error("Watch-only accounts cannot sign transactions.");
    }
    const hw = hardwareSignerFor(activeAccount);
    const secretKey = hw ? undefined : getSecretKey(activeAccount.id);
    const result = await msig.disableMultisig({
      network,
      accountPublicKey: activeAccount.publicKey,
      secretKey,
      hardwareSigner: hw,
    });
    toast("Multi-sig disabled — confirming…", "info");
    void confirmAndRefresh(result.hash, "Multi-sig disabled");
    return result;
  }, [activeAccount, network, toast, confirmAndRefresh]);

  const prepareCosignPayment = useCallback(
    async (params: {
      destination: string;
      amount: string;
      assetCode: string;
      issuer?: string | null;
      memo?: StellarMemoInput;
      feeStroops?: number;
    }) => {
      if (!activeAccount) throw new Error("No active account");
      const hw = hardwareSignerFor(activeAccount);
      const secretKey = hw ? undefined : getSecretKey(activeAccount.id);
      return msig.prepareCosignPayment({
        network,
        sourcePublicKey: activeAccount.publicKey,
        secretKey,
        hardwareSigner: hw,
        ...params,
      });
    },
    [activeAccount, network],
  );

  const cosignTransaction = useCallback(
    async (xdr: string) => {
      if (!activeAccount) throw new Error("No active account");
      const hw = hardwareSignerFor(activeAccount);
      const secretKey = hw ? undefined : getSecretKey(activeAccount.id);
      const result = await msig.cosignTransaction({
        network,
        xdr,
        signerPublicKey: activeAccount.publicKey,
        secretKey,
        hardwareSigner: hw,
      });
      if (result.submitted && result.hash) {
        toast("Transaction submitted — confirming…", "info");
        void confirmAndRefresh(result.hash, "Co-signed transaction");
      }
      return result;
    },
    [activeAccount, network, toast, confirmAndRefresh],
  );

  const changePriceRange = useCallback(
    async (r: PriceRange) => {
      setPriceRangeState(r);
      const cached = priceCache.current[r];
      if (cached) {
        setPriceData(cached);
        return;
      }
      setPriceLoading(true);
      try {
        const series = await api.fetchXlmSeries(r);
        if (series) {
          priceCache.current[r] = series;
          setPriceData(series);
        }
      } finally {
        setPriceLoading(false);
      }
    },
    [],
  );

  const togglePrivacy = useCallback(() => {
    setPrivacyMode((prev) => {
      window.localStorage.setItem("polaris.privacy.v1", prev ? "0" : "1");
      return !prev;
    });
  }, []);

  const cycleFiatCurrency = useCallback(() => {
    setFiatCurrencyState((prev) => {
      const idx = FIAT_LIST.indexOf(prev);
      const next = FIAT_LIST[(idx + 1) % FIAT_LIST.length];
      if (typeof window !== "undefined") {
        window.localStorage.setItem("wallet.currency.v1", next);
      }
      triggerHaptic("selection");
      return next;
    });
  }, []);

  const changeFiatCurrency = useCallback((currency: FiatCurrency) => {
    if (!FIAT_LIST.includes(currency)) return;
    setFiatCurrencyState(currency);
    window.localStorage.setItem("wallet.currency.v1", currency);
    triggerHaptic("selection");
  }, []);

  const changeAutoLockMs = useCallback((ms: number) => {
    saveAutoLockPref(ms);
    setAutoLockMsState(ms);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      phase,
      network,
      accounts,
      activeAccount,
      accountBalances,
      archivedAccounts,
      hasDeletedWalletBackup,
      balances,
      minimumBalanceXlm,
      dataError,
      claimableBalances,
      activity,
      activityCursor,
      pendingTxs,
      dataLoading,
      loadingMore,
      xlmPriceUsd,
      priceData,
      priceRange,
      changePriceRange,
      priceLoading,
      unfunded,
      privacyMode,
      togglePrivacy,
      fiatCurrency,
      fiatRates,
      cycleFiatCurrency,
      changeFiatCurrency,
      autoLockMs,
      changeAutoLockMs,
      contacts,
      addContact,
      removeContact,
      toggleContactFavorite,
      createWallet,
      createHardwareVault,
      revealRecoveryPhrase,
      completeSetup,
      unlock,
      lock,
      resetWallet,
      restoreDeletedWallet,
      restoreWalletFromBackup,
      selectAccount,
      addAccount,
      addWatchOnly,
      addHardwareAccount,
      removeAccount,
      renameAccount,
      restoreArchivedAccount,
      restoreAccountByIndex,
      switchNetwork,
      refresh,
      loadMoreActivity,
      send,
      sendBatch,
      claimAirdrop,
      mergeAccount,
      trustAsset,
      trustAssets,
      swap,
      applyMultisigConfig,
      disableMultisig,
      prepareCosignPayment,
      cosignTransaction,
      fundFromFriendbot,
    }),
    [
      phase,
      network,
      accounts,
      activeAccount,
      archivedAccounts,
      hasDeletedWalletBackup,
      accountBalances,
      balances,
      minimumBalanceXlm,
      dataError,
      claimableBalances,
      activity,
      activityCursor,
      pendingTxs,
      dataLoading,
      loadingMore,
      xlmPriceUsd,
      priceData,
      priceRange,
      changePriceRange,
      priceLoading,
      unfunded,
      privacyMode,
      togglePrivacy,
      fiatCurrency,
      fiatRates,
      cycleFiatCurrency,
      changeFiatCurrency,
      autoLockMs,
      changeAutoLockMs,
      contacts,
      addContact,
      removeContact,
      toggleContactFavorite,
      createWallet,
      createHardwareVault,
      revealRecoveryPhrase,
      completeSetup,
      unlock,
      lock,
      resetWallet,
      restoreDeletedWallet,
      restoreWalletFromBackup,
      selectAccount,
      addAccount,
      addWatchOnly,
      addHardwareAccount,
      removeAccount,
      renameAccount,
      restoreArchivedAccount,
      restoreAccountByIndex,
      switchNetwork,
      refresh,
      loadMoreActivity,
      send,
      sendBatch,
      claimAirdrop,
      mergeAccount,
      trustAsset,
      trustAssets,
      swap,
      applyMultisigConfig,
      disableMultisig,
      prepareCosignPayment,
      cosignTransaction,
      fundFromFriendbot,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
