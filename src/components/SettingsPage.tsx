"use client";

import { useRef, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import {
  exportKeystoreUnlocked,
  importKeystore,
  revealSecret,
  validateStellarSecret,
  hasMnemonic as hasMnemonicAlias,
} from "@/lib/vault";
import { validateContact } from "@/lib/contacts";
import type { NetworkKey } from "@/lib/stellar";
import { stellarAccountPath } from "@/lib/hd";
import { shortenAddr } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { useToast } from "./Toast";
import {
  Avatar,
  Button,
  CopyButton,
  ErrorText,
  Field,
  Modal,
  ModalHeader,
  SegmentedControl,
  Toggle,
} from "./ui";
import {
  IconAlert,
  IconCheck,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconFingerprint,
  IconLock,
  IconPlus,
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
  | "autolock";
type Sub = SettingsSub;

export function SettingsPage({ initialSub = "root" }: { initialSub?: Sub }) {
  const {
    network,
    switchNetwork,
    accounts,
    activeAccount,
    selectAccount,
    addAccount,
    removeAccount,
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

  const [addMode, setAddMode] = useState<"generate" | "import">("generate");
  const [newLabel, setNewLabel] = useState("");
  const [importSecret, setImportSecret] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [keystoreJson, setKeystoreJson] = useState<string | null>(null);
  const [ksPassword, setKsPassword] = useState("");
  const [ksError, setKsError] = useState<string | null>(null);
  const [ksBusy, setKsBusy] = useState(false);

  const [contactName, setContactName] = useState("");
  const [contactAddr, setContactAddr] = useState("");
  const [contactError, setContactError] = useState<string | null>(null);

  const [confirmReset, setConfirmReset] = useState(false);
  const [phrasePw, setPhrasePw] = useState("");
  const [revealedPhrase, setRevealedPhrase] = useState<string | null>(null);
  const [phraseError, setPhraseError] = useState<string | null>(null);
  const [phraseBusy, setPhraseBusy] = useState(false);
  const hasMnemonicVault = hasMnemonicAlias();

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

  async function handleExportKeystore() {
    if (!activeAccount) return;
    const json = await exportKeystoreUnlocked(activeAccount.id);
    if (!json) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `polaris-${activeAccount.label.toLowerCase().replace(/\s+/g, "-")}-keystore.json`;
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
      : sub === "addAccount"
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
                        : sub === "phrase"
                          ? "Recovery Phrase"
                          : "Network"}
          </h1>
        </>
      )}

      {/* ---------- ROOT SETTINGS ---------- */}
      {sub === "root" && (
        <>
          <p className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400 px-1 pb-2">
            Security & Backup
          </p>
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
            Polaris Stellar Wallet · Client-side encrypted self-custody
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
              <button
                type="button"
                className="mt-4 flex items-center gap-1.5 px-1 text-[14px] font-semibold text-[#0A84FF]"
                onClick={() => {
                  triggerHaptic("selection");
                  setRevealed(null);
                  setRevealPw("");
                }}
              >
                <IconEyeOff size={14} /> Hide Secret Key
              </button>
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
              <button
                key={acct.id}
                type="button"
                className={`row-hover flex w-full items-center gap-3.5 px-4 py-3.5 text-left ${
                  i > 0 ? "ios-sep" : ""
                }`}
                onClick={() => {
                  triggerHaptic("selection");
                  selectAccount(acct.id);
                }}
              >
                <Avatar seed={acct.publicKey} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15.5px] font-semibold leading-tight text-white">
                    {acct.label}
                  </span>
                  <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
                    {acct.path ?? shortenAddr(acct.publicKey, 6, 6)}
                  </span>
                </span>
                {acct.id === activeAccount?.id && (
                  <IconCheck size={18} className="text-[#0A84FF]" />
                )}
              </button>
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
          </div>

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
            <div className="list-group mt-6">
              <RowButton
                icon={<IconTrash size={15} />}
                tint="#FF453A"
                label={`Remove "${activeAccount?.label ?? ""}"`}
                danger
                onClick={() => {
                  triggerHaptic("warning");
                  if (activeAccount) removeAccount(activeAccount.id);
                }}
              />
            </div>
          )}
        </>
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
              {contacts.map((c, i) => (
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
          <button
            type="button"
            className="mt-3 w-full rounded-2xl bg-white/[0.08] py-3.5 text-center text-[15px] font-semibold text-[#0A84FF] hover:bg-white/[0.12] transition-colors"
            onClick={() => {
              triggerHaptic("selection");
              setSub("addContact");
            }}
          >
            + Add New Contact
          </button>
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
            <Field label="Stellar Public Key">
              <input
                className="input mono text-[13.5px]"
                placeholder="G..."
                value={contactAddr}
                onChange={(e) => setContactAddr(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
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
                      <span className="mr-1.5 text-[11px] text-neutral-500">{i + 1}</span>
                      {w}
                    </span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="mt-4 flex items-center gap-1.5 px-1 text-[14px] font-semibold text-[#0A84FF]"
                onClick={() => {
                  triggerHaptic("selection");
                  setRevealedPhrase(null);
                  setPhrasePw("");
                }}
              >
                <IconEyeOff size={14} /> Hide Recovery Phrase
              </button>
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

      {/* ---------- NETWORK SWITCHER ---------- */}
      {sub === "network" && (
        <>
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
          {network === "mainnet" ? (
            <Notice tone="pos">
              You are connected to Stellar Mainnet. Transactions involve real assets and fees.
            </Notice>
          ) : (
            <Notice>
              Testnet lumens are free and funded by SDF Friendbot for development and testing.
            </Notice>
          )}
        </>
      )}

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
