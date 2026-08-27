"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Keypair } from "@stellar/stellar-sdk";
import { useWallet } from "@/hooks/useWallet";
import { useMerchantSettings } from "@/hooks/useMerchantRuntime";
import {
  enablePasskeyUnlock,
  hasPasskeyUnlock,
  importKeystore,
  removePasskeyUnlock,
  revealSecret,
  isValidPublicAddress,
  hasMnemonic as hasMnemonicAlias,
} from "@/lib/vault";
import { canOfferPasskeyUnlock } from "@/lib/passkey-prf";
import { networkFeeXlm } from "@/lib/api";
import type { NetworkKey } from "@/lib/stellar";
import { NETWORKS } from "@/lib/stellar";
import {
  getHorizonUrl,
  getRpcUrl,
  loadCustomEndpoint,
  resetCustomEndpoints,
  saveCustomEndpoint,
  testHorizonEndpoint,
  testRpcEndpoint,
  type EndpointHealth,
  type StellarEndpointKind,
} from "@/lib/stellar-endpoints";
import { stellarAccountPath } from "@/lib/hd";
import { formatTrezorAddress } from "@/lib/address-display";
import { triggerHaptic } from "@/lib/haptics";
import {
  assertReviewCanBeSigned,
  reviewTransactionEnvelope,
  type TransactionReview,
} from "@/lib/transaction-review";
import { assertCanAddTransactionSignature } from "@/lib/multisig";
import { loadSoundPref, saveSoundPref } from "@/lib/sounds";
import {
  BACKUP_HEALTH_CHANGED_EVENT,
  loadBackupHealth,
  type BackupHealth,
} from "@/lib/backup-health";
import type { AccountMeta } from "@/lib/types";
import {
  mergeReconciliationPresentation,
  type SubmissionResult,
} from "@/lib/submission";
import { useToast } from "./Toast";
import { RenameAccountModal } from "./RenameAccountModal";
import { ResetWalletModal } from "./ResetWalletModal";
import { AddAccountModal } from "./AddAccountModal";
import {
  Avatar,
  Button,
  CopyButton,
  ErrorText,
  Field,
  HashValue,
  IOSBackButton,
  Modal,
  ModalHeader,
  NetworkBadge,
  SegmentedControl,
  Spinner,
  Toggle,
} from "./ui";
import {
  IconCheck,
  IconDownload,
  IconFingerprint,
  IconLock,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTrash,
  IconWallet,
  IconTrezor,
  IconLedger,
} from "./icons";
import { IconStorefront } from "./merchant/icons";
import type {
  SettlementSwapIntent,
  SettlementSweepIntent,
} from "@/lib/merchant/settlement";

/* Merchant operational sub-pages load only when the shop opens one. */
const MerchantSettings = dynamic(
  () => import("./merchant/MerchantSettings").then((m) => m.MerchantSettings),
  { ssr: false },
);
const StaffTerminalsPage = dynamic(
  () => import("./merchant/StaffTerminalsPage").then((m) => m.StaffTerminalsPage),
  { ssr: false },
);
const TaxRecordsPage = dynamic(
  () => import("./merchant/TaxRecordsPage").then((m) => m.TaxRecordsPage),
  { ssr: false },
);
const PeripheralsPage = dynamic(
  () => import("./merchant/PeripheralsPage").then((m) => m.PeripheralsPage),
  { ssr: false },
);

export type SettingsSub =
  | "root"
  | "accounts"
  | "network"
  | "autolock"
  | "merge"
  | "airsigner"
  | "hardware"
  | "currency"
  | "merchant"
  | "staff"
  | "tax"
  | "peripherals";
type Sub = SettingsSub;

/**
 * Sub-pages that draw their own back button and title. The generic header above
 * would only stack a second one on top of theirs.
 */
function ownsItsHeader(sub: Sub): boolean {
  return sub === "staff" || sub === "tax" || sub === "peripherals";
}

export function SettingsPage({
  initialSub = "root",
  merchantOnly = false,
  installAvailable = false,
  installDescription = "Add Wallet to this device",
  onInstallApp,
  onOpenBackupWizard,
  onOpenMultisigStudio,
  onOpenSetupWizard,
  onOpenSwap,
  onOpenSend,
}: {
  initialSub?: Sub;
  /** Opened from Merchant Mode: Merchant settings is the root, so no back header. */
  merchantOnly?: boolean;
  installAvailable?: boolean;
  installDescription?: string;
  onInstallApp?: () => void;
  onOpenBackupWizard?: () => void;
  onOpenMultisigStudio?: () => void;
  /** Offered when Merchant Mode is switched on for a shop with nothing set up. */
  onOpenSetupWizard?: () => void;
  /** The wallet's own DEX Swap, where a merchant conversion is made and signed. */
  onOpenSwap?: (intent: SettlementSwapIntent) => void;
  /** The wallet's own Send, where a merchant sweep is made and signed. */
  onOpenSend?: (intent: SettlementSweepIntent) => void;
}) {
  const {
    network,
    switchNetwork,
    accounts,
    activeAccount,
    archivedAccounts,
    selectAccount,
    removeAccount,
    restoreArchivedAccount,
    restoreAccountByIndex,
    mergeAccount,
    fundFromFriendbot,
    privacyMode,
    togglePrivacy,
    autoLockMs,
    changeAutoLockMs,
    fiatCurrency,
    changeFiatCurrency,
    recommendedBaseFeeStroops,
    mergeReconciliations,
    retryMergeReconciliation,
    submissionStatus,
  } = useWallet();
  const {
    enabled: merchantEnabled,
    configured: merchantConfigured,
    setEnabled: setMerchantEnabled,
    profileName: merchantProfileName,
  } = useMerchantSettings();
  const { toast } = useToast();

  const [sub, setSub] = useState<Sub>(initialSub);

  const [soundEnabled, setSoundEnabled] = useState(() => loadSoundPref());
  const [backupHealth, setBackupHealth] = useState<BackupHealth | null>(null);
  const [passkeyConfigured, setPasskeyConfigured] = useState(() => hasPasskeyUnlock());
  const [passkeyAvailable] = useState(() => canOfferPasskeyUnlock());
  const [passkeyDialog, setPasskeyDialog] = useState<"enable" | "remove" | null>(null);
  const [passkeyPassword, setPasskeyPassword] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setBackupHealth(loadBackupHealth());
    refresh();
    window.addEventListener(BACKUP_HEALTH_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(BACKUP_HEALTH_CHANGED_EVENT, refresh);
  }, []);

  const [scanning, setScanning] = useState(false);
  const [fundingTestnet, setFundingTestnet] = useState(false);

  const [editingAccount, setEditingAccount] = useState<AccountMeta | null>(null);

  const [mergeDest, setMergeDest] = useState("");
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergePending, setMergePending] = useState<SubmissionResult | null>(null);
  const trackedMergeStatus = mergePending ? submissionStatus(mergePending) : null;
  const activeMergeReconciliation = mergeReconciliations.find((record) =>
    record.network === network &&
    (!record.sourcePublicKey || record.sourcePublicKey === activeAccount?.publicKey));
  const activeMergePresentation = activeMergeReconciliation
    ? mergeReconciliationPresentation(activeMergeReconciliation.status)
    : null;
  const mergeFlowLocked = Boolean(mergePending || activeMergeReconciliation);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      if (trackedMergeStatus === "confirmed") {
        setMergePending(null);
        setSub("accounts");
        triggerHaptic("success");
        return;
      }
      if (trackedMergeStatus === "failed") {
        setMergePending(null);
        setMergeError("Account merge failed on-chain. Verify the destination and retry when ready.");
        triggerHaptic("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [trackedMergeStatus]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [keystoreJson, setKeystoreJson] = useState<string | null>(null);
  const [ksPassword, setKsPassword] = useState("");
  const [ksError, setKsError] = useState<string | null>(null);
  const [ksBusy, setKsBusy] = useState(false);

  const [confirmReset, setConfirmReset] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [addAccountMode, setAddAccountMode] = useState<"generate" | "hardware">("generate");
  const hasMnemonicVault = hasMnemonicAlias();
  const [horizonDraft, setHorizonDraft] = useState(() => getHorizonUrl(network));
  const [rpcDraft, setRpcDraft] = useState(() => getRpcUrl(network) ?? "");
  const [endpointTesting, setEndpointTesting] = useState<StellarEndpointKind | null>(null);
  const [endpointHealth, setEndpointHealth] = useState<Partial<Record<StellarEndpointKind, EndpointHealth>>>({});
  const [endpointError, setEndpointError] = useState<string | null>(null);

  const [airXdr, setAirXdr] = useState("");
  const [airPw, setAirPw] = useState("");
  const [signedXdr, setSignedXdr] = useState<string | null>(null);
  const [airError, setAirError] = useState<string | null>(null);
  const [airBusy, setAirBusy] = useState(false);
  const [airReview, setAirReview] = useState<TransactionReview | null>(null);
  const [airReviewedXdr, setAirReviewedXdr] = useState("");
  const [airAuthorizedSigner, setAirAuthorizedSigner] = useState<string | null>(null);
  const [airNetworkConfirmed, setAirNetworkConfirmed] = useState(false);
  const airReviewGeneration = useRef(0);
  const airSignerReady = Boolean(
    airReview &&
    airReview.network === network &&
    airReviewedXdr === airXdr.trim() &&
    activeAccount &&
    airAuthorizedSigner === activeAccount.publicKey,
  );

  useEffect(() => {
    airReviewGeneration.current += 1;
  }, [activeAccount?.publicKey, network]);

  async function handleTestAndSaveEndpoint(kind: StellarEndpointKind) {
    const value = kind === "horizon" ? horizonDraft : rpcDraft;
    if (!value.trim()) return;
    setEndpointTesting(kind);
    setEndpointError(null);
    try {
      const health = kind === "horizon"
        ? await testHorizonEndpoint(network, value)
        : await testRpcEndpoint(network, value);
      saveCustomEndpoint(network, kind, health.url);
      if (kind === "horizon") {
        setHorizonDraft(health.url);
      } else {
        setRpcDraft(health.url);
      }
      setEndpointHealth((current) => ({ ...current, [kind]: health }));
      triggerHaptic("success");
      toast(`${kind === "horizon" ? "Horizon" : "RPC"} endpoint verified for ${NETWORKS[network].label}`, "success");
    } catch (cause) {
      triggerHaptic("error");
      setEndpointError(cause instanceof Error ? cause.message : "Endpoint verification failed.");
    } finally {
      setEndpointTesting(null);
    }
  }

  function handleResetEndpoints() {
    setEndpointError(null);
    try {
      resetCustomEndpoints(network);
      setHorizonDraft(NETWORKS[network].horizonUrl);
      setRpcDraft(NETWORKS[network].rpcUrl ?? "");
      setEndpointHealth({});
      triggerHaptic("success");
      toast(`${NETWORKS[network].label} endpoints reset to built-in defaults`, "info");
    } catch (cause) {
      triggerHaptic("error");
      setEndpointError(cause instanceof Error ? cause.message : "Could not reset the endpoint settings.");
    }
  }

  async function handleEnablePasskey() {
    if (!passkeyPassword) return;
    setPasskeyBusy(true);
    setPasskeyError(null);
    try {
      await enablePasskeyUnlock(passkeyPassword);
      setPasskeyConfigured(true);
      setPasskeyPassword("");
      setPasskeyDialog(null);
      triggerHaptic("success");
      toast("Face ID / Touch ID unlock enabled on this device", "success");
    } catch (cause) {
      triggerHaptic("error");
      setPasskeyError(cause instanceof Error ? cause.message : "Passkey setup failed.");
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function handleRemovePasskey() {
    if (!passkeyPassword) return;
    setPasskeyBusy(true);
    setPasskeyError(null);
    try {
      await removePasskeyUnlock(passkeyPassword);
      setPasskeyConfigured(false);
      setPasskeyPassword("");
      setPasskeyDialog(null);
      triggerHaptic("success");
      toast("Device passkey unlock removed", "info");
    } catch (cause) {
      triggerHaptic("error");
      setPasskeyError(cause instanceof Error ? cause.message : "Passkey removal failed.");
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function handleAirReview() {
    if (!activeAccount || !airXdr.trim()) return;
    const reviewedXdr = airXdr.trim();
    const reviewedNetwork = network;
    const reviewedAccount = activeAccount.publicKey;
    const requestGeneration = ++airReviewGeneration.current;
    setAirBusy(true);
    setAirError(null);
    setSignedXdr(null);
    setAirReview(null);
    setAirReviewedXdr("");
    setAirAuthorizedSigner(null);
    try {
      const review = reviewTransactionEnvelope(reviewedXdr, reviewedNetwork);
      setAirReview(review);
      setAirReviewedXdr(reviewedXdr);
      setAirNetworkConfirmed(false);
      if (!review.signable) {
        triggerHaptic("error");
        return;
      }
      await assertCanAddTransactionSignature({
        transaction: review.transaction,
        network: reviewedNetwork,
        signerPublicKey: reviewedAccount,
      });
      if (requestGeneration !== airReviewGeneration.current) return;
      setAirAuthorizedSigner(reviewedAccount);
      triggerHaptic("selection");
    } catch (error) {
      if (requestGeneration !== airReviewGeneration.current) return;
      triggerHaptic("error");
      setAirError(error instanceof Error ? error.message : "Could not decode the envelope.");
    } finally {
      setAirBusy(false);
    }
  }

  async function handleAirAuthorizationRetry() {
    if (!activeAccount || !airReview || !airReviewedXdr) return;
    if (airReview.network !== network || airReviewedXdr !== airXdr.trim()) {
      setAirError("The envelope or selected network changed. Decode and review it again.");
      return;
    }
    const requestGeneration = ++airReviewGeneration.current;
    const reviewedAccount = activeAccount.publicKey;
    setAirBusy(true);
    setAirError(null);
    setAirAuthorizedSigner(null);
    try {
      const refreshedReview = reviewTransactionEnvelope(airReviewedXdr, network);
      if (!refreshedReview.signable) {
        throw new Error(refreshedReview.blockingReasons.join(" "));
      }
      await assertCanAddTransactionSignature({
        transaction: refreshedReview.transaction,
        network,
        signerPublicKey: reviewedAccount,
      });
      if (requestGeneration !== airReviewGeneration.current) return;
      setAirReview(refreshedReview);
      setAirAuthorizedSigner(reviewedAccount);
      triggerHaptic("selection");
    } catch (error) {
      if (requestGeneration !== airReviewGeneration.current) return;
      triggerHaptic("error");
      setAirError(error instanceof Error ? error.message : "Signer authorization failed.");
    } finally {
      setAirBusy(false);
    }
  }

  async function handleAirSign() {
    if (!activeAccount || !airReview || !airSignerReady || !airPw) return;
    const requestGeneration = airReviewGeneration.current;
    const reviewedXdr = airReviewedXdr;
    const reviewedNetwork = network;
    const reviewedAccount = activeAccount.publicKey;
    setAirBusy(true);
    setAirError(null);
    try {
      if (
        airReview.network !== reviewedNetwork ||
        reviewedXdr !== airXdr.trim() ||
        airAuthorizedSigner !== reviewedAccount
      ) {
        throw new Error("The selected network changed. Review the envelope again before signing.");
      }
      const currentReview = reviewTransactionEnvelope(reviewedXdr, reviewedNetwork);
      assertReviewCanBeSigned(currentReview, airNetworkConfirmed);
      await assertCanAddTransactionSignature({
        transaction: currentReview.transaction,
        network: reviewedNetwork,
        signerPublicKey: reviewedAccount,
      });
      if (requestGeneration !== airReviewGeneration.current) {
        throw new Error("The account or network changed. Review the envelope again before signing.");
      }
      const secret = await revealSecret(activeAccount.id, airPw);
      if (!secret) throw new Error("Incorrect password.");
      const kp = Keypair.fromSecret(secret);
      if (kp.publicKey() !== reviewedAccount) {
        throw new Error("The unlocked key does not match the active account.");
      }
      await assertCanAddTransactionSignature({
        transaction: currentReview.transaction,
        network: reviewedNetwork,
        signerPublicKey: reviewedAccount,
      });
      if (requestGeneration !== airReviewGeneration.current) {
        throw new Error("The account or network changed. Review the envelope again before signing.");
      }
      const tx = currentReview.transaction;
      assertReviewCanBeSigned(currentReview, airNetworkConfirmed);
      tx.sign(kp);
      setSignedXdr(tx.toXdr());
      triggerHaptic("success");
    } catch (e) {
      triggerHaptic("error");
      setAirError(e instanceof Error ? e.message : "Signing failed. Verify transaction XDR.");
    } finally {
      setAirBusy(false);
    }
  }


  function toggleSound(on: boolean) {
    saveSoundPref(on);
    setSoundEnabled(on);
    if (on) triggerHaptic("selection");
  }

  async function handleScanAndRestore() {
    setScanning(true);
    try {
      let restoredCount = 0;
      for (let i = 0; i < 5; i++) {
        if (!accounts.some((a) => a.index === i)) {
          await restoreAccountByIndex(i);
          restoredCount++;
        }
      }
      triggerHaptic("success");
      toast(restoredCount > 0 ? `Restored ${restoredCount} account(s)` : "All derived accounts are active", "info");
    } catch (e) {
      triggerHaptic("error");
      toast(e instanceof Error ? e.message : "Scan failed", "error");
    } finally {
      setScanning(false);
    }
  }

  async function handleMergeAccount() {
    if (mergeFlowLocked) {
      setMergeError("An account merge recovery is already being tracked. Check its final status before starting another merge.");
      return;
    }
    if (!activeAccount || !isValidPublicAddress(mergeDest.trim())) {
      setMergeError("Enter a valid destination Stellar public key.");
      return;
    }
    if (mergeDest.trim() === activeAccount.publicKey) {
      setMergeError("Cannot merge an account into itself.");
      return;
    }
    setMerging(true);
    setMergeError(null);
    try {
      const result = await mergeAccount(mergeDest.trim());
      setMergePending(result);
      triggerHaptic(result.status === "status_unknown" ? "warning" : "medium");
    } catch (e) {
      triggerHaptic("error");
      setMergeError(e instanceof Error ? e.message : "Account merge failed.");
    } finally {
      setMerging(false);
    }
  }

  async function handleClaimFriendbot() {
    setFundingTestnet(true);
    try {
      await fundFromFriendbot();
      triggerHaptic("success");
      toast("Received 10,000 Testnet XLM", "success");
    } catch (e) {
      triggerHaptic("error");
      toast(e instanceof Error ? e.message : "Faucet request failed", "error");
    } finally {
      setFundingTestnet(false);
    }
  }

  async function handleImportKeystoreFile(file: File) {
    setKeystoreJson(await file.text());
    setKsPassword("");
    setKsError(null);
  }

  async function handleKeystoreUnlock() {
    if (!keystoreJson) return;
    setKsBusy(true);
    setKsError(null);
    try {
      await importKeystore(keystoreJson, ksPassword);
      triggerHaptic("success");
      const parsed = JSON.parse(keystoreJson) as { label?: string };
      toast(`Imported "${parsed.label ?? "account"}"`, "success");
      setKeystoreJson(null);
      setKsPassword("");
    } catch (e) {
      triggerHaptic("error");
      setKsError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setKsBusy(false);
    }
  }

  const autoLockLabel =
    autoLockMs === 60000
      ? "1 Minute"
      : autoLockMs === 300000
        ? "5 Minutes"
        : autoLockMs === 900000
          ? "15 Minutes"
          : autoLockMs === 1800000
            ? "30 Minutes"
            : autoLockMs === 3600000
              ? "1 Hour"
              : "Never";

  const nextAccountIndex =
    accounts.reduce((max, a) => Math.max(max, typeof a.index === "number" ? a.index + 1 : 0), 0) ||
    accounts.length;

  const backTarget: Sub | null =
    sub === "root"
      ? null
      : sub === "merge"
        ? "accounts"
        : ownsItsHeader(sub)
          ? "merchant"
          : "root";

  return (
    <div className="fade-up mx-auto w-full max-w-[1000px] min-w-0 px-0 pb-0 md:px-5 md:pb-[150px]">
      {/* Subpage Navigation — suppressed for sub-pages that draw their own. */}
      {sub !== "root" && !ownsItsHeader(sub) && !(merchantOnly && sub === "merchant") && (
        <>
          <div className="flex items-center justify-between pb-1 pt-2">
            <IOSBackButton
              label="Back to Settings"
              onClick={() => {
                setSub(backTarget ?? "root");
              }}
            />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Settings
            </span>
            <span className="w-11" aria-hidden />
          </div>

          <h1 className="display-h mb-5 text-[28px] font-bold text-white">
            {sub === "accounts"
                ? "Accounts"
                : sub === "autolock"
                    ? "Auto-Lock Timer"
                    : sub === "merge"
                      ? "Merge Account"
                      : sub === "airsigner"
                            ? "Local XDR Signer"
                            : sub === "hardware"
                              ? "Hardware Wallets"
                              : sub === "currency"
                                ? "Display Currency"
                                : sub === "merchant"
                                  ? "Merchant"
                                  : "Network"}
          </h1>
        </>
      )}

            {/* ---------- ROOT SETTINGS ---------- */}
      {sub === "root" && (
        <>
          {/* Security Health Score Card */}
          <div className="fade-up mb-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#30D158]/15 text-[#30D158]">
                  <IconShield size={22} />
                </span>
                <div>
                  <p className="text-[14px] font-bold text-white">Wallet Security Health</p>
                  <p className="text-[12px] text-neutral-400">
                    {hasMnemonicVault && autoLockMs > 0 ? "Excellent Protection (100%)" : "Good Protection (80%)"}
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-[#30D158]/20 px-3 py-1 text-[13px] font-bold text-[#30D158]">
                {hasMnemonicVault && autoLockMs > 0 ? "100/100" : "80/100"}
              </span>
            </div>
            <div className="mt-3.5 grid grid-cols-3 gap-2 text-center text-[11.5px]">
              <div className="rounded-xl bg-white/[0.04] p-2">
                <span className="block text-[#30D158] font-bold">✓ AES-256</span>
                <span className="text-neutral-400">PBKDF2-GCM</span>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-2">
                <span className="block text-[#30D158] font-bold">✓ {hasMnemonicVault ? "BIP-39" : "Secret Key"}</span>
                <span className="text-neutral-400">Seed Encrypted</span>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-2">
                <span className="block text-[#30D158] font-bold">✓ Auto-Lock</span>
                <span className="text-neutral-400">{autoLockLabel}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            {/* Column 1: Recovery, security, signing, and privacy */}
            <div className="space-y-6">
              <section aria-labelledby="settings-recovery-title">
                <h2
                  id="settings-recovery-title"
                  className="px-1 pb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400"
                >
                  Recovery
                </h2>
                <div className="list-group">
                  <RowButton
                    icon={<IconShield size={16} />}
                    tint="#30D158"
                    label="Backup & Recovery"
                    sub={backupHealth?.lastExportedAt
                      ? `Last encrypted backup ${new Date(backupHealth.lastExportedAt).toLocaleDateString()}`
                      : "Backup needed · phrase, keys & restore"}
                    chevron
                    onClick={() => {
                      triggerHaptic("selection");
                      onOpenBackupWizard?.();
                    }}
                  />
                </div>
              </section>

              <section aria-labelledby="settings-device-security-title">
                <h2
                  id="settings-device-security-title"
                  className="px-1 pb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400"
                >
                  Device Security
                </h2>
                <div className="list-group">
                  <RowButton
                    icon={<IconFingerprint size={16} />}
                    tint="#5E5CE6"
                    label="Touch ID / Face ID"
                    value={passkeyConfigured ? "On" : passkeyAvailable ? "Off" : "Requires HTTPS"}
                    sub={passkeyConfigured
                      ? "Local passkey unlock on this device"
                      : passkeyAvailable
                        ? "Optional · password remains available"
                        : "Open the installed app or an HTTPS address"}
                    chevron={passkeyAvailable || passkeyConfigured}
                    onClick={() => {
                      if (!passkeyAvailable && !passkeyConfigured) {
                        toast("Face ID / Touch ID requires HTTPS and a compatible browser", "info");
                        return;
                      }
                      setPasskeyError(null);
                      setPasskeyPassword("");
                      setPasskeyDialog(passkeyConfigured ? "remove" : "enable");
                    }}
                  />
                  <RowButton
                    icon={<IconLock size={16} />}
                    tint="#64D2FF"
                    label="Auto-Lock Timer"
                    value={autoLockLabel}
                    chevron
                    onClick={() => {
                      triggerHaptic("selection");
                      setSub("autolock");
                    }}
                    sep
                  />
                </div>
              </section>

              <section aria-labelledby="settings-signing-security-title">
                <h2
                  id="settings-signing-security-title"
                  className="px-1 pb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400"
                >
                  Signing Security
                </h2>
                <div className="list-group">
                  <RowButton
                    icon={<IconShield size={16} />}
                    tint="#0A84FF"
                    label="Multi-Sig Studio"
                    sub="Signers, thresholds & co-signing"
                    chevron
                    onClick={() => {
                      triggerHaptic("selection");
                      onOpenMultisigStudio?.();
                    }}
                  />
                  <RowButton
                    icon={<IconShield size={16} />}
                    tint="#64D2FF"
                    label="Hardware Wallets"
                    value="Trezor"
                    sub="On-device signing via Trezor Connect"
                    chevron
                    onClick={() => {
                      triggerHaptic("selection");
                      setSub("hardware");
                    }}
                    sep
                  />
                  <RowButton
                    icon={<IconLock size={16} />}
                    tint="#5E5CE6"
                    label="Local XDR Signer"
                    sub="Review online, sign locally, never submit"
                    chevron
                    onClick={() => {
                      triggerHaptic("selection");
                      setSub("airsigner");
                    }}
                    sep
                  />
                </div>
              </section>

              <section aria-labelledby="settings-privacy-feedback-title">
                <h2
                  id="settings-privacy-feedback-title"
                  className="px-1 pb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400"
                >
                  Privacy &amp; Feedback
                </h2>
                <div className="list-group">
                  <RowButton
                    as="div"
                    icon={<IconShield size={16} />}
                    tint="#BF5AF2"
                    label="Hide Balances (Privacy)"
                  >
                    <Toggle on={privacyMode} onChange={togglePrivacy} />
                  </RowButton>
                  <RowButton
                    as="div"
                    icon={<IconRefresh size={16} />}
                    tint="#FF9F0A"
                    label="Audio & Haptic Feedback"
                    sep
                  >
                    <Toggle on={soundEnabled} onChange={() => toggleSound(!soundEnabled)} />
                  </RowButton>
                </div>
              </section>
            </div>

            {/* Column 2: Accounts & Tools */}
            <div className="space-y-6">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400 px-1 pb-2">
                  Accounts
                </p>
                <div className="list-group">
                  {activeAccount && (
                    <RowButton
                      icon={<Avatar seed={activeAccount.publicKey} size={29} />}
                      label={activeAccount.label}
                      sub={formatTrezorAddress(activeAccount.publicKey)}
                      chevron
                      onClick={() => {
                        triggerHaptic("selection");
                        setSub("accounts");
                      }}
                      sep
                    />
                  )}
                  <RowButton
                    icon={<IconWallet size={16} />}
                    tint="#64D2FF"
                    label="Primary Display Currency"
                    value={fiatCurrency}
                    chevron
                    onClick={() => {
                      triggerHaptic("selection");
                      setSub("currency");
                    }}
                    sep
                  />
                </div>
              </div>

              {/* Merchant — a counter runs from the same account, so it sits with them */}
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400 px-1 pb-2">
                  Merchant
                </p>
                <div className="list-group">
                  <RowButton
                    as="div"
                    icon={<IconStorefront size={16} />}
                    tint="#30D158"
                    label="Merchant Mode"
                    sub="Take payments at a counter"
                  >
                    <Toggle
                      on={merchantEnabled}
                      label="Merchant Mode"
                      onChange={() => {
                        if (merchantEnabled) {
                          setMerchantEnabled(false);
                        } else if (!merchantConfigured) {
                          // Setup owns the enable commit. Cancelling the sheet
                          // leaves Merchant Mode off and writes nothing.
                          onOpenSetupWizard?.();
                        } else {
                          setMerchantEnabled(true);
                        }
                      }}
                    />
                  </RowButton>
                  {merchantEnabled && (
                    <RowButton
                      icon={<IconStorefront size={16} />}
                      tint="#30D158"
                      label="Merchant"
                      value={merchantProfileName || "Unnamed shop"}
                      chevron
                      sep
                      onClick={() => {
                        triggerHaptic("selection");
                        setSub("merchant");
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Network — its own section */}
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400 px-1 pb-2">
                  Network
                </p>
                <div className="list-group">
                  <RowButton
                    icon={<NetworkBadge network={network} />}
                    label="Network"
                    value={NETWORKS[network].label}
                    chevron
                    onClick={() => {
                      triggerHaptic("selection");
                      setSub("network");
                    }}
                  />
                </div>
              </div>

              {installAvailable && (
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400 px-1 pb-2">
                    App
                  </p>
                  <div className="list-group">
                    <RowButton
                      icon={<IconDownload size={16} />}
                      tint="#0A84FF"
                      label="Install App"
                      sub={installDescription}
                      onClick={onInstallApp}
                    />
                  </div>
                </div>
              )}

              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400 px-1 pb-2">
                  Danger Zone
                </p>
                <div className="list-group">
                  <RowButton
                    icon={<IconTrash size={16} />}
                    label="Reset Wallet"
                    danger
                    onClick={() => {
                      triggerHaptic("warning");
                      setConfirmReset(true);
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ---------- AUTO-LOCK TIMER ---------- */}
      {sub === "autolock" && (
        <div className="space-y-4">
          <div className="list-group">
            {[
              { ms: 60000, label: "1 Minute" },
              { ms: 300000, label: "5 Minutes" },
              { ms: 900000, label: "15 Minutes" },
              { ms: 1800000, label: "30 Minutes" },
              { ms: 3600000, label: "1 Hour" },
              { ms: 0, label: "Never" },
            ].map((opt, i) => (
              <button
                key={opt.ms}
                type="button"
                className={`flex w-full items-center justify-between px-4 py-3.5 text-left ${
                  i > 0 ? "ios-sep" : ""
                }`}
                onClick={() => {
                  triggerHaptic("selection");
                  changeAutoLockMs(opt.ms);
                  setSub("root");
                }}
              >
                <span className="text-[15.5px] font-medium text-white">{opt.label}</span>
                {autoLockMs === opt.ms && <IconCheck size={18} className="text-[#0A84FF]" />}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-neutral-400 px-2">
            The wallet will automatically lock and wipe memory after the selected period of inactivity.
          </p>
        </div>
      )}

      {/* ---------- ACCOUNTS ---------- */}
      {sub === "accounts" && (
        <>
          {activeMergeReconciliation && activeMergePresentation && (
            <Notice tone="warn">
              {activeMergePresentation.message}
              <span className="mt-1 block break-all font-mono text-[10px] text-neutral-400">
                {activeMergeReconciliation.network} · {activeMergeReconciliation.hash}
              </span>
              {activeMergePresentation.manualCheck && (
                <button
                  type="button"
                  className="mt-2 min-h-11 rounded-xl border border-white/15 px-3 text-[12px] font-semibold text-white"
                  onClick={() => retryMergeReconciliation(activeMergeReconciliation)}
                >
                  Check Status
                </button>
              )}
            </Notice>
          )}
          <div className="list-group">
            {accounts.map((acct, i) => (
              <div
                key={acct.id}
                className={`flex w-full items-center justify-between gap-3.5 px-4 py-3.5 ${
                  i > 0 ? "ios-sep" : ""
                }`}
              >
                <button
                  type="button"
                  className="flex items-center gap-3.5 min-w-0 flex-1 text-left"
                  onClick={() => {
                    triggerHaptic("selection");
                    selectAccount(acct.id);
                  }}
                >
                  <Avatar seed={acct.publicKey} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="block truncate text-[15.5px] font-semibold leading-tight text-white">
                        {acct.label}
                      </span>
                      {acct.hardware && (
                        <span className="px-1.5 py-0.2 rounded-md bg-[#0A84FF]/20 border border-[#0A84FF]/30 text-[10px] font-bold text-[#64D2FF] shrink-0">
                          {acct.hardware === "ledger" ? "🔒 Ledger" : "🛡️ Trezor"}
                        </span>
                      )}
                    </div>
                    <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
                      {acct.path ? `Path: ${acct.path}` : formatTrezorAddress(acct.publicKey)}
                    </span>
                  </div>
                  {acct.id === activeAccount?.id && (
                    <IconCheck size={18} className="text-[#0A84FF] shrink-0 mr-1" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection");
                    setEditingAccount(acct);
                  }}
                  className="rounded-lg bg-white/[0.08] px-2.5 py-1 text-[11.5px] font-medium text-neutral-300 hover:bg-white/[0.14] hover:text-white transition-colors"
                >
                  Rename
                </button>
              </div>
            ))}
            <RowButton
              icon={<IconPlus size={15} />}
              tint="#0A84FF"
              label="Add Account"
              sub={"Derives " + stellarAccountPath(nextAccountIndex)}
              chevron
              onClick={() => {
                triggerHaptic("selection");
                setShowAddAccount(true);
              }}
              sep
            />
            {hasMnemonicVault && (
              <RowButton
                icon={scanning ? <Spinner /> : <IconRefresh size={15} />}
                tint="#30D158"
                label={scanning ? "Scanning HD Accounts…" : "Scan & Restore Derived Accounts"}
                sub="Checks HD indexes 0–4"
                onClick={() => {
                  if (!scanning) void handleScanAndRestore();
                }}
                sep
              />
            )}
          </div>

          {/* Archived / Deleted Accounts Section */}
          {archivedAccounts.length > 0 && (
            <div className="mt-6">
              <p className="px-1 pb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
                Deleted / Archived Accounts
              </p>
              <div className="list-group">
                {archivedAccounts.map((acct, i) => (
                  <div
                    key={acct.id}
                    className={`flex items-center justify-between gap-3 px-4 py-3 ${
                      i > 0 ? "ios-sep" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar seed={acct.publicKey} size={30} />
                      <div className="min-w-0">
                        <p className="truncate text-[14.5px] font-semibold text-white">
                          {acct.label}
                        </p>
                        <p className="mono truncate text-[11px] text-neutral-400">
                          {acct.path ?? formatTrezorAddress(acct.publicKey)}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      className="!h-8 !px-3 !text-[12px]"
                      onClick={async () => {
                        triggerHaptic("success");
                        await restoreArchivedAccount(acct.id);
                        toast(`Restored "${acct.label}"`, "success");
                      }}
                    >
                      Restore
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {keystoreJson !== null ? (
            <div className="list-group fade-up mt-4 space-y-3 p-4">
              <p className="text-[13px] leading-relaxed text-neutral-300">
                Keystore detected — enter the password that encrypted it.
              </p>
              <input
                className="input"
                type="password"
                placeholder="Keystore password"
                value={ksPassword}
                onChange={(e) => setKsPassword(e.target.value)}
                autoComplete="off"
              />
              <ErrorText message={ksError ?? ""} />
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1"
                  disabled={ksBusy}
                  onClick={() => {
                    setKeystoreJson(null);
                    setKsPassword("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  loading={ksBusy}
                  disabled={!ksPassword || ksBusy}
                  onClick={() => void handleKeystoreUnlock()}
                >
                  Import
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="mt-3 w-full rounded-2xl bg-white/[0.08] py-3.5 text-center text-[15px] font-semibold text-[#0A84FF] hover:bg-white/[0.12] transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              Import from Keystore File…
            </button>
          )}
          
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportKeystoreFile(f);
              e.target.value = "";
            }}
          />
          

          {accounts.length > 1 && (
            <div className="list-group mt-6 space-y-1">
              <RowButton
                icon={<IconWallet size={15} />}
                tint="#FF9F0A"
                label="Merge Account & Recover Reserve"
                sub="Dissolve account into destination"
                chevron
                onClick={() => {
                  triggerHaptic("selection");
                  setSub("merge");
                }}
                sep
              />
              <RowButton
                icon={<IconTrash size={15} />}
                tint="#FF453A"
                label={`Remove "${activeAccount?.label ?? ""}"`}
                danger
                onClick={() => {
                  triggerHaptic("warning");
                  if (activeAccount) {
                    removeAccount(activeAccount.id);
                    toast("Account archived", "info");
                  }
                }}
              />
            </div>
          )}
        </>
      )}

      {/* ---------- MERGE ACCOUNT ---------- */}
      {sub === "merge" && (
        <div className="space-y-4">
          <Notice tone="pos">
            Account merge transfers all remaining lumens (including the 1.0 XLM base reserve) to the destination account and permanently closes this account on the network.
          </Notice>
          <p className="px-1 text-[12px] text-neutral-400">
            Selected network fee: {networkFeeXlm(recommendedBaseFeeStroops, 1)} XLM
          </p>

          <div className="list-group p-4 space-y-4">
            <Field label="Destination Stellar Address" hint="Must be an existing active account">
              <input
                className="input mono text-base sm:text-[13px]"
                placeholder="G..."
                value={mergeDest}
                disabled={mergeFlowLocked}
                onChange={(e) => setMergeDest(e.target.value.trim())}
                spellCheck={false}
              />
            </Field>

            {accounts.filter((a) => a.id !== activeAccount?.id).length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                  Or select one of your accounts
                </p>
                <div className="space-y-1.5">
                  {accounts
                    .filter((a) => a.id !== activeAccount?.id)
                    .map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          triggerHaptic("selection");
                          setMergeDest(a.publicKey);
                        }}
                        className={`flex w-full items-center justify-between rounded-xl border p-2.5 text-left transition-colors ${
                          mergeDest === a.publicKey
                            ? "border-[#0A84FF] bg-[#0A84FF]/10 text-white"
                            : "border-white/10 bg-white/[0.04] text-neutral-300 hover:text-white"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar seed={a.publicKey} size={24} />
                          <span className="truncate text-[13px] font-medium">{a.label}</span>
                        </div>
                        <span className="mono text-[11px] text-neutral-400">
                          {formatTrezorAddress(a.publicKey)}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          <ErrorText message={mergeError ?? ""} />

          {mergePending && (
            <Notice tone={trackedMergeStatus === "status_unknown" ? "warn" : "pos"}>
              {trackedMergeStatus === "status_unknown"
                ? "Account-merge status is unknown."
                : trackedMergeStatus === "confirmed"
                  ? "Account merge is confirmed."
                  : "Account merge was accepted and is confirming."} Do not resubmit blindly or
              remove the local account yet. Tracking {mergePending.network} transaction{" "}
              {mergePending.hash}.
            </Notice>
          )}

          <Button
            variant="danger"
            className="w-full !py-3.5 text-[15px] font-semibold"
            loading={merging}
            disabled={!mergeDest || merging || mergeFlowLocked}
            onClick={() => void handleMergeAccount()}
          >
            Confirm & Merge Account
          </Button>
        </div>
      )}

      {/* ---------- LOCAL TRANSACTION SIGNER ---------- */}
      {sub === "airsigner" && (
        <div className="space-y-4">
          <p className="text-[13px] text-neutral-300 leading-relaxed">
            Sign an imported envelope locally without submitting it. Current signer weights are
            verified through Horizon before the encrypted key is requested; the key never leaves
            this device.
          </p>

          <Field label="Unsigned Transaction XDR" hint="Paste transaction envelope">
            <textarea
              rows={4}
              placeholder="AAAAAG..."
              value={airXdr}
              onChange={(e) => {
                airReviewGeneration.current += 1;
                setAirXdr(e.target.value);
                setSignedXdr(null);
                setAirReview(null);
                setAirReviewedXdr("");
                setAirAuthorizedSigner(null);
                setAirNetworkConfirmed(false);
                setAirPw("");
                setAirError(null);
              }}
              className="input mono text-base resize-none sm:text-[12px]"
            />
          </Field>

          {!airReview && (
            <Button
              className="w-full"
              loading={airBusy}
              disabled={!airXdr.trim() || airBusy}
              onClick={() => void handleAirReview()}
            >
              Decode & Review Transaction
            </Button>
          )}

          {airReview && (
            <div className="space-y-3">
              <div className="panel-inset divide-y divide-white/[0.08] px-4 text-[12.5px]">
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <span className="text-neutral-400">Selected network</span>
                  <span className="font-semibold text-white">{airReview.networkLabel}</span>
                </div>
                <div className="space-y-1 py-2.5">
                  <span className="text-neutral-400">Transaction source</span>
                  <HashValue
                    full
                    value={airReview.source}
                    className="text-[11px] leading-loose text-neutral-200"
                  />
                </div>
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <span className="text-neutral-400">Fee</span>
                  <span className="mono text-neutral-200">{airReview.feeXlm} XLM</span>
                </div>
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <span className="text-neutral-400">Memo</span>
                  <span className="mono break-all text-right text-neutral-200">
                    {airReview.memoText ?? "None"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <span className="text-neutral-400">Time bounds</span>
                  <span className="mono text-right text-neutral-200">
                    {airReview.timeBounds
                      ? `${airReview.timeBounds.minTime} – ${airReview.timeBounds.maxTime ?? "no expiry"}`
                      : "None"}
                  </span>
                </div>
              </div>

              {airReview.operations.map((operation, index) => (
                <div
                  key={`${operation.type}-${index}`}
                  className={`rounded-2xl border p-3.5 ${
                    operation.signable
                      ? "border-white/[0.08] bg-white/[0.03]"
                      : "border-[#FF453A]/30 bg-[#FF453A]/[0.06]"
                  }`}
                >
                  <p className="text-[13px] font-semibold text-white">
                    {index + 1}. {operation.title}
                  </p>
                  <div className="mt-2 space-y-2">
                    {operation.lines.map((line, lineIndex) => (
                      <div key={`${line.label}-${lineIndex}`} className="text-[11.5px]">
                        <p className="text-neutral-500">{line.label}</p>
                        {line.kind === "address" ? (
                          <HashValue
                            full
                            value={line.value}
                            className="text-[11px] leading-loose text-neutral-200"
                          />
                        ) : (
                          <p className="mono break-all text-neutral-200">{line.value}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {!airReview.signable && (
                <div className="rounded-2xl border border-[#FF453A]/30 bg-[#FF453A]/[0.07] p-3 text-[12px] leading-relaxed text-[#FF6961]">
                  Signing blocked: {airReview.blockingReasons.join(" ")}
                </div>
              )}

              {activeAccount && !airSignerReady && airReview.signable && airError && (
                <div className="space-y-2">
                  <div className="rounded-2xl border border-[#FF453A]/30 bg-[#FF453A]/[0.07] p-3 text-[12px] leading-relaxed text-[#FF6961]">
                    Signing blocked: current on-chain signer authorization could not be proven for
                    the active account.
                  </div>
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={airBusy}
                    loading={airBusy}
                    onClick={() => void handleAirAuthorizationRetry()}
                  >
                    Retry Authorization
                  </Button>
                </div>
              )}

              {airReview.signable &&
                activeAccount &&
                airSignerReady && (
                  <>
                    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.1] bg-white/[0.03] p-3.5 text-[12px] leading-relaxed text-neutral-300">
                      <input
                        type="checkbox"
                        checked={airNetworkConfirmed}
                        onChange={(event) => setAirNetworkConfirmed(event.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-[#0A84FF]"
                      />
                      <span>
                        I confirm this envelope should execute on <strong>{airReview.networkLabel}</strong>.
                        XDR itself does not encode a network.
                      </span>
                    </label>

                    <Field label="Wallet Password" hint="Unlocked only after this review">
                      <input
                        type="password"
                        placeholder="Enter password"
                        value={airPw}
                        onChange={(e) => setAirPw(e.target.value)}
                        className="input text-base sm:text-[13.5px]"
                      />
                    </Field>

                    <Button
                      className="w-full"
                      loading={airBusy}
                      disabled={!airPw || !airNetworkConfirmed || airBusy}
                      onClick={() => void handleAirSign()}
                    >
                      Sign Reviewed Transaction Locally
                    </Button>
                  </>
                )}
            </div>
          )}

          {airError && (
            <div className="mt-2">
              <ErrorText message={airError} />
            </div>
          )}

          {signedXdr && (
            <div className="fade-up panel-inset mt-4 p-4 space-y-2">
              <p className="text-[12px] font-bold text-[#30D158]">✓ Transaction Signed Successfully</p>
              <div className="mono select-all break-all rounded-xl bg-black/40 p-2.5 text-[11px] text-neutral-300 max-h-32 overflow-y-auto">
                {signedXdr}
              </div>
              <CopyButton value={signedXdr} label="Copy Signed XDR" className="chip w-full justify-center" />
            </div>
          )}
        </div>
      )}

      {/* ---------- HARDWARE WALLETS (LEDGER & TREZOR) ---------- */}
      {sub === "hardware" && (
        <div className="space-y-5">
          <p className="text-[13px] text-neutral-300 leading-relaxed">
            Connect your physical hardware wallet for institutional-grade cold storage security.
            Your private keys never leave the device, and every transaction requires physical confirmation.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Trezor Device Card */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 flex flex-col justify-between shadow-xl space-y-4">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <IconTrezor size={20} />
                  </div>
                    <div>
                      <h3 className="text-[16px] font-bold text-white">Trezor</h3>
                      <p className="text-[11.5px] text-neutral-400">Safe 3 · Model T · Model One</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10.5px] font-semibold text-emerald-400">
                    Trezor Connect
                  </span>
                </div>
                <p className="text-[12px] text-neutral-400 leading-relaxed">
                  Open-source hardware architecture with on-screen touchscreen or tactile pin verification.
                </p>
              </div>
              <Button
                className="w-full !py-2.5 text-[13.5px] font-semibold !bg-[#0A84FF] text-white"
                onClick={() => {
                  triggerHaptic("selection");
                  setAddAccountMode("hardware");
                  setShowAddAccount(true);
                }}
              >
                Connect Trezor Device
              </Button>
            </div>

            {/* Ledger Device Card */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 flex flex-col justify-between shadow-xl space-y-4">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-[#64D2FF]">
                    <IconLedger size={20} />
                  </div>
                    <div>
                      <h3 className="text-[16px] font-bold text-white">Ledger</h3>
                      <p className="text-[11.5px] text-neutral-400">Stax · Nano X · Nano S Plus</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[10.5px] font-semibold text-neutral-400">
                    Not Available
                  </span>
                </div>
                <p className="text-[12px] text-neutral-400 leading-relaxed">
                  Ledger signing is intentionally disabled until a real Stellar transport and on-device verification flow are implemented.
                </p>
              </div>
              <Button className="w-full !py-2.5 text-[13.5px] font-semibold" disabled>
                Ledger Integration Unavailable
              </Button>
            </div>
          </div>

          {/* Connected Hardware Accounts */}
          {accounts.some((a) => a.hardware) && (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400 px-1 pb-2">
                Connected Hardware Accounts
              </p>
              <div className="list-group">
                {accounts
                  .filter((a) => a.hardware)
                  .map((acct, i) => (
                    <div
                      key={acct.id}
                      className={`flex items-center justify-between gap-3 px-4 py-3.5 ${
                        i > 0 ? "ios-sep" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xl">
                          {acct.hardware === "trezor" ? "🛡️" : "🔒"}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold text-white">
                            {acct.label}
                          </p>
                          <p className="mono truncate text-[11.5px] text-neutral-400">
                            {acct.path ?? formatTrezorAddress(acct.publicKey)}
                          </p>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-md bg-[#0A84FF]/20 text-[#64D2FF] text-[11px] font-bold">
                        {acct.hardware === "trezor" ? "Trezor Safe" : "Ledger Nano"}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Security Best Practices */}
          <div className="panel-inset p-4 space-y-2 text-[12px] text-neutral-300">
            <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
              Hardware Security Checklist
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[#30D158]">✓</span>
              <span>Always verify the destination address and amount on the physical device screen.</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#30D158]">✓</span>
              <span>Ensure your device firmware and the Stellar app are up to date.</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#30D158]">✓</span>
              <span>Never type your hardware wallet recovery seed into any computer or phone.</span>
            </div>
          </div>
        </div>
      )}

      {/* ---------- DISPLAY CURRENCY PICKER ---------- */}
      {sub === "currency" && (
        <div className="space-y-4">
          <p className="text-[13px] text-neutral-300 leading-relaxed">
            Select your preferred fiat currency for portfolio valuations, charts, and asset rates.
          </p>

          <div className="list-group">
            {(
              [
                { id: "USD", name: "United States Dollar", symbol: "$" },
                { id: "EUR", name: "Euro", symbol: "€" },
                { id: "GBP", name: "British Pound", symbol: "£" },
                { id: "JPY", name: "Japanese Yen", symbol: "¥" },
                { id: "CAD", name: "Canadian Dollar", symbol: "CA$" },
                { id: "AUD", name: "Australian Dollar", symbol: "A$" },
                { id: "CHF", name: "Swiss Franc", symbol: "CHF" },
              ] as const
            ).map((curr, idx) => (
              <button
                key={curr.id}
                type="button"
                className={`flex w-full items-center justify-between px-4 py-3.5 text-left ${
                  idx > 0 ? "ios-sep" : ""
                }`}
                onClick={() => {
                  triggerHaptic("selection");
                  if (fiatCurrency !== curr.id) changeFiatCurrency(curr.id);
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="mono flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.08] text-[13px] font-bold text-white">
                    {curr.symbol}
                  </span>
                  <div>
                    <span className="block text-[15px] font-semibold text-white">{curr.id}</span>
                    <span className="block text-[12px] text-neutral-400">{curr.name}</span>
                  </div>
                </div>
                {fiatCurrency === curr.id && (
                  <IconCheck size={18} className="text-[#0A84FF] shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---------- MERCHANT ---------- */}
      {sub === "merchant" && (
        <MerchantSettings
          onDisabled={() => setSub("root")}
          onNavigate={setSub}
          onOpenSwap={onOpenSwap}
          onOpenSend={onOpenSend}
        />
      )}

      {/* Merchant sub-pages draw their own back button, so they render bare. */}
      {sub === "staff" && <StaffTerminalsPage onBack={() => setSub("merchant")} />}
      {sub === "tax" && <TaxRecordsPage onBack={() => setSub("merchant")} />}
      {sub === "peripherals" && <PeripheralsPage onBack={() => setSub("merchant")} />}

      {/* ---------- NETWORK SWITCHER & HEALTH ---------- */}
      {sub === "network" && (
        <div className="space-y-4">
          <SegmentedControl<NetworkKey>
            value={network}
            onChange={(n) => {
              triggerHaptic("selection");
              switchNetwork(n);
              setHorizonDraft(getHorizonUrl(n));
              setRpcDraft(getRpcUrl(n) ?? "");
              setEndpointHealth({});
              setEndpointError(null);
            }}
            options={[
              { value: "testnet", label: "Testnet" },
              { value: "mainnet", label: "Mainnet" },
            ]}
          />

          <div className="panel-inset space-y-2.5 p-4 text-[12.5px]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Live Network Health
            </p>
            <div className="flex justify-between text-neutral-300">
              <span>Status</span>
              <span className={`flex items-center gap-1.5 font-medium ${endpointHealth.horizon ? "text-[#30D158]" : "text-neutral-400"}`}>
                <span className={`h-2 w-2 rounded-full ${endpointHealth.horizon ? "bg-[#30D158]" : "bg-neutral-500"}`} />
                {endpointHealth.horizon ? "Verified" : "Not checked"}
              </span>
            </div>
            <div className="flex justify-between text-neutral-300">
              <span>Selected Network Fee</span>
              <span className="mono text-white">
                {networkFeeXlm(recommendedBaseFeeStroops, 1)} XLM / operation
              </span>
            </div>
            <div className="flex justify-between text-neutral-300">
              <span>Horizon Endpoint</span>
              <span className="mono max-w-[200px] truncate text-[11px] text-neutral-400">
                {getHorizonUrl(network)}
              </span>
            </div>
            <div className="flex justify-between items-center text-neutral-300 pt-1">
              <span>Endpoint Latency</span>
              <span className="mono font-semibold text-white">
                {endpointHealth.horizon ? `${endpointHealth.horizon.latencyMs}ms` : "—"}
              </span>
            </div>
            {endpointHealth.horizon?.latestLedger !== undefined && (
              <div className="flex justify-between text-neutral-300">
                <span>Latest observed ledger</span>
                <span className="mono text-white">{endpointHealth.horizon.latestLedger.toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="list-group space-y-4 p-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13.5px] font-semibold text-white">Horizon</p>
                  <p className="text-[11.5px] text-neutral-400">
                    {loadCustomEndpoint(network, "horizon") ? "Custom endpoint" : "Built-in public endpoint"}
                  </p>
                </div>
                {endpointHealth.horizon && (
                  <span className="text-[11.5px] font-semibold text-[#30D158]">
                    Verified · {endpointHealth.horizon.latencyMs}ms
                  </span>
                )}
              </div>
              <input
                className="input mono text-base sm:text-[12.5px]"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={horizonDraft}
                onChange={(event) => {
                  setHorizonDraft(event.target.value);
                  setEndpointHealth((current) => ({ ...current, horizon: undefined }));
                  setEndpointError(null);
                }}
                placeholder="https://horizon.example"
                aria-label="Horizon endpoint"
              />
              <Button
                variant="secondary"
                className="mt-2 w-full"
                loading={endpointTesting === "horizon"}
                disabled={!horizonDraft.trim() || endpointTesting !== null}
                onClick={() => void handleTestAndSaveEndpoint("horizon")}
              >
                {"Test & Save Horizon"}
              </Button>
            </div>

            <div className="border-t border-white/[0.08] pt-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13.5px] font-semibold text-white">Stellar RPC</p>
                  <p className="text-[11.5px] text-neutral-400">
                    {loadCustomEndpoint(network, "rpc")
                      ? "Custom endpoint"
                      : NETWORKS[network].rpcUrl
                        ? "Built-in public endpoint"
                        : "Optional · no Mainnet provider bundled"}
                  </p>
                </div>
                {endpointHealth.rpc && (
                  <span className="text-[11.5px] font-semibold text-[#30D158]">
                    Verified · {endpointHealth.rpc.latencyMs}ms
                  </span>
                )}
              </div>
              <input
                className="input mono text-base sm:text-[12.5px]"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={rpcDraft}
                onChange={(event) => {
                  setRpcDraft(event.target.value);
                  setEndpointHealth((current) => ({ ...current, rpc: undefined }));
                  setEndpointError(null);
                }}
                placeholder="https://rpc.example"
                aria-label="Stellar RPC endpoint"
              />
              <Button
                variant="secondary"
                className="mt-2 w-full"
                loading={endpointTesting === "rpc"}
                disabled={!rpcDraft.trim() || endpointTesting !== null}
                onClick={() => void handleTestAndSaveEndpoint("rpc")}
              >
                {"Test & Save RPC"}
              </Button>
            </div>

            <ErrorText message={endpointError ?? ""} />

            <button
              type="button"
              className="block min-h-11 w-full text-center text-[13px] font-medium text-[#0A84FF]"
              onClick={handleResetEndpoints}
              disabled={endpointTesting !== null}
            >
              Reset to Defaults
            </button>
            <p className="text-[11.5px] leading-relaxed text-neutral-500">
              Endpoints are stored only in this browser. The app accepts HTTPS URLs only and verifies
              the network passphrase before saving.
            </p>
          </div>

          {network === "testnet" && (
            <div className="pt-2">
              <Button
                variant="secondary"
                className="w-full !py-3 text-[14px] flex items-center justify-center gap-2"
                loading={fundingTestnet}
                disabled={fundingTestnet}
                onClick={() => void handleClaimFriendbot()}
              >
                <IconRefresh size={15} /> Claim 10,000 Testnet XLM (Friendbot)
              </Button>
            </div>
          )}

          {network === "mainnet" ? (
            <Notice tone="pos">
              You are connected to Stellar Mainnet. Transactions involve real assets and fees.
            </Notice>
          ) : (
            <Notice>
              Testnet lumens are free and funded by SDF Friendbot for development and testing.
            </Notice>
          )}
        </div>
      )}

      {/* Add Account Modal */}
      <AddAccountModal
        open={showAddAccount}
        initialMode={addAccountMode}
        onClose={() => {
          setShowAddAccount(false);
          setAddAccountMode("generate");
        }}
      />

      {/* Rename Account Modal */}
      <RenameAccountModal
        account={editingAccount}
        onClose={() => setEditingAccount(null)}
      />

      <Modal
        open={passkeyDialog !== null}
        onClose={() => {
          if (passkeyBusy) return;
          setPasskeyDialog(null);
          setPasskeyPassword("");
          setPasskeyError(null);
        }}
        dismissable={!passkeyBusy}
      >
        <ModalHeader
          title={passkeyDialog === "remove" ? "Remove Passkey Unlock?" : "Enable Face ID / Touch ID"}
          subtitle="Origin-bound with a wrapper stored by this app"
          onClose={passkeyBusy ? undefined : () => {
            setPasskeyDialog(null);
            setPasskeyPassword("");
            setPasskeyError(null);
          }}
        />
        <div className="space-y-4 p-4 sm:p-6">
          {passkeyDialog === "remove" ? (
            <>
              <p className="text-[13.5px] leading-relaxed text-neutral-300">
                This removes the local wrapper that lets this device unlock your vault. It does not
                delete a passkey entry from iCloud Keychain or change your wallet password.
              </p>
              <p className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-3 text-[12.5px] leading-relaxed text-neutral-400">
                Your password and encrypted backup remain the recovery path.
              </p>
              <Field label="Wallet Password" hint="Required before removing device unlock">
                <input
                  className="input text-base sm:text-[14px]"
                  type="password"
                  autoComplete="current-password"
                  value={passkeyPassword}
                  onChange={(event) => setPasskeyPassword(event.target.value)}
                  placeholder="Enter password"
                  disabled={passkeyBusy}
                />
              </Field>
              <ErrorText message={passkeyError ?? ""} />
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="ghost"
                  disabled={passkeyBusy}
                  onClick={() => {
                    setPasskeyDialog(null);
                    setPasskeyPassword("");
                    setPasskeyError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  loading={passkeyBusy}
                  disabled={!passkeyPassword || passkeyBusy}
                  onClick={() => void handleRemovePasskey()}
                >
                  Remove
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[13.5px] leading-relaxed text-neutral-300">
                Your device will create a passkey and use Face ID or Touch ID to derive a key that
                unwraps this vault locally. No account, server, or cloud wallet service is required.
              </p>
              <p className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-3 text-[12.5px] leading-relaxed text-neutral-400">
                Your password and encrypted backup remain the recovery path. Passkey unlock works
                only from this exact app origin, so keep both.
              </p>
              <Field label="Wallet Password" hint="Confirms access before adding this device">
                <input
                  className="input text-base sm:text-[14px]"
                  type="password"
                  autoComplete="current-password"
                  value={passkeyPassword}
                  onChange={(event) => setPasskeyPassword(event.target.value)}
                  placeholder="Enter password"
                  disabled={passkeyBusy}
                />
              </Field>
              <ErrorText message={passkeyError ?? ""} />
              <Button
                className="w-full !py-3 text-[14px] font-semibold"
                loading={passkeyBusy}
                disabled={!passkeyPassword || passkeyBusy}
                onClick={() => void handleEnablePasskey()}
              >
                Enable Face ID / Touch ID
              </Button>
            </>
          )}
        </div>
      </Modal>

      {/* Reset Confirmation Modal */}
      <ResetWalletModal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
      />
    </div>
  );
}

function RowButton({
  icon,
  tint,
  label,
  value,
  sub,
  chevron,
  danger,
  sep,
  onClick,
  as = "button",
  children,
}: {
  icon: React.ReactNode;
  tint?: string;
  label: string;
  value?: string;
  sub?: string;
  chevron?: boolean;
  danger?: boolean;
  sep?: boolean;
  onClick?: () => void;
  as?: "button" | "div";
  children?: React.ReactNode;
}) {
  const Tag = as === "div" || !onClick ? "div" : "button";
  return (
    <Tag
      className={`row-hover flex w-full items-center gap-3.5 px-4 py-3.5 text-left ${
        sep ? "ios-sep" : ""
      }`}
      onClick={onClick}
    >
      {tint ? (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
          style={{ background: tint }}
        >
          {icon}
        </span>
      ) : (
        icon
      )}
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[15.5px] font-normal leading-tight ${
            danger ? "text-[#FF453A]" : "text-white"
          }`}
        >
          {label}
        </span>
        {sub && (
          <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
            {sub}
          </span>
        )}
      </span>
      {value && <span className="text-[14.5px] text-neutral-400 font-medium">{value}</span>}
      {children}
      {chevron && (
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
      )}
    </Tag>
  );
}

function Notice({ tone, children }: { tone?: "pos" | "warn"; children: React.ReactNode }) {
  return (
    <div
      className="mt-4 rounded-2xl px-4 py-3 text-[13px] leading-relaxed border"
      style={{
        background: tone === "pos"
          ? "rgba(48,209,88,0.08)"
          : tone === "warn"
            ? "rgba(255,159,10,0.08)"
            : "rgba(255,255,255,0.04)",
        borderColor: tone === "pos"
          ? "rgba(48,209,88,0.2)"
          : tone === "warn"
            ? "rgba(255,159,10,0.25)"
            : "rgba(255,255,255,0.08)",
        color: tone === "pos" ? "#30D158" : tone === "warn" ? "#FF9F0A" : "var(--color-muted)",
      }}
    >
      {children}
    </div>
  );
}
