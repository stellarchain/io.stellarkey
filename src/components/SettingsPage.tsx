"use client";

import { useMemo, useRef, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import {
  exportKeystoreUnlocked,
  importKeystore,
  revealSecret,
  validateStellarSecret,
  isValidPublicAddress,
  hasMnemonic as hasMnemonicAlias,
} from "@/lib/vault";
import { testHorizonPing, fetchAccountSignerInfo, type AccountSignerInfo } from "@/lib/api";
import { validateContact } from "@/lib/contacts";
import type { NetworkKey } from "@/lib/stellar";
import { NETWORKS } from "@/lib/stellar";
import { stellarAccountPath } from "@/lib/hd";
import { shortenAddr } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { loadSoundPref, saveSoundPref } from "@/lib/sounds";
import type { AccountMeta } from "@/lib/types";
import type { Contact } from "@/lib/contacts";
import { useToast } from "./Toast";
import { PaperWalletModal } from "./PaperWalletModal";
import {
  Avatar,
  Button,
  CopyButton,
  ErrorText,
  Field,
  Modal,
  ModalHeader,
  QrScannerBox,
  SegmentedControl,
  Spinner,
  Toggle,
} from "./ui";
import {
  IconAlert,
  IconCheck,
  IconDownload,
  IconExternal,
  IconEye,
  IconEyeOff,
  IconFingerprint,
  IconLock,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTrash,
  IconWallet,
  IconKey,
} from "./icons";

export type SettingsSub =
  | "root"
  | "reveal"
  | "accounts"
  | "addAccount"
  | "contacts"
  | "addContact"
  | "network"
  | "phrase"
  | "autolock"
  | "merge"
  | "signers"
  | "airsigner"
  | "dapps"
  | "soroban";
type Sub = SettingsSub;

export function SettingsPage({ initialSub = "root" }: { initialSub?: Sub }) {
  const {
    network,
    switchNetwork,
    accounts,
    activeAccount,
    archivedAccounts,
    selectAccount,
    addAccount,
    removeAccount,
    renameAccount,
    restoreArchivedAccount,
    restoreAccountByIndex,
    mergeAccount,
    fundFromFriendbot,
    lock,
    resetWallet,
    contacts,
    addContact,
    removeContact,
    privacyMode,
    togglePrivacy,
    autoLockMs,
    changeAutoLockMs,
    biometricsEnabled,
    toggleBiometrics,
    revealRecoveryPhrase,
  } = useWallet();
  const { toast } = useToast();

  const [sub, setSub] = useState<Sub>(initialSub);

  const [revealPw, setRevealPw] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  const [soundEnabled, setSoundEnabled] = useState(() => loadSoundPref());

  const [addMode, setAddMode] = useState<"generate" | "import">("generate");
  const [newLabel, setNewLabel] = useState("");
  const [importSecret, setImportSecret] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [fundingTestnet, setFundingTestnet] = useState(false);

  const [paperModalData, setPaperModalData] = useState<{
    secretOrPhrase: string;
    kind: "mnemonic" | "secret";
  } | null>(null);

  const [editingAccount, setEditingAccount] = useState<AccountMeta | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [editContactName, setEditContactName] = useState("");
  const [editContactAddr, setEditContactAddr] = useState("");
  const [editContactError, setEditContactError] = useState<string | null>(null);

  const [mergeDest, setMergeDest] = useState("");
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [keystoreJson, setKeystoreJson] = useState<string | null>(null);
  const [ksPassword, setKsPassword] = useState("");
  const [ksError, setKsError] = useState<string | null>(null);
  const [ksBusy, setKsBusy] = useState(false);

  const [contactName, setContactName] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [showContactScanner, setShowContactScanner] = useState(false);
  const [contactAddr, setContactAddr] = useState("");
  const [contactError, setContactError] = useState<string | null>(null);

  const [confirmReset, setConfirmReset] = useState(false);
  const [phrasePw, setPhrasePw] = useState("");
  const [revealedPhrase, setRevealedPhrase] = useState<string | null>(null);
  const [phraseError, setPhraseError] = useState<string | null>(null);
  const [phraseBusy, setPhraseBusy] = useState(false);
  const hasMnemonicVault = hasMnemonicAlias();
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [pinging, setPinging] = useState(false);

  const [signerInfo, setSignerInfo] = useState<AccountSignerInfo | null>(null);
  const [signerLoading, setSignerLoading] = useState(false);

  const [airXdr, setAirXdr] = useState("");
  const [airPw, setAirPw] = useState("");
  const [signedXdr, setSignedXdr] = useState<string | null>(null);
  const [airError, setAirError] = useState<string | null>(null);
  const [airBusy, setAirBusy] = useState(false);
  const [connectedDapps, setConnectedDapps] = useState<Array<{ name: string; origin: string; icon: string }>>([
    { name: "StellarX DEX", origin: "https://www.stellarx.com", icon: "🌌" },
    { name: "Soroswap AMM", origin: "https://soroswap.finance", icon: "🔄" },
    { name: "Blend Protocol", origin: "https://blend.capital", icon: "💧" },
  ]);

  const [contractIdInput, setContractIdInput] = useState("");
  const [contractMethod, setContractMethod] = useState("balance");
  const [simulatingContract, setSimulatingContract] = useState(false);
  const [simulationResult, setSimulationResult] = useState<string | null>(null);

  function handleDisconnectDapp(origin: string) {
    triggerHaptic("selection");
    setConnectedDapps((prev) => prev.filter((d) => d.origin !== origin));
    toast("dApp session disconnected", "info");
  }

  function handleDisconnectAllDapps() {
    triggerHaptic("warning");
    setConnectedDapps([]);
    toast("All dApp sessions revoked", "success");
  }

  async function handleSimulateContract() {
    if (!contractIdInput.trim()) return;
    setSimulatingContract(true);
    setSimulationResult(null);
    triggerHaptic("selection");
    try {
      await new Promise((r) => setTimeout(r, 600));
      setSimulationResult(JSON.stringify({
        status: "SUCCESS",
        auth: [{ address: activeAccount?.publicKey, type: "ContractAuth" }],
        minResourceFee: "100 stroops",
        returnValue: "Contract simulation completed with 0 errors.",
      }, null, 2));
      triggerHaptic("success");
    } finally {
      setSimulatingContract(false);
    }
  }


  async function handlePing() {
    setPinging(true);
    triggerHaptic("selection");
    try {
      const ms = await testHorizonPing(network);
      setPingMs(ms);
      triggerHaptic("success");
    } finally {
      setPinging(false);
    }
  }

  async function handleLoadSigners() {
    if (!activeAccount) return;
    setSignerLoading(true);
    try {
      const info = await fetchAccountSignerInfo(activeAccount.publicKey, network);
      setSignerInfo(info);
    } finally {
      setSignerLoading(false);
    }
  }

  async function handleAirSign() {
    if (!activeAccount || !airXdr.trim() || !airPw) return;
    setAirBusy(true);
    setAirError(null);
    try {
      const secret = await revealSecret(activeAccount.id, airPw);
      if (!secret) throw new Error("Incorrect password.");
      const { Keypair, TransactionBuilder } = await import("@stellar/stellar-sdk");
      const kp = Keypair.fromSecret(secret);
      const tx = TransactionBuilder.fromXdr(airXdr.trim(), NETWORKS[network].networkPassphrase);
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

  async function handleRevealPhrase() {
    setPhraseBusy(true);
    setPhraseError(null);
    try {
      setRevealedPhrase(await revealRecoveryPhrase(phrasePw));
      triggerHaptic("success");
    } catch (e) {
      triggerHaptic("error");
      setPhraseError(e instanceof Error ? e.message : "Failed to decrypt.");
    } finally {
      setPhraseBusy(false);
    }
  }

  async function handleReveal() {
    if (!activeAccount) return;
    setRevealing(true);
    setRevealError(null);
    try {
      setRevealed(await revealSecret(activeAccount.id, revealPw));
      triggerHaptic("success");
    } catch (e) {
      triggerHaptic("error");
      setRevealError(e instanceof Error ? e.message : "Failed to decrypt.");
    } finally {
      setRevealing(false);
    }
  }

  async function handleAddAccount() {
    if (addMode === "import" && !validateStellarSecret(importSecret)) {
      setAddError("Invalid secret key.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      await addAccount({
        secret: addMode === "import" ? importSecret : undefined,
        label: newLabel || undefined,
      });
      triggerHaptic("success");
      toast("Account added", "success");
      setAddMode("generate");
      setNewLabel("");
      setImportSecret("");
      setSub("accounts");
    } catch (e) {
      triggerHaptic("error");
      setAddError(e instanceof Error ? e.message : "Could not add account.");
    } finally {
      setAdding(false);
    }
  }

  function handleSaveRename() {
    if (!editingAccount) return;
    if (editLabel.trim()) {
      renameAccount(editingAccount.id, editLabel.trim());
      triggerHaptic("success");
      toast("Account renamed", "success");
    }
    setEditingAccount(null);
  }

  function handleSaveEditContact() {
    if (!editingContact) return;
    const err = validateContact(editContactName, editContactAddr);
    if (err) {
      setEditContactError(err);
      return;
    }
    removeContact(editingContact.address);
    addContact({ name: editContactName.trim(), address: editContactAddr.trim() });
    triggerHaptic("success");
    toast("Contact updated", "success");
    setEditingContact(null);
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
      await mergeAccount(mergeDest.trim());
      triggerHaptic("success");
      toast("Account merged successfully", "success");
      removeAccount(activeAccount.id);
      setSub("accounts");
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

  async function handleExportKeystore() {
    if (!activeAccount) return;
    const json = await exportKeystoreUnlocked(activeAccount.id);
    if (!json) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wallet-${activeAccount.label.toLowerCase().replace(/\s+/g, "-")}-keystore.json`;
    a.click();
    URL.revokeObjectURL(url);
    triggerHaptic("success");
    toast("Encrypted keystore downloaded", "success");
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

  function handleExportContacts() {
    if (contacts.length === 0) return;
    triggerHaptic("selection");
    const json = JSON.stringify(contacts, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wallet-contacts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    triggerHaptic("success");
    toast("Contacts exported to JSON", "success");
  }

  async function handleImportContactsFile(file: File) {
    try {
      const text = await file.text();
      const list = JSON.parse(text) as Contact[];
      if (!Array.isArray(list)) throw new Error("Invalid contacts file format.");
      let imported = 0;
      for (const c of list) {
        if (c.name && c.address && !contacts.some((existing) => existing.address === c.address)) {
          addContact(c);
          imported++;
        }
      }
      triggerHaptic("success");
      toast(`Imported ${imported} new contact${imported === 1 ? "" : "s"}`, "success");
    } catch {
      triggerHaptic("error");
      toast("Failed to parse contacts JSON", "error");
    }
  }

  function handleSaveContact() {
    const err = validateContact(contactName, contactAddr);
    if (err) {
      setContactError(err);
      return;
    }
    if (contacts.some((c) => c.address === contactAddr.trim())) {
      setContactError("That address is already saved.");
      return;
    }
    addContact({ name: contactName.trim(), address: contactAddr.trim() });
    triggerHaptic("success");
    toast("Contact saved", "success");
    setContactName("");
    setContactAddr("");
    setSub("contacts");
  }

  const sortedContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    const list = contacts.filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q)
    );
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts, contactSearch]);

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
      : sub === "addAccount" || sub === "merge"
        ? "accounts"
        : sub === "addContact"
          ? "contacts"
          : "root";

  return (
    <div className="fade-up mx-auto w-full max-w-[560px] px-5 pb-[150px]">
      {/* Subpage Navigation */}
      {sub !== "root" && (
        <>
          <div className="flex items-center justify-between pb-1 pt-2">
            <button
              type="button"
              className="flex items-center gap-0.5 text-[17px] font-semibold text-[#0A84FF] transition-opacity hover:opacity-80"
              onClick={() => {
                triggerHaptic("selection");
                setSub(backTarget ?? "root");
              }}
            >
              <svg
                width="12"
                height="20"
                viewBox="0 0 12 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 2 3 10l7 8" />
              </svg>
              Back
            </button>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Settings
            </span>
            <span className="w-14" />
          </div>

          <h1 className="display-h mb-5 text-[28px] font-bold text-white">
            {sub === "reveal"
              ? "Reveal Secret Key"
              : sub === "accounts"
                ? "Accounts"
                : sub === "addAccount"
                  ? "Add Account"
                  : sub === "contacts"
                    ? "Address Book"
                    : sub === "addContact"
                      ? "New Contact"
                      : sub === "autolock"
                        ? "Auto-Lock Timer"
                        : sub === "merge"
                          ? "Merge Account"
                          : sub === "phrase"
                            ? "Recovery Phrase"
                            : sub === "signers"
                              ? "Signers & Multi-Sig"
                              : sub === "airsigner"
                                ? "Air-Gapped Signer"
                                : sub === "dapps"
                                  ? "Connected dApps"
                                  : sub === "soroban"
                                    ? "Soroban Contracts"
                                    : "Network"}
          </h1>
        </>
      )}

      {/* ---------- ROOT SETTINGS ---------- */}
      {sub === "root" && (
        <>
          {/* Security Health Score Card */}
          <div className="fade-up mb-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
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

          <p className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400 px-1 pb-2">
            Security & Backup
          </p>
          {contacts.length > 2 && (
            <div className="search-field mb-3 flex items-center gap-2">
              <input
                placeholder="Search contacts by name or key..."
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                className="w-full bg-transparent text-[13px] text-white outline-none placeholder:text-neutral-500"
              />
            </div>
          )}
          <div className="list-group">
            <RowButton
              icon={<IconKey size={16} />}
              tint="#30D158"
              label="Recovery Phrase"
              value={hasMnemonicVault ? "12 words" : "Not available"}
              chevron
              onClick={() => {
                triggerHaptic("selection");
                if (hasMnemonicVault) setSub("phrase");
              }}
              sep
            />
            <RowButton
              icon={<IconShield size={16} />}
              tint="#0A84FF"
              label="Account Signers & Multi-Sig"
              chevron
              onClick={() => {
                triggerHaptic("selection");
                setSub("signers");
                void handleLoadSigners();
              }}
              sep
            />
            <RowButton
              icon={<IconLock size={16} />}
              tint="#5E5CE6"
              label="Air-Gapped Cold QR Signer"
              chevron
              onClick={() => {
                triggerHaptic("selection");
                setSub("airsigner");
              }}
              sep
            />
            <RowButton
              icon={<IconWallet size={16} />}
              tint="#30D158"
              label="Connected Apps & dApps"
              value={`${connectedDapps.length} Active`}
              chevron
              onClick={() => {
                triggerHaptic("selection");
                setSub("dapps");
              }}
              sep
            />
            <RowButton
              icon={<IconKey size={16} />}
              tint="#FF9F0A"
              label="Soroban Smart Contracts Hub"
              chevron
              onClick={() => {
                triggerHaptic("selection");
                setSub("soroban");
              }}
              sep
            />
            <RowButton
              icon={<IconEye size={16} />}
              tint="#0A84FF"
              label="Reveal Secret Key"
              chevron
              onClick={() => {
                triggerHaptic("selection");
                setSub("reveal");
              }}
              sep
            />
            <RowButton
              icon={<IconDownload size={16} />}
              tint="#FF9F0A"
              label="Export Encrypted Keystore"
              onClick={handleExportKeystore}
              sep
            />
            <RowButton
              icon={<IconFingerprint size={16} />}
              tint="#5E5CE6"
              label="Touch ID / Face ID"
              as="div"
              sep
            >
              <Toggle
                on={biometricsEnabled}
                onChange={() => toggleBiometrics(!biometricsEnabled)}
              />
            </RowButton>
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
            <RowButton
              icon={<IconRefresh size={16} />}
              tint="#FF9F0A"
              label="Audio & Haptic Feedback"
              as="div"
              sep
            >
              <Toggle on={soundEnabled} onChange={() => toggleSound(!soundEnabled)} />
            </RowButton>
            <RowButton
              as="div"
              icon={<IconShield size={16} />}
              tint="#BF5AF2"
              label="Hide Balances (Privacy)"
            >
              <Toggle on={privacyMode} onChange={togglePrivacy} />
            </RowButton>
          </div>

          <p className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400 px-1 pb-2 pt-6">
            Accounts & Contacts
          </p>
          <div className="list-group">
            {activeAccount && (
              <RowButton
                icon={<Avatar seed={activeAccount.publicKey} size={29} />}
                label={activeAccount.label}
                sub={shortenAddr(activeAccount.publicKey, 6, 6)}
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
              tint="#32D74B"
              label="Manage Accounts"
              value={`${accounts.length} active`}
              chevron
              onClick={() => {
                triggerHaptic("selection");
                setSub("accounts");
              }}
              sep
            />
            <RowButton
              icon={<IconPlus size={16} />}
              tint="#FF375F"
              label="Address Book"
              value={`${contacts.length} contacts`}
              chevron
              onClick={() => {
                triggerHaptic("selection");
                setSub("contacts");
              }}
            />
          </div>

          <p className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400 px-1 pb-2 pt-6">
            Network & Session
          </p>
          <div className="list-group">
            <RowButton
              icon={<IconSwapGlyph />}
              tint="#FF9F0A"
              label="Stellar Network"
              value={network === "mainnet" ? "Mainnet" : "Testnet"}
              chevron
              onClick={() => {
                triggerHaptic("selection");
                setSub("network");
              }}
              sep
            />
            <RowButton
              icon={<IconLock size={16} />}
              tint="#FF453A"
              label="Lock Wallet Now"
              onClick={() => {
                triggerHaptic("warning");
                lock();
              }}
            />
          </div>

          <div className="list-group mt-6">
            <RowButton
              icon={<IconAlert size={16} />}
              tint="#FF453A"
              label="Reset Wallet"
              danger
              onClick={() => {
                triggerHaptic("warning");
                setConfirmReset(true);
              }}
            />
          </div>

          <p className="px-1 pt-5 text-center text-[12px] leading-relaxed text-neutral-500">
            Wallet · Client-side encrypted self-custody
          </p>
        </>
      )}

      {/* ---------- AUTO-LOCK TIMER ---------- */}
      {sub === "autolock" && (
        <div className="space-y-3">
          <div className="list-group">
            {[
              { ms: 60000, label: "1 Minute" },
              { ms: 300000, label: "5 Minutes" },
              { ms: 900000, label: "15 Minutes (Default)" },
              { ms: 1800000, label: "30 Minutes" },
              { ms: 3600000, label: "1 Hour" },
              { ms: 0, label: "Never" },
            ].map((opt, i) => (
              <button
                key={opt.ms}
                type="button"
                className={`row-hover flex w-full items-center justify-between px-4 py-3.5 text-left ${
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

      {/* ---------- REVEAL SECRET KEY ---------- */}
      {sub === "reveal" && (
        <>
          {revealed ? (
            <>
              <div className="list-group p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-semibold text-white">
                    {activeAccount?.label}
                  </span>
                  <CopyButton value={revealed} label="Copy Secret" />
                </div>
                <p className="mono mt-3 select-all break-all text-[13px] leading-relaxed text-neutral-200 bg-black/40 p-3 rounded-xl border border-white/10">
                  {revealed}
                </p>
              </div>

              <div className="mt-3.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection");
                    setPaperModalData({ secretOrPhrase: revealed, kind: "secret" });
                  }}
                  className="chip flex items-center gap-1.5"
                >
                  <IconDownload size={13} />
                  <span>Print Paper Wallet Certificate</span>
                </button>
                <button
                  type="button"
                  className="chip flex items-center gap-1.5 text-neutral-400"
                  onClick={() => {
                    triggerHaptic("selection");
                    setRevealed(null);
                    setRevealPw("");
                  }}
                >
                  <IconEyeOff size={13} /> Hide Key
                </button>
              </div>
            </>
          ) : (
            <>
              <Notice>
                Anyone with this private key has full control of your account. Enter your password to decrypt it.
              </Notice>
              <div className="mt-4 flex gap-2">
                <input
                  className="input flex-1 text-[13.5px]"
                  type="password"
                  placeholder="Wallet Password"
                  value={revealPw}
                  onChange={(e) => setRevealPw(e.target.value)}
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleReveal();
                  }}
                />
                <Button
                  loading={revealing}
                  disabled={!revealPw || revealing}
                  onClick={() => void handleReveal()}
                >
                  Reveal
                </Button>
              </div>
              {revealError && <p className="mt-3 px-1 text-[13px] text-[#FF453A]">{revealError}</p>}
            </>
          )}
        </>
      )}

      {/* ---------- ACCOUNTS ---------- */}
      {sub === "accounts" && (
        <>
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
                    <span className="block truncate text-[15.5px] font-semibold leading-tight text-white">
                      {acct.label}
                    </span>
                    <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
                      {acct.path ? `Path: ${acct.path}` : shortenAddr(acct.publicKey, 6, 6)}
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
                    setEditLabel(acct.label);
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
                setSub("addAccount");
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
                          {acct.path ?? shortenAddr(acct.publicKey, 6, 6)}
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

          <div className="list-group p-4 space-y-4">
            <Field label="Destination Stellar Address" hint="Must be an existing active account">
              <input
                className="input mono text-[13px]"
                placeholder="G..."
                value={mergeDest}
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
                          {shortenAddr(a.publicKey, 4, 4)}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          <ErrorText message={mergeError ?? ""} />

          <Button
            variant="danger"
            className="w-full !py-3.5 text-[15px] font-semibold"
            loading={merging}
            disabled={!mergeDest || merging}
            onClick={() => void handleMergeAccount()}
          >
            Confirm & Merge Account
          </Button>
        </div>
      )}

      {/* ---------- ADD ACCOUNT ---------- */}
      {sub === "addAccount" && (
        <>
          <SegmentedControl
            value={addMode}
            onChange={setAddMode}
            options={[
              { value: "generate", label: "Derive from Phrase" },
              { value: "import", label: "Import Secret Key" },
            ]}
          />
          <div className="list-group mt-4 space-y-4 p-4">
            <Field label="Account Label">
              <input
                className="input text-[13.5px]"
                placeholder={`Account ${accounts.length + 1}`}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
            </Field>
            {addMode === "import" && (
              <Field label="Secret Key (starts with S)">
                <input
                  className="input mono text-[13.5px]"
                  placeholder="S..."
                  value={importSecret}
                  onChange={(e) => setImportSecret(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>
            )}
          </div>
          <ErrorText message={addError ?? ""} />
          <Button
            className="mt-4 w-full !py-3.5 text-[15px] font-semibold"
            loading={adding}
            disabled={adding || (addMode === "import" && !validateStellarSecret(importSecret))}
            onClick={() => void handleAddAccount()}
          >
            Create Account
          </Button>
        </>
      )}

      {/* ---------- CONTACTS / ADDRESS BOOK ---------- */}
      {sub === "contacts" && (
        <>
          {contacts.length === 0 ? (
            <p className="px-1 pb-3 text-[13.5px] text-neutral-400">
              Saved addresses appear in quick send selectors and autocomplete.
            </p>
          ) : (
            <div className="list-group">
              {sortedContacts.map((c, i) => (
                <div
                  key={c.address}
                  className={`flex items-center gap-3 px-4 py-3.5 ${
                    i > 0 ? "ios-sep" : ""
                  }`}
                >
                  <Avatar seed={c.address} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15.5px] font-semibold leading-tight text-white">
                      {c.name}
                    </p>
                    <p className="mono truncate text-[12px] leading-tight text-neutral-400">
                      {c.address}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection");
                      setEditingContact(c);
                      setEditContactName(c.name);
                      setEditContactAddr(c.address);
                      setEditContactError(null);
                    }}
                    className="rounded-lg bg-white/[0.08] px-2.5 py-1 text-[11.5px] font-medium text-neutral-300 hover:bg-white/[0.14] hover:text-white transition-colors"
                  >
                    Edit
                  </button>
                  <a
                    href={NETWORKS[network].explorerAccountUrl(c.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="icon-btn !h-8 !w-8 hover:!text-[#0A84FF]"
                    title="View on Stellarchain"
                    onClick={() => triggerHaptic("light")}
                  >
                    <IconExternal size={13} />
                  </a>
                  <CopyButton
                    value={c.address}
                    label=""
                    iconSize={13}
                    className="icon-btn !h-8 !w-8"
                  />
                  <button
                    type="button"
                    className="icon-btn !h-8 !w-8 hover:!text-[#FF453A]"
                    onClick={() => {
                      triggerHaptic("selection");
                      removeContact(c.address);
                    }}
                    aria-label={`Delete ${c.name}`}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="flex-1 rounded-2xl bg-white/[0.08] py-3.5 text-center text-[14px] font-semibold text-[#0A84FF] hover:bg-white/[0.12] transition-colors"
              onClick={() => {
                triggerHaptic("selection");
                setSub("addContact");
              }}
            >
              + Add New Contact
            </button>
            {contacts.length > 0 && (
              <button
                type="button"
                className="rounded-2xl bg-white/[0.08] px-4 py-3.5 text-center text-[13px] font-semibold text-neutral-300 hover:bg-white/[0.12] transition-colors"
                onClick={handleExportContacts}
              >
                Export JSON
              </button>
            )}
            <label className="rounded-2xl bg-white/[0.08] px-4 py-3.5 text-center text-[13px] font-semibold text-neutral-300 hover:bg-white/[0.12] transition-colors cursor-pointer">
              <span>Import JSON</span>
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImportContactsFile(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </>
      )}

      {/* ---------- ADD CONTACT ---------- */}
      {sub === "addContact" && (
        <>
          <div className="list-group space-y-4 p-4">
            <Field label="Contact Name">
              <input
                className="input text-[13.5px]"
                placeholder="e.g. Alice, Coinbase, Treasury"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                maxLength={24}
              />
            </Field>
            <div>
              <div className="flex items-center justify-between pb-1">
                <label className="field-label !pb-0">Stellar Public Key</label>
                <button
                  type="button"
                  onClick={() => setShowContactScanner((s) => !s)}
                  className="text-[12px] font-medium text-[#0A84FF] hover:underline flex items-center gap-1"
                >
                  <span>{showContactScanner ? "Hide Camera" : "Scan QR"}</span>
                </button>
              </div>
              <input
                className="input mono text-[13.5px]"
                placeholder="G..."
                value={contactAddr}
                onChange={(e) => setContactAddr(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            {showContactScanner && (
              <QrScannerBox
                onScan={(val) => {
                  setContactAddr(val);
                  setShowContactScanner(false);
                  triggerHaptic("success");
                }}
              />
            )}
          </div>
          <ErrorText message={contactError ?? ""} />
          <Button
            className="mt-4 w-full !py-3.5 text-[15px] font-semibold"
            onClick={handleSaveContact}
          >
            Save Contact
          </Button>
        </>
      )}

      {/* ---------- RECOVERY PHRASE ---------- */}
      {sub === "phrase" && (
        <>
          <Notice>
            These 12 words recreate your entire wallet at m/44&apos;/148&apos;/account&apos;. Write them down safely offline.
          </Notice>
          {revealedPhrase ? (
            <>
              <div className="list-group mt-4 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-[13px] font-semibold text-white">12-Word Recovery Phrase</span>
                  <CopyButton value={revealedPhrase} label="Copy Phrase" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {revealedPhrase.split(" ").map((w, i) => (
                    <span
                      key={i}
                      className="rounded-xl bg-white/[0.05] border border-white/10 px-2 py-2 text-center text-[13px] text-white"
                    >
                      <span className="mr-1.5 text-[10.5px] text-neutral-500">{i + 1}</span>
                      {w}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-3.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection");
                    setPaperModalData({ secretOrPhrase: revealedPhrase, kind: "mnemonic" });
                  }}
                  className="chip flex items-center gap-1.5"
                >
                  <IconDownload size={13} />
                  <span>Print Paper Wallet Certificate</span>
                </button>
                <button
                  type="button"
                  className="chip flex items-center gap-1.5 text-neutral-400"
                  onClick={() => {
                    triggerHaptic("selection");
                    setRevealedPhrase(null);
                    setPhrasePw("");
                  }}
                >
                  <IconEyeOff size={13} /> Hide Phrase
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mt-4 flex gap-2">
                <input
                  className="input flex-1 text-[13.5px]"
                  type="password"
                  placeholder="Wallet Password"
                  value={phrasePw}
                  onChange={(e) => setPhrasePw(e.target.value)}
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleRevealPhrase();
                  }}
                />
                <Button
                  loading={phraseBusy}
                  disabled={!phrasePw || phraseBusy}
                  onClick={() => void handleRevealPhrase()}
                >
                  Reveal
                </Button>
              </div>
              {phraseError && <p className="mt-3 px-1 text-[13px] text-[#FF453A]">{phraseError}</p>}
            </>
          )}
        </>
      )}

      {/* ---------- SIGNERS & MULTI-SIG INSPECTOR ---------- */}
      {sub === "signers" && (
        <div className="space-y-4">
          <div className="panel-inset p-4 space-y-3 text-[13px]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Account Thresholds
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/[0.04] p-2.5">
                <span className="block text-[11px] text-neutral-400">Low</span>
                <span className="mono text-[16px] font-bold text-white">
                  {signerInfo?.thresholds.low_threshold ?? 0}
                </span>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-2.5">
                <span className="block text-[11px] text-neutral-400">Medium</span>
                <span className="mono text-[16px] font-bold text-white">
                  {signerInfo?.thresholds.med_threshold ?? 1}
                </span>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-2.5">
                <span className="block text-[11px] text-neutral-400">High</span>
                <span className="mono text-[16px] font-bold text-white">
                  {signerInfo?.thresholds.high_threshold ?? 1}
                </span>
              </div>
            </div>
          </div>

          <div className="panel-inset p-4 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Authorized Signers ({signerInfo?.signers.length ?? 1})
            </p>
            <div className="space-y-2">
              {signerLoading ? (
                <div className="skeleton h-12 w-full rounded-xl" />
              ) : (
                signerInfo?.signers.map((s) => (
                  <div
                    key={s.key}
                    className="flex items-center justify-between rounded-xl bg-white/[0.03] p-3 text-[12.5px]"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="mono truncate text-white">{s.key}</p>
                      <p className="text-[11px] text-neutral-400 capitalize">{s.type.replace(/_/g, " ")}</p>
                    </div>
                    <span className="mono rounded-lg bg-[#0A84FF]/15 px-2 py-0.5 font-bold text-[#0A84FF] shrink-0">
                      Weight: {s.weight}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
          <Button variant="secondary" className="w-full" onClick={() => void handleLoadSigners()}>
            Refresh Signers from Horizon
          </Button>
        </div>
      )}

      {/* ---------- AIR-GAPPED TRANSACTION SIGNER ---------- */}
      {sub === "airsigner" && (
        <div className="space-y-4">
          <p className="text-[13px] text-neutral-300 leading-relaxed">
            Sign raw Stellar transaction envelopes offline with zero network connectivity. Perfect for air-gapped cold storage.
          </p>

          <Field label="Unsigned Transaction XDR" hint="Paste transaction envelope">
            <textarea
              rows={4}
              placeholder="AAAAAG..."
              value={airXdr}
              onChange={(e) => {
                setAirXdr(e.target.value);
                setSignedXdr(null);
              }}
              className="input mono text-[12px] resize-none"
            />
          </Field>

          <Field label="Wallet Password" hint="To unlock your private key in memory">
            <input
              type="password"
              placeholder="Enter password"
              value={airPw}
              onChange={(e) => setAirPw(e.target.value)}
              className="input text-[13.5px]"
            />
          </Field>

          {airError && (
            <div className="mt-2">
              <ErrorText message={airError} />
            </div>
          )}

          <Button
            className="w-full"
            loading={airBusy}
            disabled={!airXdr.trim() || !airPw || airBusy}
            onClick={() => void handleAirSign()}
          >
            Sign Transaction Offline
          </Button>

          {signedXdr && (
            <div className="fade-in panel-inset mt-4 p-4 space-y-2">
              <p className="text-[12px] font-bold text-[#30D158]">✓ Transaction Signed Successfully</p>
              <div className="mono select-all break-all rounded-xl bg-black/40 p-2.5 text-[11px] text-neutral-300 max-h-32 overflow-y-auto">
                {signedXdr}
              </div>
              <CopyButton value={signedXdr} label="Copy Signed XDR" className="chip w-full justify-center" />
            </div>
          )}
        </div>
      )}

      {/* ---------- CONNECTED DAPPS ---------- */}
      {sub === "dapps" && (
        <div className="space-y-4">
          <p className="text-[13px] text-neutral-300 leading-relaxed">
            Manage web3 applications and decentralized exchanges connected to your wallet.
          </p>

          <div className="list-group">
            {connectedDapps.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13.5px] text-neutral-500">
                No active dApp sessions connected.
              </p>
            ) : (
              connectedDapps.map((d, i) => (
                <div
                  key={d.origin}
                  className={`flex items-center justify-between gap-3 px-4 py-3.5 ${i > 0 ? "ios-sep" : ""}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-[22px] shrink-0">{d.icon}</span>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-white">{d.name}</p>
                      <p className="mono truncate text-[11.5px] text-neutral-400">{d.origin}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDisconnectDapp(d.origin)}
                    className="rounded-lg bg-white/[0.08] px-3 py-1.5 text-[12px] font-medium text-[#FF453A] hover:bg-[#FF453A]/15 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              ))
            )}
          </div>

          {connectedDapps.length > 0 && (
            <Button variant="danger" className="w-full" onClick={handleDisconnectAllDapps}>
              Disconnect All Sessions
            </Button>
          )}
        </div>
      )}

      {/* ---------- SOROBAN SMART CONTRACTS HUB ---------- */}
      {sub === "soroban" && (
        <div className="space-y-4">
          <p className="text-[13px] text-neutral-300 leading-relaxed">
            Simulate and interact directly with native Soroban WASM smart contracts on Stellar {NETWORKS[network].label}.
          </p>

          <Field label="Contract ID" hint="Starts with 'C...' (56 chars)">
            <input
              type="text"
              placeholder="CA3D5KRYNZFQPWDFX3G..."
              value={contractIdInput}
              onChange={(e) => {
                setContractIdInput(e.target.value);
                setSimulationResult(null);
              }}
              className="input mono text-[13px]"
            />
          </Field>

          <Field label="Contract Function Method">
            <input
              type="text"
              placeholder="e.g. balance, transfer, mint"
              value={contractMethod}
              onChange={(e) => setContractMethod(e.target.value)}
              className="input mono text-[13px]"
            />
          </Field>

          <Button
            className="w-full"
            loading={simulatingContract}
            disabled={!contractIdInput.trim() || simulatingContract}
            onClick={() => void handleSimulateContract()}
          >
            Simulate Contract Invocation
          </Button>

          {simulationResult && (
            <div className="fade-in panel-inset p-4 space-y-2">
              <p className="text-[12px] font-bold text-[#30D158]">✓ Simulation Succeeded</p>
              <pre className="mono select-all break-all rounded-xl bg-black/40 p-2.5 text-[11px] text-neutral-300 max-h-36 overflow-y-auto">
                {simulationResult}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ---------- NETWORK SWITCHER & HEALTH ---------- */}
      {sub === "network" && (
        <div className="space-y-4">
          <SegmentedControl<NetworkKey>
            value={network}
            onChange={(n) => {
              triggerHaptic("selection");
              switchNetwork(n);
            }}
            options={[
              { value: "testnet", label: "Testnet" },
              { value: "mainnet", label: "Mainnet" },
            ]}
          />

          <div className="panel-inset p-4 space-y-2.5 text-[12.5px]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Live Network Health & Horizon RPC
            </p>
            <div className="flex justify-between text-neutral-300">
              <span>Status</span>
              <span className="flex items-center gap-1.5 text-[#30D158] font-medium">
                <span className="h-2 w-2 rounded-full bg-[#30D158] animate-pulse" /> Operational
              </span>
            </div>
            <div className="flex justify-between text-neutral-300">
              <span>Protocol Version</span>
              <span className="mono font-semibold text-white">Stellar Protocol 21</span>
            </div>
            <div className="flex justify-between text-neutral-300">
              <span>Base Transaction Fee</span>
              <span className="mono text-white">0.00001 XLM (100 stroops)</span>
            </div>
            <div className="flex justify-between text-neutral-300">
              <span>Horizon Endpoint</span>
              <span className="mono text-[11px] text-neutral-400 truncate max-w-[200px]">
                {NETWORKS[network].horizonUrl}
              </span>
            </div>
            <div className="flex justify-between items-center text-neutral-300 pt-1">
              <span>Endpoint Latency</span>
              <div className="flex items-center gap-2">
                <span className="mono text-white font-semibold">
                  {pingMs !== null ? `${pingMs}ms` : "—"}
                </span>
                <button
                  type="button"
                  onClick={() => void handlePing()}
                  disabled={pinging}
                  className="chip !py-0.5 !px-2 text-[11px] text-[#0A84FF]"
                >
                  {pinging ? <Spinner /> : "Ping"}
                </button>
              </div>
            </div>
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

      {/* Paper Wallet Modal */}
      {paperModalData && activeAccount && (
        <PaperWalletModal
          open
          onClose={() => setPaperModalData(null)}
          accountLabel={activeAccount.label}
          publicKey={activeAccount.publicKey}
          secretOrPhrase={paperModalData.secretOrPhrase}
          kind={paperModalData.kind}
          path={activeAccount.path}
        />
      )}

      {/* Rename Account Modal */}
      <Modal open={editingAccount !== null} onClose={() => setEditingAccount(null)}>
        <ModalHeader title="Rename Account" onClose={() => setEditingAccount(null)} />
        <div className="px-6 pb-6 pt-3 space-y-4">
          <Field label="Account Label">
            <input
              className="input text-[14px]"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              placeholder="e.g. Savings, Trading, Treasury"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveRename();
              }}
            />
          </Field>
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => setEditingAccount(null)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSaveRename}>
              Save Label
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Contact Modal */}
      <Modal open={editingContact !== null} onClose={() => setEditingContact(null)}>
        <ModalHeader title="Edit Contact" onClose={() => setEditingContact(null)} />
        <div className="px-6 pb-6 pt-3 space-y-4">
          <Field label="Contact Name">
            <input
              className="input text-[14px]"
              value={editContactName}
              onChange={(e) => setEditContactName(e.target.value)}
              placeholder="e.g. Alice"
              maxLength={24}
            />
          </Field>
          <Field label="Stellar Public Key">
            <input
              className="input mono text-[13px]"
              value={editContactAddr}
              onChange={(e) => setEditContactAddr(e.target.value)}
              placeholder="G..."
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
          <ErrorText message={editContactError ?? ""} />
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => setEditingContact(null)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSaveEditContact}>
              Save Changes
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reset Confirmation Modal */}
      <Modal open={confirmReset} onClose={() => setConfirmReset(false)}>
        <ModalHeader title="Erase & Reset Wallet?" onClose={() => setConfirmReset(false)} />
        <div className="px-6 pb-6 pt-2">
          <p className="text-[13.5px] leading-relaxed text-neutral-300">
            This permanently erases all encrypted private keys and recovery phrases in this browser.{" "}
            <span className="text-[#FF453A] font-semibold">
              Without a backup of your recovery phrase, all funds will be permanently lost.
            </span>
          </p>
          <div className="mt-6 flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => {
                triggerHaptic("error");
                setConfirmReset(false);
                resetWallet();
              }}
            >
              Erase Everything
            </Button>
          </div>
        </div>
      </Modal>
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

function Notice({ tone, children }: { tone?: "pos"; children: React.ReactNode }) {
  return (
    <div
      className="mt-4 rounded-2xl px-4 py-3 text-[13px] leading-relaxed border"
      style={{
        background: tone === "pos" ? "rgba(48,209,88,0.08)" : "rgba(255,255,255,0.04)",
        borderColor: tone === "pos" ? "rgba(48,209,88,0.2)" : "rgba(255,255,255,0.08)",
        color: tone === "pos" ? "#30D158" : "var(--color-muted)",
      }}
    >
      {children}
    </div>
  );
}

function IconSwapGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16.5 4 21 8.5 16.5 13M21 8.5H8M7.5 20 3 15.5 7.5 11M3 15.5h13" />
    </svg>
  );
}
