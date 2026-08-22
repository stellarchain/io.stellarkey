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
import type { PriceRange } from "@/lib/api";
import * as swapLib from "@/lib/swap";
import {
  addStoredAccount,
  getArchivedAccounts,
  hasDeletedVault,
  hasMnemonic,
  revealMnemonic as revealMnemonicVault,
  getSecretKey,
  initializeVault,
  loadAutoLockPref,
  loadBiometricsPref,
  loadNetworkPref,
  loadVault,
  lockVault,
  removeStoredAccount,
  restoreAccountByIndex as restoreAccountByIndexVault,
  restoreArchivedAccount as restoreArchivedAccountVault,
  restoreDeletedVault,
  saveAutoLockPref,
  saveBiometricsPref,
  saveNetworkPref,
  setActiveStoredAccount,
  unlockVault,
  updateAccountLabel,
  wipeVault,
  type InitializeOptions,
} from "@/lib/vault";
import { deleteContact, loadContacts, saveContact, type Contact } from "@/lib/contacts";
import { useToast } from "@/components/Toast";
import type { AccountMeta, ActivityItem, AssetBalance, StoredAccount } from "@/lib/types";
import type { NetworkKey } from "@/lib/stellar";

type Phase = "loading" | "empty" | "locked" | "unlocked";

function stripSecret(account: StoredAccount): AccountMeta {
  return {
    id: account.id,
    label: account.label,
    publicKey: account.publicKey,
    createdAt: account.createdAt,
    ...(account.index !== undefined ? { index: account.index, path: account.path } : {}),
  };
}

const POLL_MS = 15_000;

interface WalletContextValue {
  phase: Phase;
  network: NetworkKey;
  accounts: AccountMeta[];
  activeAccount: AccountMeta | null;
  archivedAccounts: AccountMeta[];
  hasDeletedWalletBackup: boolean;
  balances: AssetBalance[] | null;
  activity: ActivityItem[];
  activityCursor: string | null;
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
  autoLockMs: number;
  changeAutoLockMs: (ms: number) => void;
  biometricsEnabled: boolean;
  toggleBiometrics: (enabled: boolean) => void;
  contacts: Contact[];
  addContact: (contact: Contact) => void;
  removeContact: (address: string) => void;

  createWallet: (
    password: string,
    opts?: { secret?: string; mnemonic?: string; label?: string },
  ) => Promise<{ account: AccountMeta; revealed: string; kind: "mnemonic" | "secret" }>;
  revealRecoveryPhrase: (password: string) => Promise<string>;
  completeSetup: () => void;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  resetWallet: () => void;
  restoreDeletedWallet: (password: string) => Promise<void>;
  selectAccount: (id: string) => void;
  addAccount: (opts: { secret?: string; label?: string }) => Promise<AccountMeta>;
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
    memoText?: string;
  }) => Promise<{ hash: string }>;
  trustAsset: (params: { code: string; issuer: string; add: boolean }) => Promise<{ hash: string }>;
  swap: (params: {
    sendCode: string;
    sendIssuer?: string | null;
    sendAmount: string;
    destCode: string;
    destIssuer?: string | null;
    destMin: string;
    intermediates: Asset[];
  }) => Promise<{ hash: string }>;
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
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [xlmPriceUsd, setXlmPriceUsd] = useState<number | null>(null);
  const [priceData, setPriceData] = useState<api.PriceSeries | null>(null);
  const [priceRange, setPriceRangeState] = useState<PriceRange>("7D");
  const [priceLoading, setPriceLoading] = useState(false);
  const priceCache = useRef<Partial<Record<PriceRange, api.PriceSeries>>>({});
  const [privacyMode, setPrivacyMode] = useState(false);
  const [autoLockMs, setAutoLockMsState] = useState(15 * 60 * 1000);
  const [biometricsEnabled, setBiometricsEnabledState] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeId) ?? null,
    [accounts, activeId],
  );
  const unfunded = phase === "unlocked" && balances !== null && balances.length === 0;

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      const net = loadNetworkPref();
      setNetworkState(net);
      setPrivacyMode(window.localStorage.getItem("polaris.privacy.v1") === "1");
      setAutoLockMsState(loadAutoLockPref());
      setBiometricsEnabledState(loadBiometricsPref());
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
    setDataLoading(true);
    try {
      const cachedSeries = priceCache.current[priceRange];
      const [bals, acts, price, series] = await Promise.all([
        api.fetchBalances(activeAccount.publicKey, network),
        api.fetchActivity(activeAccount.publicKey, network),
        network === "mainnet" ? api.fetchXlmPrice() : Promise.resolve(null),
        cachedSeries ? Promise.resolve(cachedSeries) : api.fetchXlmSeries(priceRange),
      ]);
      setBalances(bals);
      setActivity(acts.items);
      setActivityCursor(acts.nextCursor);
      if (price !== null) setXlmPriceUsd(price);
      if (series !== null) {
        priceCache.current[series.range] = series;
        setPriceData(series);
      }
    } catch {
      void 0;
    } finally {
      setDataLoading(false);
    }
  }, [activeAccount, network, priceRange]);

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (phase !== "unlocked" || !activeAccount) return;
    void refreshRef.current();
    const timer = window.setInterval(() => {
      void refreshRef.current();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [phase, activeAccount, network]);

  function lockVaultAndReset() {
    lockVault();
    setPhase("locked");
  }

  useEffect(() => {
    if (phase !== "unlocked" || autoLockMs <= 0) return;
    let timer = window.setTimeout(() => lockVaultAndReset(), autoLockMs);
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => lockVaultAndReset(), autoLockMs);
    };
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
    };
  }, [phase, autoLockMs]);

  const confirmAndRefresh = useCallback(
    async (hash: string, label: string) => {
      const outcome = await api.waitForTransaction(network, hash);
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
    setActivity([]);
    setPhase("unlocked");
  }, []);

  const lock = useCallback(() => {
    lockVaultAndReset();
  }, []);

  const resetWallet = useCallback(() => {
    wipeVault();
    setAccounts([]);
    setArchivedAccounts([]);
    setActiveId(null);
    setBalances(null);
    setActivity([]);
    setPriceData(null);
    setHasDeletedWalletBackup(true);
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

  const selectAccount = useCallback((id: string) => {
    const vault = setActiveStoredAccount(id);
    if (!vault) return;
    setActiveId(id);
    setBalances(null);
    setActivity([]);
    setActivityCursor(null);
  }, []);

  const addAccount = useCallback(async (opts: { secret?: string; label?: string }) => {
    const account = await addStoredAccount(opts);
    setAccounts((prev) => [...prev, stripSecret(account)]);
    setActiveId(account.id);
    setBalances(null);
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
    setActivity([]);
    setActivityCursor(null);
    return restored;
  }, []);

  const switchNetwork = useCallback((net: NetworkKey) => {
    saveNetworkPref(net);
    setNetworkState(net);
    setBalances(null);
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
    } catch {
      void 0;
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

  const send = useCallback(
    async (params: {
      destination: string;
      amount: string;
      assetCode: string;
      issuer?: string | null;
      memoText?: string;
    }) => {
      if (!activeAccount) throw new Error("No active account");
      const secretKey = getSecretKey(activeAccount.id);
      const result = await api.sendPayment({ network, secretKey, ...params });
      toast("Transaction submitted — confirming…", "info");
      void confirmAndRefresh(result.hash, "Payment");
      return result;
    },
    [activeAccount, network, toast, confirmAndRefresh],
  );

  const trustAsset = useCallback(
    async (params: { code: string; issuer: string; add: boolean }) => {
      if (!activeAccount) throw new Error("No active account");
      const secretKey = getSecretKey(activeAccount.id);
      const result = await api.changeTrust({ network, secretKey, ...params });
      toast(params.add ? "Trustline submitted — confirming…" : "Removing trustline…", "info");
      void confirmAndRefresh(result.hash, params.add ? "Trustline" : "Trustline removal");
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
      const secretKey = getSecretKey(activeAccount.id);
      const result = await swapLib.swapStrictSend({ network, secretKey, ...params });
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

  const changeAutoLockMs = useCallback((ms: number) => {
    saveAutoLockPref(ms);
    setAutoLockMsState(ms);
  }, []);

  const toggleBiometrics = useCallback((enabled: boolean) => {
    saveBiometricsPref(enabled);
    setBiometricsEnabledState(enabled);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      phase,
      network,
      accounts,
      activeAccount,
      archivedAccounts,
      hasDeletedWalletBackup,
      balances,
      activity,
      activityCursor,
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
      autoLockMs,
      changeAutoLockMs,
      biometricsEnabled,
      toggleBiometrics,
      contacts,
      addContact,
      removeContact,
      createWallet,
      revealRecoveryPhrase,
      completeSetup,
      unlock,
      lock,
      resetWallet,
      restoreDeletedWallet,
      selectAccount,
      addAccount,
      removeAccount,
      renameAccount,
      restoreArchivedAccount,
      restoreAccountByIndex,
      switchNetwork,
      refresh,
      loadMoreActivity,
      send,
      trustAsset,
      swap,
      fundFromFriendbot,
    }),
    [
      phase,
      network,
      accounts,
      activeAccount,
      archivedAccounts,
      hasDeletedWalletBackup,
      balances,
      activity,
      activityCursor,
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
      autoLockMs,
      changeAutoLockMs,
      biometricsEnabled,
      toggleBiometrics,
      contacts,
      addContact,
      removeContact,
      createWallet,
      revealRecoveryPhrase,
      completeSetup,
      unlock,
      lock,
      resetWallet,
      restoreDeletedWallet,
      selectAccount,
      addAccount,
      removeAccount,
      renameAccount,
      restoreArchivedAccount,
      restoreAccountByIndex,
      switchNetwork,
      refresh,
      loadMoreActivity,
      send,
      trustAsset,
      swap,
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
