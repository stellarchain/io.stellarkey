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
  loadAutoLockPref,
  loadBiometricsPref,
  loadNetworkPref,
  loadVault,
  lockVault,
  removeStoredAccount,
  restoreAccountByIndex as restoreAccountByIndexVault,
  restoreArchivedAccount as restoreArchivedAccountVault,
  restoreDeletedVault,
  restoreVaultBackup,
  saveAutoLockPref,
  saveBiometricsPref,
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
import type { AccountMeta, ActivityItem, AssetBalance, StoredAccount } from "@/lib/types";
import { NETWORKS, type NetworkKey } from "@/lib/stellar";

type Phase = "loading" | "empty" | "locked" | "unlocked";

function stripSecret(account: StoredAccount): AccountMeta {
  return {
    id: account.id,
    label: account.label,
    publicKey: account.publicKey,
    createdAt: account.createdAt,
    ...(account.index !== undefined ? { index: account.index, path: account.path } : {}),
    ...(account.watchOnly ? { watchOnly: true } : {}),
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
  cycleFiatCurrency: () => void;
  autoLockMs: number;
  changeAutoLockMs: (ms: number) => void;
  biometricsEnabled: boolean;
  toggleBiometrics: (enabled: boolean) => void;
  contacts: Contact[];
  addContact: (contact: Contact) => void;
  removeContact: (address: string) => void;
  toggleContactFavorite: (address: string) => void;

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
  /** Replace the entire wallet from a backup file; wallet returns to locked state */
  restoreWalletFromBackup: (json: string) => Promise<VaultRestoreResult>;
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
    memoText?: string;
    feeStroops?: number;
  }) => Promise<{ hash: string }>;
  sendBatch: (params: {
    payments: Array<{
      destination: string;
      amount: string;
      assetCode: string;
      issuer?: string | null;
    }>;
    memoText?: string;
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
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({});
  // Session-scoped cache so switching accounts shows last-known data instantly (no zero flash)
  const snapshotCache = useRef<
    Map<string, { balances: AssetBalance[]; activity: ActivityItem[]; cursor: string | null }>
  >(new Map());
  const [claimableBalances, setClaimableBalances] = useState<ClaimableBalanceItem[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
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
      const [bals, claims, acts, price, series] = await Promise.all([
        api.fetchBalances(activeAccount.publicKey, network),
        api.fetchClaimableBalances(activeAccount.publicKey, network),
        api.fetchActivity(activeAccount.publicKey, network),
        network === "mainnet" ? api.fetchXlmPrice() : Promise.resolve(null),
        cachedSeries ? Promise.resolve(cachedSeries) : api.fetchXlmSeries(priceRange),
      ]);
      setBalances(bals);
      setClaimableBalances(claims);
      setActivity(acts.items);
      setActivityCursor(acts.nextCursor);
      snapshotCache.current.set(activeAccount.publicKey, {
        balances: bals,
        activity: acts.items,
        cursor: acts.nextCursor,
      });
      const nativeBal = bals.find((b) => b.isNative);
      setAccountBalances((prev) => ({
        ...prev,
        [activeAccount.publicKey]: nativeBal ? parseFloat(nativeBal.balance) : 0,
      }));
      if (price !== null) setXlmPriceUsd(price);
      if (series !== null) {
        priceCache.current[series.range] = series;
        setPriceData(series);
      }
    } catch {
      // Resolve to empty state rather than leaving skeletons up forever
      setBalances((prev) => prev ?? []);
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
    const cfg = NETWORKS[network];
    let es: EventSource | null = null;
    try {
      es = new EventSource(
        `${cfg.horizonUrl}/accounts/${activeAccount.publicKey}/operations?cursor=now`,
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


  // Warm-fetch every account's balance in parallel so the sidebar can show
  // live totals for all accounts without switching to them.
  useEffect(() => {
    if (phase !== "unlocked" || accounts.length === 0) return;
    let alive = true;
    void (async () => {
      const results = await Promise.allSettled(
        accounts.map(async (acct) => ({
          key: acct.publicKey,
          bal: await api.fetchNativeBalance(acct.publicKey, network),
        })),
      );
      if (!alive) return;
      setAccountBalances((prev) => {
        const next = { ...prev };
        for (const r of results) {
          // Record 0 for inactive wallets too; only skip true network failures (null)
          if (r.status === "fulfilled" && r.value.bal !== null && !(r.value.key in next)) {
            next[r.value.key] = r.value.bal;
          }
        }
        return next;
      });
    })();
    return () => {
      alive = false;
    };
  }, [phase, accounts, network]);

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
    setClaimableBalances([]);
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

  const restoreWalletFromBackup = useCallback(async (json: string): Promise<VaultRestoreResult> => {
    const result = restoreVaultBackup(json);
    const vault = loadVault();
    if (vault) {
      setAccounts(vault.accounts.map(stripSecret));
      setArchivedAccounts((vault.archivedAccounts ?? []).map(stripSecret));
      setActiveId(vault.activeAccountId ?? vault.accounts[0]?.id ?? null);
    }
    setBalances(null);
    setClaimableBalances([]);
    setActivity([]);
    setActivityCursor(null);
    setPendingTxs([]);
    clearSessionSecrets();
    setHasDeletedWalletBackup(true);
    // Wallet is restored but LOCKED — unlock with the backup's password
    setPhase("locked");
    return result;
  }, []);

  const selectAccount = useCallback((id: string) => {
    const vault = setActiveStoredAccount(id);
    if (!vault) return;
    const target = vault.accounts.find((a) => a.id === id);
    const cached = target ? snapshotCache.current.get(target.publicKey) : undefined;
    // Show last-known snapshot instantly; background poll refreshes it within POLL_MS
    if (cached) {
      setBalances(cached.balances);
      setActivity(cached.activity);
      setActivityCursor(cached.cursor);
    } else {
      setBalances(null);
      setActivity([]);
      setActivityCursor(null);
    }
    setActiveId(id);
  }, []);

  const addAccount = useCallback(async (opts: { secret?: string; label?: string }) => {
    const account = await addStoredAccount(opts);
    setAccounts((prev) => [...prev, stripSecret(account)]);
    setActiveId(account.id);
    setBalances(null);
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
    setClaimableBalances([]);
    setActivity([]);
    setActivityCursor(null);
    return restored;
  }, []);

  const switchNetwork = useCallback((net: NetworkKey) => {
    saveNetworkPref(net);
    setNetworkState(net);
    setBalances(null);
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
  const toggleContactFavorite = useCallback((address: string) => {
    setContacts(toggleFavoriteContact(address));
  }, []);

  const send = useCallback(
    async (params: {
      destination: string;
      amount: string;
      assetCode: string;
      issuer?: string | null;
      memoText?: string;
      feeStroops?: number;
    }) => {
      if (!activeAccount) throw new Error("No active account");
      if (activeAccount.watchOnly) {
        throw new Error("This is a watch-only account — switch to a signing account to send.");
      }
      const secretKey = getSecretKey(activeAccount.id);
      const result = await api.sendPayment({ network, secretKey, ...params });
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
      memoText?: string;
    }) => {
      if (!activeAccount) throw new Error("No active account");
      if (activeAccount.watchOnly) {
        throw new Error("Watch-only accounts cannot sign transactions.");
      }
      const secretKey = getSecretKey(activeAccount.id);
      const result = await api.sendBatchPayments({ network, secretKey, ...params });
      toast("Batch transaction submitted — confirming…", "info");
      void confirmAndRefresh(result.hash, "Batch Payment");
      return result;
    },
    [activeAccount, network, toast, confirmAndRefresh],
  );

  const claimAirdrop = useCallback(
    async (balanceId: string) => {
      if (!activeAccount) throw new Error("No active account");
      const secretKey = getSecretKey(activeAccount.id);
      const result = await api.claimClaimableBalance({ network, secretKey, balanceId });
      toast("Claiming airdrop — confirming…", "info");
      void confirmAndRefresh(result.hash, "Airdrop claim");
      return result;
    },
    [activeAccount, network, toast, confirmAndRefresh],
  );

  const mergeAccount = useCallback(
    async (destination: string) => {
      if (!activeAccount) throw new Error("No active account");
      const secretKey = getSecretKey(activeAccount.id);
      const result = await api.mergeAccount({ network, secretKey, destination });
      toast("Merging account — confirming…", "info");
      void confirmAndRefresh(result.hash, "Account merge");
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

  const trustAssets = useCallback(
    async (assets: Array<{ code: string; issuer: string }>) => {
      if (!activeAccount) throw new Error("No active account");
      const secretKey = getSecretKey(activeAccount.id);
      const result = await api.changeTrustBatch({ network, secretKey, assets });
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
      accountBalances,
      archivedAccounts,
      hasDeletedWalletBackup,
      balances,
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
      cycleFiatCurrency,
      autoLockMs,
      changeAutoLockMs,
      biometricsEnabled,
      toggleBiometrics,
      contacts,
      addContact,
      removeContact,
      toggleContactFavorite,
      createWallet,
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
      cycleFiatCurrency,
      autoLockMs,
      changeAutoLockMs,
      biometricsEnabled,
      toggleBiometrics,
      contacts,
      addContact,
      removeContact,
      toggleContactFavorite,
      createWallet,
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
