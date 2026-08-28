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
import type { ClaimableBalanceItem, PriceRange, PriceSeries } from "@/lib/api";
import type {
  CosignOutcome,
  MultisigConfig,
  MultisigConfigOutcome,
} from "@/lib/multisig";
import {
  addStoredAccount,
  addHardwareAccount as addHardwareAccountVault,
  addWatchOnlyAccount,
  getArchivedAccounts,
  hasMnemonic,
  revealMnemonic as revealMnemonicVault,
  withSecretKey,
  initializeVault,
  initializeHardwareVault,
  loadAutoLockPref,
  loadNetworkPref,
  loadVault,
  loadVaultResult,
  lockVault,
  removeStoredAccount,
  restoreAccountByIndex as restoreAccountByIndexVault,
  restoreArchivedAccount as restoreArchivedAccountVault,
  restoreVaultBackup,
  saveAutoLockPref,
  saveNetworkPref,
  setActiveStoredAccount,
  unlockVault,
  unlockVaultWithPasskey,
  updateAccountLabel,
  wipeVault,
  clearSessionSecrets,
  type InitializeOptions,
  type VaultRestoreResult,
} from "@/lib/vault";
import { getMerchantRepository } from "@/lib/merchant/repository";
import { deleteContact, loadContacts, saveContact, toggleFavoriteContact, type Contact } from "@/lib/contacts";
import { useToast } from "@/components/Toast";
import { triggerHaptic } from "@/lib/haptics";
import type { FiatCurrency } from "@/lib/format";
import { fetchFiatRates, type FiatRates } from "@/lib/prices";
import type { AccountMeta, ActivityItem, AssetBalance, StoredAccount } from "@/lib/types";
import type { HardwareSigner } from "@/lib/hardware";
import type { NetworkKey } from "@/lib/stellar";
import {
  portfolioSnapshotKey,
  type AccountPortfolioSnapshot,
} from "@/lib/portfolio";
import { getHorizonUrl, STELLAR_ENDPOINTS_CHANGED_EVENT } from "@/lib/stellar-endpoints";
import type { StellarMemoInput } from "@/lib/stellar-domain";
import { describeResourceFailures, settleResourceMap } from "@/lib/wallet-refresh";
import type { StorageIssue } from "@/lib/storage-load";
import {
  createTabSenderId,
  openWalletCoordination,
  type WalletCoordination,
} from "@/lib/tab-coordination";
import {
  createLatestRequestLane,
  horizonStreamPollInterval,
  useVisibleWalletRefresh,
  WALLET_BACKGROUND_POLL_MS,
  WALLET_MARKET_POLL_MS,
  walletBackgroundStaggerMs,
  type HorizonStreamState,
} from "./useWalletResources";
import {
  applyTransactionPoll,
  clearDurablePendingTransactions,
  clearDurableMergeReconciliations,
  createMergeReconciliation,
  isTrackingTaskCurrent,
  loadDurablePendingTransactions,
  loadDurableMergeReconciliations,
  mergeReconciliationPresentation,
  pendingTransactionFromSubmission,
  pendingTransactionFromPrepared,
  pendingTransactionPresentation,
  pendingTransactionStoragePrefix,
  persistDurablePendingTransaction,
  persistMergeReconciliation,
  persistMergeReconciliationQueue,
  reconcileMergeRecovery,
  removeDurablePendingTransaction,
  removeTrackedTransaction,
  resolutionForExpiredLookup,
  runPreparedBroadcast,
  serializeMergeReconciliations,
  submissionLifecycleStatus,
  trackPendingTransaction,
  trackedEnvelopeSubmissionStatus,
  transactionIdentity,
  upsertMergeReconciliation,
  type MergeReconciliation,
  type PendingTransaction,
  type PendingTransactionAction,
  type PreparedSubmissionIdentity,
  type SubmissionPreparedCallback,
  type SubmissionLifecycleStatus,
  type SubmissionResult,
  type TransactionTrackingState,
} from "@/lib/submission";

type Phase = "loading" | "empty" | "recovery" | "locked" | "unlocked";

type WalletApi = typeof import("@/lib/api");
type SwapApi = typeof import("@/lib/swap");
type MultisigApi = typeof import("@/lib/multisig");

let walletApiPromise: Promise<WalletApi> | null = null;
let swapApiPromise: Promise<SwapApi> | null = null;
let multisigApiPromise: Promise<MultisigApi> | null = null;

function loadWalletApi(): Promise<WalletApi> {
  walletApiPromise ??= import("@/lib/api").catch((error) => {
    walletApiPromise = null;
    throw error;
  });
  return walletApiPromise;
}

function loadSwapApi(): Promise<SwapApi> {
  swapApiPromise ??= import("@/lib/swap").catch((error) => {
    swapApiPromise = null;
    throw error;
  });
  return swapApiPromise;
}

function loadMultisigApi(): Promise<MultisigApi> {
  multisigApiPromise ??= import("@/lib/multisig").catch((error) => {
    multisigApiPromise = null;
    throw error;
  });
  return multisigApiPromise;
}

const DEFAULT_BASE_FEE_STROOPS = 100;

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

function withSigningSecret<T>(
  account: AccountMeta,
  hardwareSigner: HardwareSigner | undefined,
  operation: (secretKey: string | undefined) => T | Promise<T>,
): Promise<T> {
  return hardwareSigner
    ? Promise.resolve(operation(undefined))
    : withSecretKey(account.id, operation);
}

const PENDING_TX_STORAGE_KEY = "wallet.pending-transactions.v2";
const MERGE_RECONCILIATION_STORAGE_KEY = "wallet.merge-reconciliations.v2";
const TRANSACTION_POLL_MS = 15_000;
const FIAT_LIST: FiatCurrency[] = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"];

function restoreStorageValue(storage: Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // The original persistence error remains authoritative; no POST follows.
  }
}

interface WalletContextValue {
  phase: Phase;
  vaultStorageIssue: StorageIssue | null;
  network: NetworkKey;
  accounts: AccountMeta[];
  activeAccount: AccountMeta | null;
  archivedAccounts: AccountMeta[];
  balances: AssetBalance[] | null;
  minimumBalanceXlm: string | null;
  /** Bounded per-operation fee selected once for the active network. */
  recommendedBaseFeeStroops: number;
  dataError: string | null;
  /** Native XLM balance per publicKey — kept warm so the sidebar never flashes zero */
  accountBalances: Record<string, number>;
  /** Complete network-bound asset reads for truthful multi-account aggregation. */
  accountPortfolioSnapshots: Record<string, AccountPortfolioSnapshot>;
  claimableBalances: ClaimableBalanceItem[];
  activity: ActivityItem[];
  activityCursor: string | null;
  /** Accepted or transport-ambiguous transactions tracked by canonical hash. */
  pendingTxs: PendingTransaction[];
  retryPendingTransaction: (transaction: PendingTransaction) => void;
  /** Account merge submissions awaiting safe, on-chain-verified local reconciliation. */
  mergeReconciliations: MergeReconciliation[];
  retryMergeReconciliation: (record: MergeReconciliation) => void;
  submissionStatus: (submission: SubmissionResult) => SubmissionLifecycleStatus;
  envelopeSubmissionStatus: (
    xdr: string,
    network: NetworkKey,
  ) => SubmissionLifecycleStatus | null;
  dataLoading: boolean;
  loadingMore: boolean;
  xlmPriceUsd: number | null;
  priceData: PriceSeries | null;
  priceRange: PriceRange;
  changePriceRange: (r: PriceRange) => Promise<void>;
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
  addContact: (contact: Contact, previousAddress?: string) => Promise<void>;
  removeContact: (address: string) => Promise<void>;
  toggleContactFavorite: (address: string) => Promise<void>;

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
  unlockWithPasskey: () => Promise<void>;
  lock: () => void;
  resetWallet: () => Promise<void>;
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
    /** Durable domain journal hooks; both run inside the pre-POST boundary. */
    submissionJournal?: {
      onPrepared: SubmissionPreparedCallback;
      onRejected?: SubmissionPreparedCallback;
    };
  }) => Promise<SubmissionResult>;
  sendBatch: (params: {
    payments: Array<{
      destination: string;
      amount: string;
      assetCode: string;
      issuer?: string | null;
    }>;
    memo?: StellarMemoInput;
  }) => Promise<SubmissionResult>;
  claimAirdrop: (balanceId: string) => Promise<SubmissionResult>;
  mergeAccount: (destination: string) => Promise<SubmissionResult>;
  trustAsset: (params: { code: string; issuer: string; add: boolean }) => Promise<SubmissionResult>;
  /** Atomically add multiple trustlines in one transaction */
  trustAssets: (assets: Array<{ code: string; issuer: string }>) => Promise<SubmissionResult & { added: number }>;
  swap: (params: {
    sendCode: string;
    sendIssuer?: string | null;
    destCode: string;
    destIssuer?: string | null;
    intermediates: Asset[];
  } & (
    | {
        mode: "strict-send";
        sendAmount: string;
        destMin: string;
      }
    | {
        mode: "strict-receive";
        sendMax: string;
        destinationAmount: string;
      }
  )) => Promise<SubmissionResult>;
  /** Apply a multi-sig signer/threshold configuration to the active account */
  applyMultisigConfig: (config: MultisigConfig) => Promise<MultisigConfigOutcome>;
  /** Remove all cosigners and reset thresholds to single-sig defaults */
  disableMultisig: () => Promise<MultisigConfigOutcome>;
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
  cosignTransaction: (xdr: string, confirmedNetwork: NetworkKey | null) => Promise<CosignOutcome>;
  fundFromFriendbot: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

type WalletIdentityContextValue = Pick<
  WalletContextValue,
  | "network"
  | "accounts"
  | "activeAccount"
  | "archivedAccounts"
  | "revealRecoveryPhrase"
  | "lock"
  | "selectAccount"
  | "addAccount"
  | "addWatchOnly"
  | "addHardwareAccount"
  | "removeAccount"
  | "renameAccount"
  | "restoreArchivedAccount"
  | "restoreAccountByIndex"
  | "switchNetwork"
>;

type WalletLedgerContextValue = Pick<
  WalletContextValue,
  | "balances"
  | "minimumBalanceXlm"
  | "recommendedBaseFeeStroops"
  | "dataError"
  | "accountBalances"
  | "accountPortfolioSnapshots"
  | "claimableBalances"
  | "dataLoading"
  | "unfunded"
>;

type WalletActivityContextValue = Pick<
  WalletContextValue,
  "activity" | "activityCursor" | "loadingMore" | "loadMoreActivity"
>;

type WalletSubmissionContextValue = Pick<
  WalletContextValue,
  | "pendingTxs"
  | "retryPendingTransaction"
  | "mergeReconciliations"
  | "retryMergeReconciliation"
  | "submissionStatus"
  | "envelopeSubmissionStatus"
>;

type WalletMarketContextValue = Pick<
  WalletContextValue,
  "xlmPriceUsd" | "priceData" | "priceRange" | "changePriceRange" | "priceLoading" | "fiatRates"
>;

type WalletPreferencesContextValue = Pick<
  WalletContextValue,
  | "privacyMode"
  | "togglePrivacy"
  | "fiatCurrency"
  | "cycleFiatCurrency"
  | "changeFiatCurrency"
  | "autoLockMs"
  | "changeAutoLockMs"
>;

type WalletContactsContextValue = Pick<
  WalletContextValue,
  "contacts" | "addContact" | "removeContact" | "toggleContactFavorite"
>;

type WalletTransactionsContextValue = Pick<
  WalletContextValue,
  | "refresh"
  | "send"
  | "sendBatch"
  | "claimAirdrop"
  | "mergeAccount"
  | "trustAsset"
  | "trustAssets"
  | "swap"
  | "applyMultisigConfig"
  | "disableMultisig"
  | "prepareCosignPayment"
  | "cosignTransaction"
  | "fundFromFriendbot"
>;

const WalletIdentityContext = createContext<WalletIdentityContextValue | null>(null);
const WalletLedgerContext = createContext<WalletLedgerContextValue | null>(null);
const WalletActivityContext = createContext<WalletActivityContextValue | null>(null);
const WalletSubmissionContext = createContext<WalletSubmissionContextValue | null>(null);
const WalletMarketContext = createContext<WalletMarketContextValue | null>(null);
const WalletPreferencesContext = createContext<WalletPreferencesContextValue | null>(null);
const WalletContactsContext = createContext<WalletContactsContextValue | null>(null);
const WalletTransactionsContext = createContext<WalletTransactionsContextValue | null>(null);

interface WalletPhaseContextValue {
  phase: Phase;
  vaultStorageIssue: StorageIssue | null;
}

type WalletLifecycleActionsValue = Pick<
  WalletContextValue,
  | "createWallet"
  | "createHardwareVault"
  | "completeSetup"
  | "unlock"
  | "unlockWithPasskey"
  | "resetWallet"
  | "restoreWalletFromBackup"
>;

const WalletPhaseContext = createContext<WalletPhaseContextValue | null>(null);
const WalletLifecycleActionsContext = createContext<WalletLifecycleActionsValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("loading");
  const [vaultStorageIssue, setVaultStorageIssue] = useState<StorageIssue | null>(null);
  const [network, setNetworkState] = useState<NetworkKey>("testnet");
  const [accounts, setAccounts] = useState<AccountMeta[]>([]);
  const [archivedAccounts, setArchivedAccounts] = useState<AccountMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [balances, setBalances] = useState<AssetBalance[] | null>(null);
  const [minimumBalanceXlm, setMinimumBalanceXlm] = useState<string | null>(null);
  const [recommendedFeeSelection, setRecommendedFeeSelection] = useState<{
    network: NetworkKey;
    baseFeeStroops: number;
  }>(() => ({ network: "testnet", baseFeeStroops: DEFAULT_BASE_FEE_STROOPS }));
  const recommendedBaseFeeStroops = recommendedFeeSelection.network === network
    ? recommendedFeeSelection.baseFeeStroops
    : DEFAULT_BASE_FEE_STROOPS;
  const feeSelectionGeneration = useRef(0);
  const [dataError, setDataError] = useState<string | null>(null);
  const [horizonStreamState, setHorizonStreamState] =
    useState<HorizonStreamState>("connecting");
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({});
  const [accountPortfolioSnapshots, setAccountPortfolioSnapshots] = useState<
    Record<string, AccountPortfolioSnapshot>
  >({});
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
  const accountBalancesRef = useRef<() => Promise<void>>(async () => undefined);
  const [claimableBalances, setClaimableBalances] = useState<ClaimableBalanceItem[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  // Mirror of `activity` for readers inside callbacks (declared before any effect)
  const activityRef = useRef<ActivityItem[]>([]);
  const [transactionTracking, setTransactionTracking] = useState<TransactionTrackingState>({
    pending: [],
    resolutions: {},
  });
  const transactionTrackingRef = useRef<TransactionTrackingState>({ pending: [], resolutions: {} });
  const pendingTxs = transactionTracking.pending;
  const submissionResolutions = transactionTracking.resolutions;
  const [mergeReconciliations, setMergeReconciliations] = useState<MergeReconciliation[]>([]);
  const mergeReconciliationsRef = useRef<MergeReconciliation[]>([]);
  const [pendingTxsHydrated, setPendingTxsHydrated] = useState(false);
  const pendingPolls = useRef(new Set<string>());
  const pendingPollTimers = useRef(new Map<string, number>());
  const mergeReconciliationInFlight = useRef(new Set<string>());
  const mergeReconciliationTimers = useRef(new Map<string, number>());
  const trackingTaskGeneration = useRef(0);
  const [trackingRestartNonce, setTrackingRestartNonce] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [xlmPriceUsd, setXlmPriceUsd] = useState<number | null>(null);
  const [priceData, setPriceData] = useState<PriceSeries | null>(null);
  const [priceRange, setPriceRangeState] = useState<PriceRange>("7D");
  const [priceLoading, setPriceLoading] = useState(false);
  const priceCache = useRef<Partial<Record<PriceRange, PriceSeries>>>({});
  const [privacyMode, setPrivacyMode] = useState(false);
  const [fiatCurrency, setFiatCurrencyState] = useState<FiatCurrency>("USD");
  const [fiatRates, setFiatRates] = useState<FiatRates>({ USD: 1 });
  const [autoLockMs, setAutoLockMsState] = useState(15 * 60 * 1000);
  const [endpointRevision, setEndpointRevision] = useState(0);
  const endpointRevisionRef = useRef(0);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tabSenderId] = useState(createTabSenderId);
  const [accountRefreshLane] = useState(createLatestRequestLane);
  const [marketRefreshLane] = useState(createLatestRequestLane);
  const walletCoordinationRef = useRef<WalletCoordination | null>(null);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeId) ?? null,
    [accounts, activeId],
  );
  const unfunded = phase === "unlocked" && balances !== null && balances.length === 0;

  useEffect(() => {
    const refreshEndpoints = () => {
      endpointRevisionRef.current += 1;
      setEndpointRevision(endpointRevisionRef.current);
    };
    const refreshStoredEndpoint = (event: StorageEvent) => {
      if (event.key?.startsWith("wallet.endpoint.") || event.key?.startsWith("wallet.horizon.")) {
        refreshEndpoints();
      }
    };
    window.addEventListener(STELLAR_ENDPOINTS_CHANGED_EVENT, refreshEndpoints);
    window.addEventListener("storage", refreshStoredEndpoint);
    return () => {
      window.removeEventListener(STELLAR_ENDPOINTS_CHANGED_EVENT, refreshEndpoints);
      window.removeEventListener("storage", refreshStoredEndpoint);
    };
  }, []);

  useEffect(() => {
    if (phase !== "unlocked") return;
    const generation = ++feeSelectionGeneration.current;
    void loadWalletApi()
      .then((api) => api.loadRecommendedBaseFee(network))
      .then((fee) => {
        if (generation === feeSelectionGeneration.current) {
          setRecommendedFeeSelection({ network, baseFeeStroops: fee });
        }
      })
      .catch(() => {
        // The default base fee remains safe; a later endpoint/network change retries the chunk.
      });
  }, [endpointRevision, network, phase]);

  const commitTransactionTracking = useCallback(
    (update: (current: TransactionTrackingState) => TransactionTrackingState) => {
      const next = update(transactionTrackingRef.current);
      transactionTrackingRef.current = next;
      setTransactionTracking(next);
    },
    [],
  );

  const commitMergeReconciliations = useCallback(
    (update: (current: MergeReconciliation[]) => MergeReconciliation[]) => {
      const next = update(mergeReconciliationsRef.current);
      mergeReconciliationsRef.current = next;
      setMergeReconciliations(next);
    },
    [],
  );

  const invalidateTrackingTasks = useCallback(() => {
    trackingTaskGeneration.current += 1;
    for (const timer of pendingPollTimers.current.values()) window.clearTimeout(timer);
    pendingPollTimers.current.clear();
    pendingPolls.current.clear();
    for (const timer of mergeReconciliationTimers.current.values()) window.clearTimeout(timer);
    mergeReconciliationTimers.current.clear();
    mergeReconciliationInFlight.current.clear();
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      commitTransactionTracking((current) => ({
        ...current,
        pending: loadDurablePendingTransactions(
          window.localStorage,
          PENDING_TX_STORAGE_KEY,
        ),
      }));
      const restoredMerges = loadDurableMergeReconciliations(
          window.localStorage,
          MERGE_RECONCILIATION_STORAGE_KEY,
        );
      commitMergeReconciliations(() => restoredMerges);
      setPendingTxsHydrated(true);
    })();
    return () => {
      alive = false;
    };
  }, [commitMergeReconciliations, commitTransactionTracking]);

  useEffect(() => {
    if (!pendingTxsHydrated) return;
    let errorTimer: number | undefined;
    try {
      if (mergeReconciliations.length === 0) {
        window.localStorage.removeItem(MERGE_RECONCILIATION_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          MERGE_RECONCILIATION_STORAGE_KEY,
          serializeMergeReconciliations(mergeReconciliations),
        );
      }
    } catch {
      errorTimer = window.setTimeout(() => {
        setDataError("Transaction recovery could not be updated in persistent storage.");
      }, 0);
    }
    return () => {
      if (errorTimer !== undefined) window.clearTimeout(errorTimer);
    };
  }, [mergeReconciliations, pendingTxsHydrated]);

  // Load the Connect bundle before a transaction click. The Trezor-hosted
  // popup must be opened while browser user activation is still available,
  // so signing should not first wait for a cold dynamic import.
  useEffect(() => {
    if (phase === "unlocked" && activeAccount?.hardware === "trezor") {
      void import("@/lib/hardware")
        .then(({ warmTrezorConnect }) => warmTrezorConnect())
        .catch(() => {
          // The interactive hardware action retries and surfaces a useful error.
        });
    }
  }, [phase, activeAccount?.hardware]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      const net = loadNetworkPref();
      setNetworkState(net);
      setPrivacyMode(window.localStorage.getItem("stellarkey.privacy.v1") === "1");
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
      setContacts([]);
      const vaultResult = loadVaultResult();
      if (vaultResult.kind !== "ready") {
        if (vaultResult.kind === "absent") {
          setPhase("empty");
          return;
        }
        setVaultStorageIssue(vaultResult);
        setPhase("recovery");
        return;
      }
      if (vaultResult.value.accounts.length === 0) {
        setPhase("empty");
        return;
      }
      const vault = vaultResult.value;
      setAccounts(vault.accounts.map(stripSecret));
      setArchivedAccounts((vault.archivedAccounts ?? []).map(stripSecret));
      setActiveId(vault.activeAccountId ?? vault.accounts[0].id);
      setPhase("locked");
    })();
    return () => {
      alive = false;
    };
  }, []);

  const refreshAccountData = useCallback(async () => {
    if (!activeAccount) return;
    const request = accountRefreshLane.begin();
    const generation = ++refreshGeneration.current;
    const cacheKey = `${network}:${endpointRevision}:${activeAccount.publicKey}`;
    const portfolioKey = portfolioSnapshotKey(network, activeAccount.publicKey);
    setAccountPortfolioSnapshots((previous) => {
      const existing = previous[portfolioKey];
      return {
        ...previous,
        [portfolioKey]: {
          publicKey: activeAccount.publicKey,
          network,
          status: existing?.status === "ready" ? "ready" : "loading",
          balances: existing?.balances ?? null,
          updatedAt: existing?.updatedAt ?? null,
          error: null,
        },
      };
    });
    setDataLoading(true);
    setDataError(null);
    try {
      const api = await loadWalletApi();
      const resources = await settleResourceMap({
        accountSnapshot: api.fetchAccountSnapshot(
          activeAccount.publicKey,
          network,
          request.signal,
        ),
        baseReserve: api.fetchCurrentBaseReserve(network),
        claimableBalances: api.fetchClaimableBalances(
          activeAccount.publicKey,
          network,
          request.signal,
        ),
        activity: api.fetchActivity(
          activeAccount.publicKey,
          network,
          30,
          undefined,
          request.signal,
        ),
      });
      if (generation !== refreshGeneration.current || !request.isCurrent()) return;
      const minimumBalance = resources.accountSnapshot.ok && resources.baseReserve.ok
        ? api.minimumNativeBalanceForSnapshot(
            resources.accountSnapshot.value,
            resources.baseReserve.value,
          )
        : null;
      if (resources.accountSnapshot.ok) {
        const nextBalances = resources.accountSnapshot.value.balances;
        setBalances(nextBalances);
        setAccountPortfolioSnapshots((previous) => ({
          ...previous,
          [portfolioKey]: {
            publicKey: activeAccount.publicKey,
            network,
            status: "ready",
            balances: nextBalances,
            updatedAt: Date.now(),
            error: null,
          },
        }));
      } else {
        const accountSnapshotError = resources.accountSnapshot.error.message;
        setAccountPortfolioSnapshots((previous) => ({
          ...previous,
          [portfolioKey]: {
            publicKey: activeAccount.publicKey,
            network,
            status: "unavailable",
            balances: previous[portfolioKey]?.balances ?? null,
            updatedAt: previous[portfolioKey]?.updatedAt ?? null,
            error: accountSnapshotError,
          },
        }));
      }
      if (minimumBalance !== null) setMinimumBalanceXlm(minimumBalance);
      if (resources.claimableBalances.ok) setClaimableBalances(resources.claimableBalances.value);
      // Merge the fresh first page into any already-loaded history instead of
      // replacing it — the poll must never wipe pages the user scrolled through.
      if (resources.activity.ok) {
        const hadHistory = activityRef.current.length > 0;
        const acts = resources.activity.value;
        setActivity((prev) => {
          if (prev.length === 0) return acts.items;
          const seen = new Set(prev.map((i) => i.id));
          const fresh = acts.items.filter((i) => !seen.has(i.id));
          return fresh.length > 0 ? [...fresh, ...prev] : prev;
        });
        if (!hadHistory) setActivityCursor(acts.nextCursor);
      }
      if (resources.accountSnapshot.ok) {
        const bals = resources.accountSnapshot.value.balances;
        const nativeBal = bals.find((b) => b.isNative);
        setAccountBalances((prev) => ({
          ...prev,
          [activeAccount.publicKey]: nativeBal ? parseFloat(nativeBal.balance) : 0,
        }));
      }
      if (resources.accountSnapshot.ok && resources.activity.ok && minimumBalance !== null) {
        snapshotCache.current.set(cacheKey, {
          balances: resources.accountSnapshot.value.balances,
          activity: resources.activity.value.items,
          cursor: resources.activity.value.nextCursor,
          minimumBalanceXlm: minimumBalance,
        });
      }
      setDataError(describeResourceFailures(resources));
    } catch (error) {
      if (generation === refreshGeneration.current && request.isCurrent()) {
        const message = error instanceof Error ? error.message : "Unable to refresh wallet data.";
        setDataError(message);
        setAccountPortfolioSnapshots((previous) => ({
          ...previous,
          [portfolioKey]: {
            publicKey: activeAccount.publicKey,
            network,
            status: "unavailable",
            balances: previous[portfolioKey]?.balances ?? null,
            updatedAt: previous[portfolioKey]?.updatedAt ?? null,
            error: message,
          },
        }));
      }
    } finally {
      if (generation === refreshGeneration.current && request.isCurrent()) setDataLoading(false);
    }
  }, [accountRefreshLane, activeAccount, endpointRevision, network]);

  const refreshMarketData = useCallback(async () => {
    if (!activeAccount) return;
    const request = marketRefreshLane.begin();
    const cachedSeries = priceCache.current[priceRange];
    setPriceLoading(true);
    try {
      const api = await loadWalletApi();
      const resources = await settleResourceMap({
        // The market chart remains useful on testnet, but portfolio valuation
        // explicitly ignores all testnet balances.
        xlmPrice: api.fetchXlmPrice(request.signal),
        priceSeries: cachedSeries
          ? Promise.resolve(cachedSeries)
          : api.fetchXlmSeries(priceRange, request.signal),
        fiatRates: fetchFiatRates(request.signal),
      });
      if (!request.isCurrent()) return;
      if (resources.xlmPrice.ok && resources.xlmPrice.value !== null) {
        setXlmPriceUsd(resources.xlmPrice.value);
      }
      if (resources.fiatRates.ok) setFiatRates(resources.fiatRates.value);
      if (resources.priceSeries.ok && resources.priceSeries.value !== null) {
        const series = resources.priceSeries.value;
        priceCache.current[series.range] = series;
        setPriceData(series);
      }
    } finally {
      if (request.isCurrent()) setPriceLoading(false);
    }
  }, [activeAccount, marketRefreshLane, priceRange]);

  const refresh = useCallback(async () => {
    await Promise.all([
      refreshAccountData(),
      refreshMarketData(),
      accountBalancesRef.current(),
    ]);
  }, [refreshAccountData, refreshMarketData]);

  const accountRefreshRef = useRef(refreshAccountData);
  useEffect(() => {
    accountRefreshRef.current = refreshAccountData;
  }, [refreshAccountData]);

  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  // Keep a complete asset snapshot for every other account. Native balances
  // remain projected separately for the compact account switcher.
  const refreshAccountBalances = useCallback(async () => {
    const backgroundAccounts = accounts.filter(
      (account) => account.publicKey !== activeAccount?.publicKey,
    );
    if (backgroundAccounts.length === 0) return;
    const generation = ++accountBalanceGeneration.current;
    const startedEndpointRevision = endpointRevision;
    setAccountPortfolioSnapshots((previous) => {
      const next = { ...previous };
      for (const account of backgroundAccounts) {
        const key = portfolioSnapshotKey(network, account.publicKey);
        const existing = previous[key];
        if (existing?.status === "ready") continue;
        next[key] = {
          publicKey: account.publicKey,
          network,
          status: "loading",
          balances: existing?.balances ?? null,
          updatedAt: existing?.updatedAt ?? null,
          error: null,
        };
      }
      return next;
    });
    let api: WalletApi;
    try {
      api = await loadWalletApi();
    } catch (error) {
      if (
        generation !== accountBalanceGeneration.current ||
        startedEndpointRevision !== endpointRevisionRef.current
      ) return;
      const message = error instanceof Error ? error.message : "Account data unavailable.";
      setAccountPortfolioSnapshots((previous) => {
        const next = { ...previous };
        for (const account of backgroundAccounts) {
          const key = portfolioSnapshotKey(network, account.publicKey);
          next[key] = {
            publicKey: account.publicKey,
            network,
            status: "unavailable",
            balances: previous[key]?.balances ?? null,
            updatedAt: previous[key]?.updatedAt ?? null,
            error: message,
          };
        }
        return next;
      });
      return;
    }
    const results = await Promise.allSettled(
      backgroundAccounts.map(async (account) => ({
        publicKey: account.publicKey,
        snapshot: await api.fetchAccountSnapshot(account.publicKey, network),
      })),
    );
    if (
      generation !== accountBalanceGeneration.current ||
      startedEndpointRevision !== endpointRevisionRef.current
    ) return;
    const observedAt = Date.now();
    setAccountPortfolioSnapshots((previous) => {
      const next = { ...previous };
      results.forEach((result, index) => {
        const publicKey = backgroundAccounts[index].publicKey;
        const key = portfolioSnapshotKey(network, publicKey);
        if (result.status === "fulfilled") {
          next[key] = {
            publicKey,
            network,
            status: "ready",
            balances: result.value.snapshot.balances,
            updatedAt: observedAt,
            error: null,
          };
        } else {
          next[key] = {
            publicKey,
            network,
            status: "unavailable",
            balances: previous[key]?.balances ?? null,
            updatedAt: previous[key]?.updatedAt ?? null,
            error: result.reason instanceof Error ? result.reason.message : "Account data unavailable.",
          };
        }
      });
      return next;
    });
    setAccountBalances((previous) => {
      const next = { ...previous };
      for (const result of results) {
        if (result.status === "fulfilled") {
          const native = result.value.snapshot.balances.find((balance) => balance.isNative);
          next[result.value.publicKey] = native ? Number(native.balance) : 0;
        }
      }
      return next;
    });
  }, [accounts, activeAccount?.publicKey, endpointRevision, network]);

  useEffect(() => {
    accountBalancesRef.current = refreshAccountBalances;
  }, [refreshAccountBalances]);

  const activePublicKey = activeAccount?.publicKey ?? null;
  const walletRefreshEnabled = phase === "unlocked" && activePublicKey !== null;
  const accountPollIntervalMs = horizonStreamPollInterval(horizonStreamState);
  const backgroundRefreshKey = `${network}:${endpointRevision}:portfolio:${
    activePublicKey ?? "none"
  }:${accounts.map((account) => account.publicKey).join(",")}`;
  useVisibleWalletRefresh(
    refreshAccountData,
    walletRefreshEnabled,
    accountPollIntervalMs,
    `${network}:${endpointRevision}:${activePublicKey ?? "none"}`,
  );
  useVisibleWalletRefresh(
    refreshMarketData,
    walletRefreshEnabled,
    WALLET_MARKET_POLL_MS,
    "market",
  );
  useVisibleWalletRefresh(
    refreshAccountBalances,
    walletRefreshEnabled && accounts.length > 1,
    WALLET_BACKGROUND_POLL_MS,
    backgroundRefreshKey,
    walletBackgroundStaggerMs(backgroundRefreshKey),
  );

  useEffect(
    () => () => {
      accountRefreshLane.cancel();
      marketRefreshLane.cancel();
    },
    [accountRefreshLane, marketRefreshLane],
  );

  // Real-time Horizon Server-Sent Event stream
  useEffect(() => {
    if (
      phase !== "unlocked" ||
      !activePublicKey ||
      typeof window === "undefined"
    ) {
      return;
    }
    if (typeof window.EventSource === "undefined") {
      const unavailableTimer = window.setTimeout(
        () => setHorizonStreamState("degraded"),
        0,
      );
      return () => window.clearTimeout(unavailableTimer);
    }
    const horizonUrl = getHorizonUrl(network);
    let es: EventSource | null = null;
    let alive = true;
    let stateTimer: number | null = window.setTimeout(() => {
      stateTimer = null;
      if (alive) setHorizonStreamState("connecting");
    }, 0);
    const reportStreamState = (state: HorizonStreamState) => {
      if (!alive) return;
      if (stateTimer !== null) {
        window.clearTimeout(stateTimer);
        stateTimer = null;
      }
      setHorizonStreamState(state);
    };
    try {
      es = new EventSource(
        `${horizonUrl}/accounts/${activePublicKey}/operations?cursor=now`,
      );
      es.onopen = () => {
        reportStreamState("open");
      };
      es.onerror = () => {
        reportStreamState("degraded");
      };
      es.onmessage = () => {
        if (!alive) return;
        reportStreamState("open");
        triggerHaptic("success");
        void accountRefreshRef.current();
      };
    } catch {
      if (stateTimer !== null) window.clearTimeout(stateTimer);
      stateTimer = window.setTimeout(() => {
        stateTimer = null;
        reportStreamState("degraded");
      }, 0);
    }

    return () => {
      alive = false;
      if (stateTimer !== null) window.clearTimeout(stateTimer);
      if (es) es.close();
    };
  }, [phase, activePublicKey, endpointRevision, network]);

  const lockVaultAndReset = useCallback((notifyPeers = true) => {
    lockVault();
    refreshGeneration.current += 1;
    accountBalanceGeneration.current += 1;
    setAccountPortfolioSnapshots({});
    setContacts([]);
    setPhase("locked");
    setDataLoading(false);
    if (notifyPeers) walletCoordinationRef.current?.post("wallet-lock");
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

  const pollPendingRef = useRef<(transaction: PendingTransaction) => Promise<void>>(async () => {});
  const pollPending = useCallback(async (transaction: PendingTransaction) => {
    const startedGeneration = trackingTaskGeneration.current;
    const identity = transactionIdentity(transaction);
    if (pendingPolls.current.has(identity)) return;
    pendingPolls.current.add(identity);
    const scheduled = pendingPollTimers.current.get(identity);
    if (scheduled !== undefined) {
      window.clearTimeout(scheduled);
      pendingPollTimers.current.delete(identity);
    }

    const expired = transaction.expiresAt !== undefined &&
      transaction.expiresAt * 1000 <= Date.now();
    const api = await loadWalletApi();
    const expiredLookup = expired
      ? await api.lookupCanonicalTransaction(transaction.network, transaction.hash)
      : null;
    const outcome = expiredLookup
      ? resolutionForExpiredLookup(expiredLookup)
      : await api.waitForTransaction(transaction.network, transaction.hash);
    if (startedGeneration === trackingTaskGeneration.current) {
      pendingPolls.current.delete(identity);
    }
    if (!isTrackingTaskCurrent(
      startedGeneration,
      trackingTaskGeneration.current,
      transaction,
      transactionTrackingRef.current.pending,
    )) {
      return;
    }
    if (outcome === true || outcome === false) {
      const resolvedAt = Date.now();
      if (outcome && transaction.action?.kind === "reconcile_account_merge") {
        const reconciliation = createMergeReconciliation(transaction);
        persistMergeReconciliation(
          window.localStorage,
          MERGE_RECONCILIATION_STORAGE_KEY,
          reconciliation,
        );
        commitMergeReconciliations((current) =>
          upsertMergeReconciliation(current, reconciliation));
      } else if (!outcome && transaction.action?.kind === "reconcile_account_merge") {
        const nextMerges = mergeReconciliationsRef.current.filter((record) =>
          transactionIdentity(record) !== identity);
        persistMergeReconciliationQueue(
          window.localStorage,
          MERGE_RECONCILIATION_STORAGE_KEY,
          nextMerges,
        );
        const timer = mergeReconciliationTimers.current.get(identity);
        if (timer !== undefined) window.clearTimeout(timer);
        mergeReconciliationTimers.current.delete(identity);
        commitMergeReconciliations(() => nextMerges);
      }
      removeDurablePendingTransaction(
        window.localStorage,
        PENDING_TX_STORAGE_KEY,
        transaction,
      );
      commitTransactionTracking((current) =>
        applyTransactionPoll(current, transaction, outcome, resolvedAt).tracking);
      const failedMessage = expiredLookup === "not_found"
        ? `${transaction.label} expired and was not found on-chain. It can be reviewed and retried.`
        : `${transaction.label} failed on-chain`;
      toast(outcome ? `${transaction.label} confirmed` : failedMessage, outcome ? "success" : "error");
      await accountRefreshRef.current();
      return;
    }

    // An expired envelope with an unavailable lookup stays conservatively
    // locked, but automatic polling stops. The dashboard exposes a bounded
    // manual status check so outages cannot create an infinite request loop.
    if (expired) return;

    const timer = window.setTimeout(() => {
      pendingPollTimers.current.delete(identity);
      if (!isTrackingTaskCurrent(
        startedGeneration,
        trackingTaskGeneration.current,
        transaction,
        transactionTrackingRef.current.pending,
      )) {
        return;
      }
      void pollPendingRef.current(transaction);
    }, TRANSACTION_POLL_MS);
    pendingPollTimers.current.set(identity, timer);
  }, [commitMergeReconciliations, commitTransactionTracking, toast]);

  useEffect(() => {
    pollPendingRef.current = pollPending;
  }, [pollPending]);

  useEffect(() => {
    if (!pendingTxsHydrated) return;
    const refreshPendingTransactions = (event: StorageEvent) => {
      if (
        event.key !== PENDING_TX_STORAGE_KEY &&
        !event.key?.startsWith(pendingTransactionStoragePrefix(PENDING_TX_STORAGE_KEY))
      ) {
        return;
      }
      const restored = loadDurablePendingTransactions(
        window.localStorage,
        PENDING_TX_STORAGE_KEY,
      );
      const previousIdentities = new Set(
        transactionTrackingRef.current.pending.map(transactionIdentity),
      );
      commitTransactionTracking((current) => ({ ...current, pending: restored }));
      for (const transaction of restored) {
        if (!previousIdentities.has(transactionIdentity(transaction))) {
          void pollPendingRef.current(transaction);
        }
      }
    };
    window.addEventListener("storage", refreshPendingTransactions);
    return () => window.removeEventListener("storage", refreshPendingTransactions);
  }, [commitTransactionTracking, pendingTxsHydrated]);

  const restoredPendingStarted = useRef(false);
  useEffect(() => {
    if (!pendingTxsHydrated || restoredPendingStarted.current) return;
    restoredPendingStarted.current = true;
    for (const transaction of pendingTxs) void pollPendingRef.current(transaction);
  }, [pendingTxs, pendingTxsHydrated]);

  useEffect(() => () => {
    invalidateTrackingTasks();
  }, [invalidateTrackingTasks]);

  const prepareSubmissionTracking = useCallback((
    prepared: PreparedSubmissionIdentity,
    label: string,
    action?: PendingTransactionAction,
  ) => {
    const identity = transactionIdentity(prepared);
    const current = transactionTrackingRef.current;
    if (
      current.pending.some((entry) => transactionIdentity(entry) === identity) ||
      current.resolutions[identity]?.status === "confirmed"
    ) {
      throw new Error("This exact transaction is already being tracked.");
    }

    const provisional = pendingTransactionFromPrepared(prepared, label, action);
    const nextTracking = trackPendingTransaction(current, provisional);
    const previousMerges = action?.kind === "reconcile_account_merge"
      ? window.localStorage.getItem(MERGE_RECONCILIATION_STORAGE_KEY)
      : null;
    const reconciliation = action?.kind === "reconcile_account_merge"
      ? createMergeReconciliation(prepared)
      : null;

    try {
      // For account merge, write the cross-session recovery handle first. A
      // crash after this point still leaves enough authority-free data to
      // inspect Horizon safely on the next launch.
      if (reconciliation) {
        persistMergeReconciliation(
          window.localStorage,
          MERGE_RECONCILIATION_STORAGE_KEY,
          reconciliation,
        );
      }
      persistDurablePendingTransaction(
        window.localStorage,
        PENDING_TX_STORAGE_KEY,
        provisional,
      );
    } catch (error) {
      if (reconciliation) {
        restoreStorageValue(
          window.localStorage,
          MERGE_RECONCILIATION_STORAGE_KEY,
          previousMerges,
        );
      }
      throw error;
    }

    commitTransactionTracking(() => nextTracking);
    if (reconciliation) {
      commitMergeReconciliations((records) =>
        upsertMergeReconciliation(records, reconciliation));
    }
  }, [commitMergeReconciliations, commitTransactionTracking]);

  const discardPreparedSubmission = useCallback((
    prepared: PreparedSubmissionIdentity,
    action?: PendingTransactionAction,
  ) => {
    const identity = transactionIdentity(prepared);
    const nextTracking = removeTrackedTransaction(transactionTrackingRef.current, prepared);
    const nextMerges = action?.kind === "reconcile_account_merge"
      ? mergeReconciliationsRef.current.filter((record) =>
          transactionIdentity(record) !== identity)
      : mergeReconciliationsRef.current;
    const previousPending = transactionTrackingRef.current.pending.find((record) =>
      transactionIdentity(record) === identity);
    const previousMerges = action?.kind === "reconcile_account_merge"
      ? window.localStorage.getItem(MERGE_RECONCILIATION_STORAGE_KEY)
      : null;

    try {
      removeDurablePendingTransaction(window.localStorage, PENDING_TX_STORAGE_KEY, prepared);
      if (action?.kind === "reconcile_account_merge") {
        if (nextMerges.length === 0) {
          window.localStorage.removeItem(MERGE_RECONCILIATION_STORAGE_KEY);
        } else {
          window.localStorage.setItem(
            MERGE_RECONCILIATION_STORAGE_KEY,
            serializeMergeReconciliations(nextMerges),
          );
        }
      }
    } catch (error) {
      if (previousPending) {
        try {
          persistDurablePendingTransaction(
            window.localStorage,
            PENDING_TX_STORAGE_KEY,
            previousPending,
          );
        } catch {
          // The original storage error remains authoritative.
        }
      }
      if (action?.kind === "reconcile_account_merge") {
        restoreStorageValue(
          window.localStorage,
          MERGE_RECONCILIATION_STORAGE_KEY,
          previousMerges,
        );
      }
      throw error;
    }

    commitTransactionTracking(() => nextTracking);
    if (action?.kind === "reconcile_account_merge") {
      const timer = mergeReconciliationTimers.current.get(identity);
      if (timer !== undefined) window.clearTimeout(timer);
      mergeReconciliationTimers.current.delete(identity);
      commitMergeReconciliations(() => nextMerges);
    }
  }, [commitMergeReconciliations, commitTransactionTracking]);

  const trackSubmission = useCallback((
    result: SubmissionResult,
    label: string,
    action?: PendingTransactionAction,
  ) => {
    const pending = pendingTransactionFromSubmission(result, label, action);
    if (!pending) {
      const confirmed: PendingTransaction = {
        hash: result.hash,
        network: result.network,
        label,
        status: "confirming",
        createdAt: Date.now(),
        ...(action ? { action } : {}),
      };
      commitTransactionTracking((current) =>
        applyTransactionPoll(current, confirmed, true).tracking);
      toast(`${label} confirmed`, "success");
      void accountRefreshRef.current();
      return;
    }
    persistDurablePendingTransaction(window.localStorage, PENDING_TX_STORAGE_KEY, pending);
    commitTransactionTracking((current) => trackPendingTransaction(current, pending));
    const presentation = pendingTransactionPresentation(pending);
    toast(presentation.detail, "info");
    void pollPendingRef.current(pending);
  }, [commitTransactionTracking, toast]);

  const runTrackedBroadcast = useCallback(async <T,>(
    label: string,
    action: PendingTransactionAction | undefined,
    broadcast: (onPrepared: SubmissionPreparedCallback) => Promise<T>,
    submissionFromResult: (result: T) => SubmissionResult | null,
    journal?: {
      onPrepared: SubmissionPreparedCallback;
      onRejected?: SubmissionPreparedCallback;
    },
  ): Promise<T> => {
    return runPreparedBroadcast({
      broadcast,
      prepare: async (identity) => {
        prepareSubmissionTracking(identity, label, action);
        await journal?.onPrepared(identity);
      },
      discard: async (identity) => {
        discardPreparedSubmission(identity, action);
        await journal?.onRejected?.(identity);
      },
      finalize: (result) => {
        const submission = submissionFromResult(result);
        if (submission) trackSubmission(submission, label, action);
      },
    });
  }, [discardPreparedSubmission, prepareSubmissionTracking, trackSubmission]);

  const retryPendingTransaction = useCallback((transaction: PendingTransaction) => {
    void pollPendingRef.current(transaction);
  }, []);

  const submissionStatus = useCallback(
    (submission: SubmissionResult) =>
      submissionLifecycleStatus(submission, submissionResolutions),
    [submissionResolutions],
  );

  const envelopeSubmissionStatus = useCallback(
    (xdr: string, selectedNetwork: NetworkKey) =>
      trackedEnvelopeSubmissionStatus(xdr, selectedNetwork, transactionTracking),
    [transactionTracking],
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

  const installUnlockedVault = useCallback(async (
    vault: Awaited<ReturnType<typeof unlockVault>>,
  ) => {
    const privateContacts = await loadContacts();
    setAccounts(vault.accounts.map(stripSecret));
    setArchivedAccounts((vault.archivedAccounts ?? []).map(stripSecret));
    setActiveId(vault.activeAccountId ?? vault.accounts[0]?.id ?? null);
    setBalances(null);
    setMinimumBalanceXlm(null);
    setDataError(null);
    setClaimableBalances([]);
    setActivity([]);
    setContacts(privateContacts);
    setPhase("unlocked");
  }, []);

  const unlock = useCallback(async (password: string) => {
    await installUnlockedVault(await unlockVault(password));
  }, [installUnlockedVault]);

  const unlockWithPasskey = useCallback(async () => {
    await installUnlockedVault(await unlockVaultWithPasskey());
  }, [installUnlockedVault]);

  const lock = useCallback(() => {
    lockVaultAndReset();
  }, [lockVaultAndReset]);

  const resetWallet = useCallback(async (notifyPeers = true): Promise<void> => {
    invalidateTrackingTasks();
    if (typeof indexedDB !== "undefined") await getMerchantRepository().clear();
    wipeVault();
    clearDurableMergeReconciliations(
      window.localStorage,
      MERGE_RECONCILIATION_STORAGE_KEY,
    );
    clearDurablePendingTransactions(
      window.localStorage,
      PENDING_TX_STORAGE_KEY,
    );
    setAccounts([]);
    setArchivedAccounts([]);
    setActiveId(null);
    setBalances(null);
    setMinimumBalanceXlm(null);
    setDataError(null);
    setAccountBalances({});
    setAccountPortfolioSnapshots({});
    snapshotCache.current.clear();
    setActivity([]);
    setPriceData(null);
    setContacts([]);
    commitTransactionTracking(() => ({ pending: [], resolutions: {} }));
    commitMergeReconciliations(() => []);
    setVaultStorageIssue(null);
    setPhase("empty");
    if (notifyPeers) walletCoordinationRef.current?.post("wallet-reset");
  }, [commitMergeReconciliations, commitTransactionTracking, invalidateTrackingTasks]);

  useEffect(() => {
    const coordination = openWalletCoordination(tabSenderId, (signal) => {
      if (signal.type === "wallet-reset") {
        void resetWallet(false);
      } else if (phase === "unlocked") {
        lockVaultAndReset(false);
      } else {
        lockVault();
      }
    });
    walletCoordinationRef.current = coordination;
    return () => {
      walletCoordinationRef.current = null;
      coordination.close();
    };
  }, [lockVaultAndReset, phase, resetWallet, tabSenderId]);

  const restoreWalletFromBackup = useCallback(async (json: string, password?: string): Promise<VaultRestoreResult> => {
    invalidateTrackingTasks();
    let result: VaultRestoreResult;
    try {
      result = await restoreVaultBackup(json, password);
    } catch (error) {
      setTrackingRestartNonce((current) => current + 1);
      throw error;
    }
    const vault = loadVault();
    if (vault) {
      setAccounts(vault.accounts.map(stripSecret));
      setArchivedAccounts((vault.archivedAccounts ?? []).map(stripSecret));
      setActiveId(vault.activeAccountId ?? vault.accounts[0]?.id ?? null);
    }
    setContacts([]);
    setBalances(null);
    setClaimableBalances([]);
    setActivity([]);
    setActivityCursor(null);
    commitTransactionTracking(() => ({ pending: [], resolutions: {} }));
    commitMergeReconciliations(() => []);
    clearDurableMergeReconciliations(
      window.localStorage,
      MERGE_RECONCILIATION_STORAGE_KEY,
    );
    clearDurablePendingTransactions(
      window.localStorage,
      PENDING_TX_STORAGE_KEY,
    );
    clearSessionSecrets();
    // Wallet is restored but LOCKED — unlock with the backup's password
    setPhase("locked");
    return result;
  }, [commitMergeReconciliations, commitTransactionTracking, invalidateTrackingTasks]);

  const selectAccount = useCallback((id: string) => {
    const vault = setActiveStoredAccount(id);
    if (!vault) return;
    const target = vault.accounts.find((a) => a.id === id);
    refreshGeneration.current += 1;
    const cached = target
      ? snapshotCache.current.get(`${network}:${endpointRevision}:${target.publicKey}`)
      : undefined;
    // Show the last-known snapshot instantly while the new account refresh begins.
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
  }, [endpointRevision, network]);

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

  const reconcileMergeRecordRef = useRef<(record: MergeReconciliation) => Promise<void>>(
    async () => {},
  );
  const reconcileMergeRecord = useCallback(async (record: MergeReconciliation) => {
    const startedGeneration = trackingTaskGeneration.current;
    const identity = transactionIdentity(record);
    if (
      !isTrackingTaskCurrent(
        startedGeneration,
        trackingTaskGeneration.current,
        record,
        mergeReconciliationsRef.current,
      ) ||
      mergeReconciliationInFlight.current.has(identity) ||
      mergeReconciliationTimers.current.has(identity) ||
      record.status === "status_unknown" ||
      record.status === "source_active" ||
      (record.status === "last_account" && accounts.length <= 1)
    ) {
      return;
    }

    mergeReconciliationInFlight.current.add(identity);
    try {
      const api = await loadWalletApi();
      const result = await reconcileMergeRecovery(
        record,
        accounts,
        Date.now(),
        api.lookupCanonicalTransaction,
        api.inspectConfirmedAccountMerge,
        (accountId) => {
          if (!isTrackingTaskCurrent(
            startedGeneration,
            trackingTaskGeneration.current,
            record,
            mergeReconciliationsRef.current,
          )) {
            throw new Error("Stale merge reconciliation was cancelled.");
          }
          removeAccount(accountId);
        },
      );

      if (!isTrackingTaskCurrent(
        startedGeneration,
        trackingTaskGeneration.current,
        record,
        mergeReconciliationsRef.current,
      )) {
        return;
      }

      const current = mergeReconciliationsRef.current;
      const stillQueued = current.some((candidate) =>
        transactionIdentity(candidate) === identity);
      if (!stillQueued) return;
      const nextMerges = result.record
        ? upsertMergeReconciliation(current, result.record)
        : current.filter((candidate) => transactionIdentity(candidate) !== identity);
      persistMergeReconciliationQueue(
        window.localStorage,
        MERGE_RECONCILIATION_STORAGE_KEY,
        nextMerges,
      );
      commitMergeReconciliations(() => nextMerges);

      if (result.outcome === "retry" && result.record) {
        const timer = window.setTimeout(() => {
          mergeReconciliationTimers.current.delete(identity);
          if (!isTrackingTaskCurrent(
            startedGeneration,
            trackingTaskGeneration.current,
            record,
            mergeReconciliationsRef.current,
          )) {
            return;
          }
          void reconcileMergeRecordRef.current(result.record!);
        }, TRANSACTION_POLL_MS);
        mergeReconciliationTimers.current.set(identity, timer);
      }

      if (result.outcome === "removed") {
        toast("Confirmed merged account archived locally", "success");
      } else if (result.outcome === "last_account" && record.status !== "last_account") {
        toast("Account merge confirmed. Add another local account before archiving this final key.", "info");
      } else if (result.outcome === "source_active") {
        toast("Merge history was verified, but the source account is active again. Local removal was stopped.", "info");
      } else if (result.outcome === "retry" && record.status !== "retry") {
        toast(mergeReconciliationPresentation("retry").message, "info");
      } else if (result.outcome === "status_unknown") {
        toast(mergeReconciliationPresentation("status_unknown").message, "info");
      }
    } finally {
      if (startedGeneration === trackingTaskGeneration.current) {
        mergeReconciliationInFlight.current.delete(identity);
      }
    }
  }, [accounts, commitMergeReconciliations, removeAccount, toast]);

  useEffect(() => {
    reconcileMergeRecordRef.current = reconcileMergeRecord;
  }, [reconcileMergeRecord]);

  const retryMergeReconciliation = useCallback((record: MergeReconciliation) => {
    const identity = transactionIdentity(record);
    const pendingTransaction = transactionTrackingRef.current.pending.find((candidate) =>
      transactionIdentity(candidate) === identity);
    if (pendingTransaction) {
      void pollPendingRef.current(pendingTransaction);
      return;
    }
    const current = mergeReconciliationsRef.current;
    if (!current.some((candidate) => transactionIdentity(candidate) === identity)) return;
    const pending: MergeReconciliation = { ...record, status: "pending" };
    const next = upsertMergeReconciliation(current, pending);
    persistMergeReconciliationQueue(
      window.localStorage,
      MERGE_RECONCILIATION_STORAGE_KEY,
      next,
    );
    commitMergeReconciliations(() => next);
    void reconcileMergeRecordRef.current(pending);
  }, [commitMergeReconciliations]);

  useEffect(() => {
    if (trackingRestartNonce === 0) return;
    for (const transaction of transactionTrackingRef.current.pending) {
      void pollPendingRef.current(transaction);
    }
    for (const record of mergeReconciliationsRef.current) {
      void reconcileMergeRecordRef.current(record);
    }
  }, [trackingRestartNonce]);

  useEffect(() => {
    if (!pendingTxsHydrated || phase === "loading" || accounts.length === 0) return;
    for (const record of mergeReconciliations) {
      void reconcileMergeRecordRef.current(record);
    }
  }, [accounts, mergeReconciliations, pendingTxsHydrated, phase]);

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
    setAccountPortfolioSnapshots({});
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
      const api = await loadWalletApi();
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

  const addContact = useCallback(async (contact: Contact, previousAddress?: string) => {
    setContacts(await saveContact(contact, previousAddress));
  }, []);
  const removeContact = useCallback(async (address: string) => {
    setContacts(await deleteContact(address));
  }, []);
  const toggleContactFavorite = useCallback(async (address: string) => {
    setContacts(await toggleFavoriteContact(address));
  }, []);

  const send = useCallback(
    async (params: {
      destination: string;
      amount: string;
      assetCode: string;
      issuer?: string | null;
      memo?: StellarMemoInput;
      feeStroops?: number;
      submissionJournal?: {
        onPrepared: SubmissionPreparedCallback;
        onRejected?: SubmissionPreparedCallback;
      };
    }) => {
      if (!activeAccount) throw new Error("No active account");
      if (activeAccount.watchOnly) {
        throw new Error("This is a watch-only account — switch to a signing account to send.");
      }
      const api = await loadWalletApi();
      const hw = hardwareSignerFor(activeAccount);
      return withSigningSecret(activeAccount, hw, (secretKey) => runTrackedBroadcast(
        "Payment",
        undefined,
        (onPrepared) => api.sendPayment({
          network,
          secretKey,
          hardwareSigner: hw,
          ...params,
          feeStroops: params.feeStroops ?? recommendedBaseFeeStroops,
          onPrepared,
        }),
        (result) => result,
        params.submissionJournal,
      ));
    },
    [activeAccount, network, recommendedBaseFeeStroops, runTrackedBroadcast],
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
      const api = await loadWalletApi();
      const hw = hardwareSignerFor(activeAccount);
      return withSigningSecret(activeAccount, hw, (secretKey) => runTrackedBroadcast(
        "Batch Payment",
        undefined,
        (onPrepared) => api.sendBatchPayments({
          network,
          secretKey,
          hardwareSigner: hw,
          ...params,
          feeStroops: recommendedBaseFeeStroops,
          onPrepared,
        }),
        (result) => result,
      ));
    },
    [activeAccount, network, recommendedBaseFeeStroops, runTrackedBroadcast],
  );

  const claimAirdrop = useCallback(
    async (balanceId: string) => {
      if (!activeAccount) throw new Error("No active account");
      const api = await loadWalletApi();
      const hw = hardwareSignerFor(activeAccount);
      return withSigningSecret(activeAccount, hw, (secretKey) => runTrackedBroadcast(
        "Airdrop claim",
        undefined,
        (onPrepared) => api.claimClaimableBalance({
          network,
          secretKey,
          hardwareSigner: hw,
          balanceId,
          feeStroops: recommendedBaseFeeStroops,
          onPrepared,
        }),
        (result) => result,
      ));
    },
    [activeAccount, network, recommendedBaseFeeStroops, runTrackedBroadcast],
  );

  const mergeAccount = useCallback(
    async (destination: string) => {
      if (!activeAccount) throw new Error("No active account");
      const api = await loadWalletApi();
      const hw = hardwareSignerFor(activeAccount);
      return withSigningSecret(activeAccount, hw, (secretKey) => runTrackedBroadcast(
        "Account merge",
        { kind: "reconcile_account_merge" },
        (onPrepared) => api.mergeAccount({
          network,
          secretKey,
          hardwareSigner: hw,
          destination,
          feeStroops: recommendedBaseFeeStroops,
          onPrepared,
        }),
        (result) => result,
      ));
    },
    [activeAccount, network, recommendedBaseFeeStroops, runTrackedBroadcast],
  );

  const trustAsset = useCallback(
    async (params: { code: string; issuer: string; add: boolean }) => {
      if (!activeAccount) throw new Error("No active account");
      const api = await loadWalletApi();
      const hw = hardwareSignerFor(activeAccount);
      return withSigningSecret(activeAccount, hw, (secretKey) => runTrackedBroadcast(
        params.add ? "Trustline" : "Trustline removal",
        undefined,
        (onPrepared) => api.changeTrust({
          network,
          secretKey,
          hardwareSigner: hw,
          ...params,
          feeStroops: recommendedBaseFeeStroops,
          onPrepared,
        }),
        (result) => result,
      ));
    },
    [activeAccount, network, recommendedBaseFeeStroops, runTrackedBroadcast],
  );

  const trustAssets = useCallback(
    async (assets: Array<{ code: string; issuer: string }>) => {
      if (!activeAccount) throw new Error("No active account");
      const api = await loadWalletApi();
      const hw = hardwareSignerFor(activeAccount);
      const result = await withSigningSecret(activeAccount, hw, (secretKey) => runTrackedBroadcast(
        `${assets.length} trustlines`,
        undefined,
        (onPrepared) => api.changeTrustBatch({
          network,
          secretKey,
          hardwareSigner: hw,
          assets,
          feeStroops: recommendedBaseFeeStroops,
          onPrepared,
        }),
        (outcome) => outcome,
      ));
      return result;
    },
    [activeAccount, network, recommendedBaseFeeStroops, runTrackedBroadcast],
  );

  const swap = useCallback(
    async (params: {
      sendCode: string;
      sendIssuer?: string | null;
      destCode: string;
      destIssuer?: string | null;
      intermediates: Asset[];
    } & (
      | {
          mode: "strict-send";
          sendAmount: string;
          destMin: string;
        }
      | {
          mode: "strict-receive";
          sendMax: string;
          destinationAmount: string;
        }
    )) => {
      if (!activeAccount) throw new Error("No active account");
      const swapLib = await loadSwapApi();
      const hw = hardwareSignerFor(activeAccount);
      return withSigningSecret(activeAccount, hw, (secretKey) => runTrackedBroadcast(
        "Swap",
        undefined,
        (onPrepared) => params.mode === "strict-receive"
          ? swapLib.swapStrictReceive({
              network,
              secretKey,
              hardwareSigner: hw,
              sendCode: params.sendCode,
              sendIssuer: params.sendIssuer,
              sendMax: params.sendMax,
              destCode: params.destCode,
              destIssuer: params.destIssuer,
              destinationAmount: params.destinationAmount,
              intermediates: params.intermediates,
              feeStroops: recommendedBaseFeeStroops,
              onPrepared,
            })
          : swapLib.swapStrictSend({
              network,
              secretKey,
              hardwareSigner: hw,
              sendCode: params.sendCode,
              sendIssuer: params.sendIssuer,
              sendAmount: params.sendAmount,
              destCode: params.destCode,
              destIssuer: params.destIssuer,
              destMin: params.destMin,
              intermediates: params.intermediates,
              feeStroops: recommendedBaseFeeStroops,
              onPrepared,
            }),
        (result) => result,
      ));
    },
    [activeAccount, network, recommendedBaseFeeStroops, runTrackedBroadcast],
  );

  const fundFromFriendbot = useCallback(async () => {
    if (!activeAccount) throw new Error("No active account");
    const api = await loadWalletApi();
    await api.fundWithFriendbot(activeAccount.publicKey, network);
    await accountRefreshRef.current();
  }, [activeAccount, network]);

  const applyMultisigConfig = useCallback(
    async (config: MultisigConfig) => {
      if (!activeAccount) throw new Error("No active account");
      if (activeAccount.watchOnly) {
        throw new Error("Watch-only accounts cannot sign transactions.");
      }
      const msig = await loadMultisigApi();
      const hw = hardwareSignerFor(activeAccount);
      const result = await withSigningSecret(activeAccount, hw, (secretKey) => runTrackedBroadcast(
        "Multi-sig update",
        undefined,
        (onPrepared) => msig.applyMultisigConfig({
          network,
          accountPublicKey: activeAccount.publicKey,
          config,
          secretKey,
          hardwareSigner: hw,
          feeStroops: recommendedBaseFeeStroops,
          onPrepared,
        }),
        (outcome) => outcome.submission,
      ));
      if (!result.submission) {
        toast("Configuration signed — additional approval required", "info");
      }
      return result;
    },
    [activeAccount, network, recommendedBaseFeeStroops, runTrackedBroadcast, toast],
  );

  const disableMultisig = useCallback(async () => {
    if (!activeAccount) throw new Error("No active account");
    if (activeAccount.watchOnly) {
      throw new Error("Watch-only accounts cannot sign transactions.");
    }
    const msig = await loadMultisigApi();
    const hw = hardwareSignerFor(activeAccount);
    const result = await withSigningSecret(activeAccount, hw, (secretKey) => runTrackedBroadcast(
      "Multi-sig disabled",
      undefined,
      (onPrepared) => msig.disableMultisig({
        network,
        accountPublicKey: activeAccount.publicKey,
        secretKey,
        hardwareSigner: hw,
        feeStroops: recommendedBaseFeeStroops,
        onPrepared,
      }),
      (outcome) => outcome.submission,
    ));
    if (!result.submission) {
      toast("Disable request signed — additional approval required", "info");
    }
    return result;
  }, [activeAccount, network, recommendedBaseFeeStroops, runTrackedBroadcast, toast]);

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
      const msig = await loadMultisigApi();
      const hw = hardwareSignerFor(activeAccount);
      return withSigningSecret(activeAccount, hw, (secretKey) => msig.prepareCosignPayment({
        network,
        sourcePublicKey: activeAccount.publicKey,
        secretKey,
        hardwareSigner: hw,
        ...params,
        feeStroops: params.feeStroops ?? recommendedBaseFeeStroops,
      }));
    },
    [activeAccount, network, recommendedBaseFeeStroops],
  );

  const cosignTransaction = useCallback(
    async (xdr: string, confirmedNetwork: NetworkKey | null) => {
      if (!activeAccount) throw new Error("No active account");
      const msig = await loadMultisigApi();
      const hw = hardwareSignerFor(activeAccount);
      return withSigningSecret(activeAccount, hw, (secretKey) => runTrackedBroadcast(
        "Co-signed transaction",
        undefined,
        (onPrepared) => msig.cosignTransaction({
          network,
          confirmedNetwork,
          xdr,
          signerPublicKey: activeAccount.publicKey,
          secretKey,
          hardwareSigner: hw,
          onPrepared,
        }),
        (outcome) => outcome.submission,
      ));
    },
    [activeAccount, network, runTrackedBroadcast],
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
        const api = await loadWalletApi();
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
      window.localStorage.setItem("stellarkey.privacy.v1", prev ? "0" : "1");
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
      vaultStorageIssue,
      network,
      accounts,
      activeAccount,
      accountBalances,
      accountPortfolioSnapshots,
      archivedAccounts,
      balances,
      minimumBalanceXlm,
      recommendedBaseFeeStroops,
      dataError,
      claimableBalances,
      activity,
      activityCursor,
      pendingTxs,
      retryPendingTransaction,
      mergeReconciliations,
      retryMergeReconciliation,
      submissionStatus,
      envelopeSubmissionStatus,
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
      unlockWithPasskey,
      lock,
      resetWallet,
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
      vaultStorageIssue,
      network,
      accounts,
      activeAccount,
      archivedAccounts,
      accountBalances,
      accountPortfolioSnapshots,
      balances,
      minimumBalanceXlm,
      recommendedBaseFeeStroops,
      dataError,
      claimableBalances,
      activity,
      activityCursor,
      pendingTxs,
      retryPendingTransaction,
      mergeReconciliations,
      retryMergeReconciliation,
      submissionStatus,
      envelopeSubmissionStatus,
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
      unlockWithPasskey,
      lock,
      resetWallet,
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

  const phaseValue = useMemo<WalletPhaseContextValue>(
    () => ({ phase, vaultStorageIssue }),
    [phase, vaultStorageIssue],
  );
  const lifecycleActions = useMemo<WalletLifecycleActionsValue>(
    () => ({
      createWallet,
      createHardwareVault,
      completeSetup,
      unlock,
      unlockWithPasskey,
      resetWallet,
      restoreWalletFromBackup,
    }),
    [
      completeSetup,
      createHardwareVault,
      createWallet,
      resetWallet,
      restoreWalletFromBackup,
      unlock,
      unlockWithPasskey,
    ],
  );

  const identityValue = useMemo<WalletIdentityContextValue>(() => ({
    network,
    accounts,
    activeAccount,
    archivedAccounts,
    revealRecoveryPhrase,
    lock,
    selectAccount,
    addAccount,
    addWatchOnly,
    addHardwareAccount,
    removeAccount,
    renameAccount,
    restoreArchivedAccount,
    restoreAccountByIndex,
    switchNetwork,
  }), [
    accounts,
    activeAccount,
    addAccount,
    addHardwareAccount,
    addWatchOnly,
    archivedAccounts,
    lock,
    network,
    removeAccount,
    renameAccount,
    restoreAccountByIndex,
    restoreArchivedAccount,
    revealRecoveryPhrase,
    selectAccount,
    switchNetwork,
  ]);
  const ledgerValue = useMemo<WalletLedgerContextValue>(() => ({
    balances,
    minimumBalanceXlm,
    recommendedBaseFeeStroops,
    dataError,
    accountBalances,
    accountPortfolioSnapshots,
    claimableBalances,
    dataLoading,
    unfunded,
  }), [
    accountBalances,
    accountPortfolioSnapshots,
    balances,
    claimableBalances,
    dataError,
    dataLoading,
    minimumBalanceXlm,
    recommendedBaseFeeStroops,
    unfunded,
  ]);
  const activityValue = useMemo<WalletActivityContextValue>(() => ({
    activity,
    activityCursor,
    loadingMore,
    loadMoreActivity,
  }), [activity, activityCursor, loadingMore, loadMoreActivity]);
  const submissionValue = useMemo<WalletSubmissionContextValue>(() => ({
    pendingTxs,
    retryPendingTransaction,
    mergeReconciliations,
    retryMergeReconciliation,
    submissionStatus,
    envelopeSubmissionStatus,
  }), [
    envelopeSubmissionStatus,
    mergeReconciliations,
    pendingTxs,
    retryMergeReconciliation,
    retryPendingTransaction,
    submissionStatus,
  ]);
  const marketValue = useMemo<WalletMarketContextValue>(() => ({
    xlmPriceUsd,
    priceData,
    priceRange,
    changePriceRange,
    priceLoading,
    fiatRates,
  }), [changePriceRange, fiatRates, priceData, priceLoading, priceRange, xlmPriceUsd]);
  const preferencesValue = useMemo<WalletPreferencesContextValue>(() => ({
    privacyMode,
    togglePrivacy,
    fiatCurrency,
    cycleFiatCurrency,
    changeFiatCurrency,
    autoLockMs,
    changeAutoLockMs,
  }), [
    autoLockMs,
    changeAutoLockMs,
    changeFiatCurrency,
    cycleFiatCurrency,
    fiatCurrency,
    privacyMode,
    togglePrivacy,
  ]);
  const contactsValue = useMemo<WalletContactsContextValue>(() => ({
    contacts,
    addContact,
    removeContact,
    toggleContactFavorite,
  }), [addContact, contacts, removeContact, toggleContactFavorite]);
  const transactionsValue = useMemo<WalletTransactionsContextValue>(() => ({
    refresh,
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
  }), [
    applyMultisigConfig,
    claimAirdrop,
    cosignTransaction,
    disableMultisig,
    fundFromFriendbot,
    mergeAccount,
    prepareCosignPayment,
    refresh,
    send,
    sendBatch,
    swap,
    trustAsset,
    trustAssets,
  ]);

  return (
    <WalletPhaseContext.Provider value={phaseValue}>
      <WalletLifecycleActionsContext.Provider value={lifecycleActions}>
        <WalletIdentityContext.Provider value={identityValue}>
          <WalletLedgerContext.Provider value={ledgerValue}>
            <WalletActivityContext.Provider value={activityValue}>
              <WalletSubmissionContext.Provider value={submissionValue}>
                <WalletMarketContext.Provider value={marketValue}>
                  <WalletPreferencesContext.Provider value={preferencesValue}>
                    <WalletContactsContext.Provider value={contactsValue}>
                      <WalletTransactionsContext.Provider value={transactionsValue}>
                        <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
                      </WalletTransactionsContext.Provider>
                    </WalletContactsContext.Provider>
                  </WalletPreferencesContext.Provider>
                </WalletMarketContext.Provider>
              </WalletSubmissionContext.Provider>
            </WalletActivityContext.Provider>
          </WalletLedgerContext.Provider>
        </WalletIdentityContext.Provider>
      </WalletLifecycleActionsContext.Provider>
    </WalletPhaseContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}

export function useWalletIdentity(): WalletIdentityContextValue {
  const context = useContext(WalletIdentityContext);
  if (!context) throw new Error("useWalletIdentity must be used within WalletProvider");
  return context;
}

export function useWalletLedger(): WalletLedgerContextValue {
  const context = useContext(WalletLedgerContext);
  if (!context) throw new Error("useWalletLedger must be used within WalletProvider");
  return context;
}

export function useWalletActivity(): WalletActivityContextValue {
  const context = useContext(WalletActivityContext);
  if (!context) throw new Error("useWalletActivity must be used within WalletProvider");
  return context;
}

export function useWalletSubmission(): WalletSubmissionContextValue {
  const context = useContext(WalletSubmissionContext);
  if (!context) throw new Error("useWalletSubmission must be used within WalletProvider");
  return context;
}

export function useWalletMarket(): WalletMarketContextValue {
  const context = useContext(WalletMarketContext);
  if (!context) throw new Error("useWalletMarket must be used within WalletProvider");
  return context;
}

export function useWalletPreferences(): WalletPreferencesContextValue {
  const context = useContext(WalletPreferencesContext);
  if (!context) throw new Error("useWalletPreferences must be used within WalletProvider");
  return context;
}

export function useWalletContacts(): WalletContactsContextValue {
  const context = useContext(WalletContactsContext);
  if (!context) throw new Error("useWalletContacts must be used within WalletProvider");
  return context;
}

export function useWalletTransactions(): WalletTransactionsContextValue {
  const context = useContext(WalletTransactionsContext);
  if (!context) throw new Error("useWalletTransactions must be used within WalletProvider");
  return context;
}

export function useWalletPhase(): WalletPhaseContextValue {
  const context = useContext(WalletPhaseContext);
  if (!context) throw new Error("useWalletPhase must be used within WalletProvider");
  return context;
}

export function useWalletLifecycleActions(): WalletLifecycleActionsValue {
  const context = useContext(WalletLifecycleActionsContext);
  if (!context) throw new Error("useWalletLifecycleActions must be used within WalletProvider");
  return context;
}
