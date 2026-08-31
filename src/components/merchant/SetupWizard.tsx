"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchBalances } from "@/lib/api";
import { POPULAR_ASSETS } from "@/lib/assets";
import {
  useMerchantConfiguration,
  useMerchantStatus,
} from "@/hooks/useMerchant";
import { useWalletIdentity, useWalletTransactions } from "@/hooks/useWallet";
import { formatTrezorAddress } from "@/lib/address-display";
import { FIAT_SYMBOLS, type FiatCurrency } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { assetKey, isNative, referencePrefix, uniqueAssets } from "@/lib/merchant/charge";
import { DEFAULT_CATALOGUE, DEFAULT_TAX_RATES } from "@/lib/merchant/defaults";
import { fmtMinor } from "@/lib/merchant/money";
import type { NetworkKey } from "@/lib/stellar";
import type {
  AcceptedAsset,
  MerchantProfile,
  MerchantSettings,
  TaxMode,
  TillTextSize,
  TipMode,
} from "@/lib/merchant/types";
import { useToast } from "../Toast";
import {
  Button,
  Modal,
  ModalHeader,
  Notice,
  SegmentedControl,
  Select,
  Toggle,
  type SelectOption,
} from "../ui";
import { IconAlert, IconCheck, IconKey, IconLock, IconPlus } from "../icons";
import {
  IconClock,
  IconInfo,
  IconPercent,
  IconReceipt,
  IconStorefront,
  IconTerminal,
} from "./icons";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const CURRENCIES: FiatCurrency[] = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"];

const EXPIRY_OPTIONS = [
  { seconds: 300, label: "5 minutes" },
  { seconds: 600, label: "10 minutes" },
  { seconds: 900, label: "15 minutes" },
  { seconds: 1800, label: "30 minutes" },
];

const NATIVE_XLM: AcceptedAsset = { code: "XLM", issuer: null };
const EMPTY_ACCOUNT_BALANCES: Awaited<ReturnType<typeof fetchBalances>> = [];
const PREVIEW_LINES = DEFAULT_CATALOGUE.slice(1, 3).map((item) => ({
  quantity: 1,
  name: item.name,
  unitPriceMinor: item.priceMinor,
}));
const PREVIEW_TOTAL_MINOR = PREVIEW_LINES.reduce(
  (total, line) => total + line.quantity * line.unitPriceMinor,
  0,
);

const STEPS = [
  { n: 1, title: "The shop", blurb: "What goes on the receipt" },
  { n: 2, title: "Money", blurb: "Where payments land" },
  { n: 3, title: "How you sell", blurb: "Tax, tips and the clock" },
  { n: 4, title: "The till", blurb: "This device" },
] as const;

const TEXT_SIZE_LABEL: Record<TillTextSize, string> = {
  standard: "Standard",
  large: "Large",
  xlarge: "Extra Large",
};

/** The till total, at each size. No Dynamic Type on the web, so the app carries it. */
const TEXT_SIZE_TOTAL: Record<TillTextSize, string> = {
  standard: "text-[28px]",
  large: "text-[34px]",
  xlarge: "text-[44px]",
};

/* ------------------------------------------------------------------ */
/* Draft                                                               */
/* ------------------------------------------------------------------ */

interface RateDraft {
  id: string;
  label: string;
  /** Kept as typed text so a half-entered "1" is not read as 1 %. */
  percentText: string;
}

interface Draft {
  profile: MerchantProfile;
  currency: FiatCurrency;
  receivingPublicKey: string;
  settlementKey: string;
  acceptedKeys: string[];
  taxMode: TaxMode;
  rates: RateDraft[];
  tipMode: TipMode;
  tipPercentsText: string;
  chargeExpirySeconds: number;
  terminalName: string;
  pin: string;
  pinConfirm: string;
  textSize: TillTextSize;
}

function recommendedAssets(network: NetworkKey): AcceptedAsset[] {
  const usdc = POPULAR_ASSETS.find((asset) => asset.code === "USDC");
  const issuer = network === "mainnet" ? usdc?.mainnetIssuer : usdc?.testnetIssuer;
  return issuer ? [NATIVE_XLM, { code: "USDC", issuer }] : [NATIVE_XLM];
}

function initialDraft(
  settings: MerchantSettings,
  network: NetworkKey,
  receivingPublicKey: string,
  textSize: TillTextSize,
): Draft {
  const configured = Boolean(settings.profile.name.trim() || settings.receivingPublicKey);
  const acceptedAssets = configured ? settings.acceptedAssets : recommendedAssets(network);
  const settlementAsset = configured
    ? settings.settlementAsset
    : (acceptedAssets.find((asset) => asset.code === "USDC") ?? acceptedAssets[0]);
  return {
    profile: configured
      ? settings.profile
      : { name: "", addressLines: [], taxId: "", receiptFooter: "" },
    currency: configured ? settings.currency : "EUR",
    receivingPublicKey: settings.receivingPublicKey ?? receivingPublicKey,
    settlementKey: assetKey(settlementAsset),
    acceptedKeys: acceptedAssets.map(assetKey),
    taxMode: settings.taxMode,
    rates: (settings.taxRates.length > 0 ? settings.taxRates : DEFAULT_TAX_RATES).map((rate) => ({
      id: rate.id,
      label: rate.label,
      percentText: String(rate.percent),
    })),
    tipMode: settings.tips.mode,
    tipPercentsText: settings.tips.percents.join(", ") || "10, 15, 20",
    chargeExpirySeconds: settings.chargeExpirySeconds,
    terminalName: configured ? settings.terminalName : "Front counter",
    pin: "",
    pinConfirm: "",
    textSize,
  };
}

function parsePercent(text: string): number | null {
  const value = Number.parseFloat(text.trim().replace(",", "."));
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

function parsePercentList(text: string): number[] | null {
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const values = parts.map(parsePercent);
  return values.every((value): value is number => value !== null && value > 0) ? values : null;
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function StepLabel({ children }: { children: React.ReactNode }) {
  return <p className="field-label">{children}</p>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">{children}</p>;
}

function Problem({ message }: { message: string }) {
  return (
    <p role="alert" className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-[#FF9F0A]">
      <IconAlert size={13} className="mt-[2px] shrink-0" />
      <span>{message}</span>
    </p>
  );
}

/** A boxed sub-section inside a step: heading, then whatever the step needs. */
function Block({
  icon,
  tint,
  title,
  children,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-4">
      <div className="flex items-center gap-2.5 pb-3">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
          style={{ background: tint }}
        >
          {icon}
        </span>
        <h3 className="text-[15px] font-semibold text-white">{title}</h3>
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The wizard                                                          */
/* ------------------------------------------------------------------ */

export function SetupWizard({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  onComplete?: () => void;
}) {
  if (!open) return null;
  return <SetupWizardInner onClose={onClose} onComplete={onComplete} />;
}

function SetupWizardInner({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete?: () => void;
}) {
  const { accounts, activeAccount, network } = useWalletIdentity();
  const { trustAsset, refresh } = useWalletTransactions();
  const { settings, tillTextSize } = useMerchantConfiguration();
  const { completeSetup } = useMerchantStatus();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [showProblems, setShowProblems] = useState(false);
  const [draft, setDraft] = useState<Draft>(() =>
    initialDraft(settings, network, activeAccount?.publicKey ?? accounts[0]?.publicKey ?? "", tillTextSize),
  );
  const [balanceState, setBalanceState] = useState<{
    publicKey: string;
    network: NetworkKey;
    balances: Awaited<ReturnType<typeof fetchBalances>>;
    error: string | null;
  } | null>(null);
  const [balanceRefresh, setBalanceRefresh] = useState(0);
  const [trustingKey, setTrustingKey] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function patch(next: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  /* ---------------- assets ---------------- */

  const receivingBalances = !draft.receivingPublicKey
    ? EMPTY_ACCOUNT_BALANCES
    : balanceState?.publicKey === draft.receivingPublicKey && balanceState.network === network
      ? balanceState.balances
      : null;
  const balanceError =
    balanceState?.publicKey === draft.receivingPublicKey && balanceState.network === network
      ? balanceState.error
      : null;

  useEffect(() => {
    if (!draft.receivingPublicKey) return;
    let alive = true;
    void fetchBalances(draft.receivingPublicKey, network)
      .then((next) => {
        if (alive) {
          setBalanceState({
            publicKey: draft.receivingPublicKey,
            network,
            balances: next,
            error: null,
          });
        }
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setBalanceState({
          publicKey: draft.receivingPublicKey,
          network,
          balances: [],
          error:
            error instanceof Error ? error.message : "The receiving account could not be checked.",
        });
      });
    return () => {
      alive = false;
    };
  }, [balanceRefresh, draft.receivingPublicKey, network]);

  /** Network-correct XLM/USDC, configured assets, and held assets are offered. */
  const assetChoices = useMemo(() => {
    const list: AcceptedAsset[] = [...recommendedAssets(network), ...settings.acceptedAssets];
    for (const balance of receivingBalances ?? []) {
      if (balance.isNative || balance.issuer === null) continue;
      const asset: AcceptedAsset = { code: balance.code, issuer: balance.issuer };
      list.push(asset);
    }
    return uniqueAssets(list);
  }, [network, receivingBalances, settings.acceptedAssets]);

  /** Trustlines this wallet already holds, by asset key. */
  const heldKeys = useMemo(() => {
    const held = new Set<string>();
    for (const balance of receivingBalances ?? []) {
      if (balance.isNative || balance.issuer === null) continue;
      held.add(assetKey({ code: balance.code, issuer: balance.issuer }));
    }
    return held;
  }, [receivingBalances]);

  const accepted = assetChoices.filter((asset) => draft.acceptedKeys.includes(assetKey(asset)));
  const missingTrustlines = accepted.filter(
    (asset) => !isNative(asset) && !heldKeys.has(assetKey(asset)),
  );
  const receivingAccountActive = Boolean(
    receivingBalances?.some((balance) => balance.isNative),
  );

  const accountOptions: SelectOption[] = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.publicKey,
        label: account.watchOnly ? `${account.label} · watch-only` : account.label,
        sublabel: formatTrezorAddress(account.publicKey),
      })),
    [accounts],
  );

  const receivingAccount = accounts.find(
    (account) => account.publicKey === draft.receivingPublicKey,
  );

  /* ---------------- validation ---------------- */

  const rateProblem = draft.rates.some((rate) => parsePercent(rate.percentText) === null)
    ? "Every rate needs a percentage between 0 and 100."
    : null;
  const tipProblem =
    draft.tipMode === "percent" && parsePercentList(draft.tipPercentsText) === null
      ? "Give at least one percentage above zero, such as 10, 15, 20."
      : null;
  const pinDigits = /^\d{4,6}$/.test(draft.pin);

  const problems: Record<number, string | null> = {
    1: !draft.profile.name.trim()
      ? "The shop needs a name: it prints on every receipt and seeds every charge memo."
      : null,
    2: !draft.receivingPublicKey
      ? "Choose the account every charge is addressed to."
      : draft.acceptedKeys.length === 0
        ? "A charge needs at least one accepted asset."
        : !draft.acceptedKeys.includes(draft.settlementKey)
          ? "The settlement asset has to be one you accept."
          : receivingBalances === null
            ? "Wait while the receiving account is checked on Stellar."
            : balanceError
              ? "The receiving account could not be checked. Retry before opening the till."
              : !receivingAccountActive
                ? "The receiving account is not active on this Stellar network yet."
                : missingTrustlines.length > 0
                  ? `Add ${missingTrustlines.length === 1 ? "the missing trustline" : "all missing trustlines"} before opening the till.`
                  : null,
    3: rateProblem ?? tipProblem,
    4: !draft.terminalName.trim()
      ? "Name this device so its orders can be told from the other tills."
      : !pinDigits
        ? "A staff PIN is 4 to 6 digits."
        : draft.pin !== draft.pinConfirm
          ? "The two PINs do not match."
          : null,
  };

  const problem = problems[step] ?? null;

  function goNext() {
    if (problem) {
      setShowProblems(true);
      triggerHaptic("warning");
      return;
    }
    triggerHaptic("selection");
    setShowProblems(false);
    setStep((current) => Math.min(4, current + 1));
  }

  function goBack() {
    triggerHaptic("selection");
    setShowProblems(false);
    setStep((current) => Math.max(1, current - 1));
  }

  async function finish() {
    if (problem) {
      setShowProblems(true);
      triggerHaptic("warning");
      return;
    }
    const settlementAsset = assetChoices.find(
      (asset) => assetKey(asset) === draft.settlementKey,
    );
    const taxRates = draft.rates.map((rate) => ({
      id: rate.id,
      label: rate.label,
      percent: parsePercent(rate.percentText) as number,
    }));
    if (!settlementAsset) {
      setWorkflowError("Choose a valid settlement asset.");
      return;
    }
    setSaving(true);
    setWorkflowError(null);
    try {
      await completeSetup({
        profile: draft.profile,
        receivingPublicKey: draft.receivingPublicKey,
        settlementAsset,
        acceptedAssets: accepted,
        currency: draft.currency,
        taxMode: draft.taxMode,
        taxRates,
        tips: {
          ...settings.tips,
          mode: draft.tipMode,
          percents: parsePercentList(draft.tipPercentsText) ?? settings.tips.percents,
        },
        chargeExpirySeconds: draft.chargeExpirySeconds,
        terminalName: draft.terminalName,
        textSize: draft.textSize,
        ownerName: activeAccount?.label ?? receivingAccount?.label ?? "Owner",
        pin: draft.pin,
      });
      triggerHaptic("success");
      toast("Merchant Mode is ready", "success");
      onComplete?.();
      onClose();
    } catch (error) {
      triggerHaptic("error");
      setWorkflowError(error instanceof Error ? error.message : "Merchant setup could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const current = STEPS[step - 1];
  const memoPrefix = referencePrefix(draft.profile.name.trim() || "Till");

  return (
    <Modal open onClose={saving ? () => undefined : onClose} wide dismissable={!saving}>
      <ModalHeader
        title="Set up Merchant Mode"
        subtitle={`Step ${step} of 4 · ${current.title}`}
        onClose={saving ? () => undefined : onClose}
      />

      {/* ---------------- step indicator ---------------- */}
      <div className="border-b border-white/[0.06] px-4 py-2.5 sm:px-6">
        <ol className="flex items-center gap-1.5">
          {STEPS.map((entry) => {
            const done = entry.n < step;
            const here = entry.n === step;
            return (
              <li key={entry.n} className="min-w-0 flex-1">
                <span
                  aria-hidden="true"
                  className={`block h-1.5 rounded-full transition-all duration-300 ${
                    done ? "bg-[#30D158]" : here ? "bg-[#0A84FF]" : "bg-white/15"
                  }`}
                />
                <span
                  className={`mt-1.5 block truncate text-[10.5px] font-semibold ${
                    here ? "text-white" : done ? "text-[#30D158]" : "text-neutral-500"
                  }`}
                >
                  {done ? "✓ " : ""}
                  {entry.title}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="space-y-4 p-4 sm:p-6">
        {step === 1 && (
          <StepShop
            draft={draft}
            patch={patch}
            memoPrefix={memoPrefix}
          />
        )}

        {step === 2 && (
          <StepMoney
            draft={draft}
            patch={patch}
            accountOptions={accountOptions}
            receivingWatchOnly={Boolean(receivingAccount?.watchOnly)}
            assetChoices={assetChoices}
            heldKeys={heldKeys}
            missingCount={missingTrustlines.length}
            checking={receivingBalances === null}
            checkError={balanceError}
            trustingKey={trustingKey}
            onRetryCheck={() => setBalanceRefresh((value) => value + 1)}
            onAddTrustline={async (asset) => {
              const key = assetKey(asset);
              if (!asset.issuer) return;
              if (activeAccount?.publicKey !== draft.receivingPublicKey) {
                setWorkflowError("Select the receiving account in the wallet header before signing its trustline.");
                triggerHaptic("warning");
                return;
              }
              if (activeAccount.watchOnly) {
                setWorkflowError("A watch-only receiving account cannot sign a trustline. Add it from a signing wallet first.");
                triggerHaptic("warning");
                return;
              }
              setTrustingKey(key);
              setWorkflowError(null);
              try {
                const result = await trustAsset({ code: asset.code, issuer: asset.issuer, add: true });
                if (result.status === "status_unknown") {
                  setWorkflowError(`The ${asset.code} trustline was submitted but its status is unknown. Do not retry until transaction tracking resolves it.`);
                  toast("Trustline status is still being confirmed", "info");
                } else {
                  toast(`${asset.code} trustline submitted`, "success");
                }
                await refresh();
                setBalanceRefresh((value) => value + 1);
              } catch (error) {
                const message = error instanceof Error ? error.message : "The trustline could not be added.";
                setWorkflowError(message);
                toast(message, "error");
              } finally {
                setTrustingKey(null);
              }
            }}
            onWatchOnly={() => {
              triggerHaptic("light");
              toast("Use Add Account in the wallet header, then choose Watch-only", "info");
            }}
          />
        )}

        {step === 3 && <StepSelling draft={draft} patch={patch} />}

        {step === 4 && (
          <StepTill
            draft={draft}
            patch={patch}
            acceptedCount={accepted.length}
            receivingLabel={receivingAccount?.label ?? null}
            memoPrefix={memoPrefix}
          />
        )}

        {showProblems && problem && <Problem message={problem} />}
        {workflowError && <Problem message={workflowError} />}

        {/* Stacked on a phone: "Take the first charge" does not fit half a 393px
            row, and a primary action at the foot is where the thumb already is. */}
        <div className="flex flex-col gap-3 pt-1 sm:grid sm:grid-cols-2">
          <Button variant="ghost" className="w-full" disabled={saving} onClick={step === 1 ? onClose : goBack}>
            {step === 1 ? "Not now" : "Back"}
          </Button>
          {step < 4 ? (
            <Button className="w-full" disabled={saving} onClick={goNext}>
              Continue
            </Button>
          ) : (
            <Button className="w-full" loading={saving} onClick={() => void finish()}>
              Open the till
            </Button>
          )}
        </div>

        <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-neutral-500">
          <IconStorefront size={13} className="mt-[2px] shrink-0 text-[#30D158]" />
          <span>
            Nothing here leaves the device. A charge is a request paid straight to your own
            account — the wallet never holds a cent for you.
          </span>
        </p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1 — the shop                                                   */
/* ------------------------------------------------------------------ */

function StepShop({
  draft,
  patch,
  memoPrefix,
}: {
  draft: Draft;
  patch: (next: Partial<Draft>) => void;
  memoPrefix: string;
}) {
  const symbol = FIAT_SYMBOLS[draft.currency] ?? "";
  return (
    <>
      <Block icon={<IconStorefront size={15} />} tint="#30D158" title="What the customer sees">
        <div className="space-y-3.5">
          <div>
            <StepLabel>Shop name</StepLabel>
            <input
              type="text"
              value={draft.profile.name}
              onChange={(e) => patch({ profile: { ...draft.profile, name: e.target.value } })}
              placeholder="Rua Coffee"
              aria-label="Shop name"
              className="input text-base sm:text-[13.5px]"
            />
            <Hint>
              It heads the receipt and seeds the charge memo: orders will read{" "}
              <span className="mono text-neutral-300">{memoPrefix}-O-1001</span>.
            </Hint>
          </div>

          <div>
            <StepLabel>Address</StepLabel>
            <textarea
              rows={3}
              value={draft.profile.addressLines.join("\n")}
              onChange={(e) =>
                patch({
                  profile: {
                    ...draft.profile,
                    addressLines: e.target.value.split("\n"),
                  },
                })
              }
              placeholder={"12 Rua da Prata\n1100-052 Lisboa"}
              aria-label="Address, one line each"
              className="input resize-none text-base sm:text-[13.5px]"
            />
            <Hint>One line each. Blank lines are dropped when the receipt is printed.</Hint>
          </div>

          <div>
            <StepLabel>Tax ID</StepLabel>
            <input
              type="text"
              value={draft.profile.taxId}
              onChange={(e) => patch({ profile: { ...draft.profile, taxId: e.target.value } })}
              placeholder="PT123456789"
              aria-label="Tax ID"
              className="input mono text-base sm:text-[13.5px]"
            />
          </div>

          <div>
            <StepLabel>Display currency</StepLabel>
            <Select
              value={draft.currency}
              ariaLabel="Display currency"
              options={CURRENCIES.map((code) => ({
                value: code,
                label: code,
                sublabel: FIAT_SYMBOLS[code],
              }))}
              onChange={(next) => {
                const currency = CURRENCIES.find((code) => code === next);
                if (currency) patch({ currency });
              }}
            />
            <Hint>
              The shop keeps its books in {draft.currency} ({symbol.trim()}); assets are quoted into
              it the moment a charge is raised.
            </Hint>
          </div>
        </div>
      </Block>

      <Block icon={<IconReceipt size={15} />} tint="#0A84FF" title="Receipt header">
        <div className="panel-inset px-4 py-4">
          <div className="mx-auto max-w-[260px] text-center">
            <p className="mono truncate text-[15px] font-semibold uppercase tracking-[0.14em] text-white">
              {draft.profile.name.trim() || "Your shop"}
            </p>
            {draft.profile.addressLines
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line, index) => (
                <p key={index} className="mono mt-0.5 text-[11.5px] leading-relaxed text-neutral-400">
                  {line}
                </p>
              ))}
            {draft.profile.taxId.trim() && (
              <p className="mono mt-1 text-[11.5px] text-neutral-400">
                VAT {draft.profile.taxId.trim()}
              </p>
            )}
            <div className="my-3 border-t border-dashed border-white/20" />
            <div className="mono space-y-1 text-left text-[11.5px] text-neutral-300">
              <div className="flex justify-between gap-3">
                <span className="truncate">
                  {PREVIEW_LINES[0].quantity} × {PREVIEW_LINES[0].name}
                </span>
                <span>{fmtMinor(PREVIEW_LINES[0].unitPriceMinor, draft.currency)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="truncate">
                  {PREVIEW_LINES[1].quantity} × {PREVIEW_LINES[1].name}
                </span>
                <span>{fmtMinor(PREVIEW_LINES[1].unitPriceMinor, draft.currency)}</span>
              </div>
            </div>
            <div className="my-3 border-t border-dashed border-white/20" />
            <div className="mono flex justify-between gap-3 text-[13px] font-semibold text-white">
              <span>Total</span>
              <span>{fmtMinor(PREVIEW_TOTAL_MINOR, draft.currency)}</span>
            </div>
          </div>
        </div>
        <Hint>
          The footer, the tax lines and the payer address are added on step three and at the till;
          this is the part you own.
        </Hint>
      </Block>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — money                                                      */
/* ------------------------------------------------------------------ */

function StepMoney({
  draft,
  patch,
  accountOptions,
  receivingWatchOnly,
  assetChoices,
  heldKeys,
  missingCount,
  checking,
  checkError,
  trustingKey,
  onRetryCheck,
  onAddTrustline,
  onWatchOnly,
}: {
  draft: Draft;
  patch: (next: Partial<Draft>) => void;
  accountOptions: SelectOption[];
  receivingWatchOnly: boolean;
  assetChoices: AcceptedAsset[];
  heldKeys: Set<string>;
  missingCount: number;
  checking: boolean;
  checkError: string | null;
  trustingKey: string | null;
  onRetryCheck: () => void;
  onAddTrustline: (asset: AcceptedAsset) => Promise<void>;
  onWatchOnly: () => void;
}) {
  const acceptedAssets = assetChoices.filter((asset) =>
    draft.acceptedKeys.includes(assetKey(asset)),
  );

  function toggleAsset(asset: AcceptedAsset, on: boolean) {
    const key = assetKey(asset);
    patch({
      acceptedKeys: on
        ? [...draft.acceptedKeys, key]
        : draft.acceptedKeys.filter((existing) => existing !== key),
    });
  }

  return (
    <>
      <Block icon={<IconKey size={15} />} tint="#0A84FF" title="Where payments land">
        <StepLabel>Receiving account</StepLabel>
        {accountOptions.length === 0 ? (
          <Notice tone="warn">
            This wallet has no account yet. Add one first — a charge has to be addressed somewhere.
          </Notice>
        ) : (
          <Select
            value={draft.receivingPublicKey}
            options={accountOptions}
            placeholder="Choose an account"
            ariaLabel="Receiving account"
            onChange={(receivingPublicKey) => patch({ receivingPublicKey })}
          />
        )}
        <Hint>
          Every charge is addressed to this account and settles straight into it. Nothing is
          escrowed, nothing is pulled, and a refund is an ordinary payment back out.
        </Hint>

        <div className="mt-3">
          <Notice tone={receivingWatchOnly ? "pos" : "info"}>
            <div className="flex items-start gap-2.5">
              <span
                className={`mt-0.5 shrink-0 ${receivingWatchOnly ? "text-[#30D158]" : "text-[#64D2FF]"}`}
              >
                {receivingWatchOnly ? <IconCheck size={15} /> : <IconLock size={15} />}
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-white">
                  {receivingWatchOnly ? "This till is watch-only" : "Run the till watch-only"}
                </p>
                <p className="mt-1 text-neutral-300">
                  Receiving needs no key at all — only the public address. Pair the counter device
                  as a watch-only account and a thief who walks off with it cannot move a cent: it
                  can raise charges and watch them settle, and nothing else.
                </p>
                {!receivingWatchOnly && (
                  <button
                    type="button"
                    onClick={onWatchOnly}
                    className="btn btn-secondary btn-sm mt-2.5"
                  >
                    <IconPlus size={13} /> Add a watch-only account
                  </button>
                )}
              </div>
            </div>
          </Notice>
        </div>
      </Block>

      <Block icon={<IconStorefront size={15} />} tint="#30D158" title="What you take">
        <StepLabel>Accepted assets</StepLabel>
        <div className="panel-inset">
          {assetChoices.map((asset, index) => {
            const key = assetKey(asset);
            const on = draft.acceptedKeys.includes(key);
            return (
              <div
                key={key}
                className={`flex items-center gap-3 px-3 py-2.5 ${
                  index > 0 ? "border-t border-white/[0.08]" : ""
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="mono block truncate text-[13.5px] font-semibold text-white">
                    {asset.code}
                  </span>
                  <span className="mono block truncate text-[11px] text-neutral-500">
                    {isNative(asset) ? "Native" : formatTrezorAddress(asset.issuer ?? "")}
                  </span>
                </span>
                <Toggle
                  on={on}
                  label={`Accept ${asset.code}`}
                  onChange={() => toggleAsset(asset, !on)}
                />
              </div>
            );
          })}
        </div>

        <div className="mt-3.5">
          <StepLabel>Settlement asset</StepLabel>
          <Select
            value={draft.settlementKey}
            ariaLabel="Settlement asset"
            options={assetChoices.map((asset) => ({
              value: assetKey(asset),
              label: asset.code,
              sublabel: isNative(asset) ? "Native" : "Issued",
              disabled: !draft.acceptedKeys.includes(assetKey(asset)),
            }))}
            preserveOptionLabels
            onChange={(settlementKey) => patch({ settlementKey })}
          />
          <Hint>
            The asset the books are kept in. Anything else you take is converted in batches, never
            on receipt.
          </Hint>
        </div>
      </Block>

      <Block icon={<IconAlert size={15} />} tint="#FF9F0A" title="Trustline preflight">
        {checking ? (
          <p role="status" className="text-[13px] leading-relaxed text-neutral-400">
            Checking the receiving account on Stellar…
          </p>
        ) : checkError ? (
          <Notice tone="warn">
            <div className="flex items-center justify-between gap-3">
              <span>The receiving account could not be checked.</span>
              <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={onRetryCheck}>
                Retry
              </button>
            </div>
          </Notice>
        ) : acceptedAssets.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-neutral-400">
            Turn on an asset above and its trustline is checked here.
          </p>
        ) : (
          <div className="panel-inset">
            {acceptedAssets.map((asset, index) => {
              const native = isNative(asset);
              const held = native || heldKeys.has(assetKey(asset));
              return (
                <div
                  key={assetKey(asset)}
                  className={`flex items-center gap-3 px-3 py-2.5 ${
                    index > 0 ? "border-t border-white/[0.08]" : ""
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] ${
                      held ? "bg-[#30D158]/15 text-[#30D158]" : "bg-[#FF9F0A]/15 text-[#FF9F0A]"
                    }`}
                  >
                    {held ? <IconCheck size={15} /> : <IconAlert size={15} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="mono block truncate text-[13.5px] font-semibold text-white">
                      {asset.code}
                    </span>
                    <span
                      className={`block text-[11.5px] leading-relaxed ${
                        held ? "text-[#30D158]" : "text-[#FF9F0A]"
                      }`}
                    >
                      {native
                        ? "Native — no trustline, no reserve"
                        : held
                          ? "Trustline held"
                          : "No trustline — payments would bounce"}
                    </span>
                  </span>
                  {!native && !held && (
                    <button
                      type="button"
                      disabled={trustingKey !== null}
                      onClick={() => void onAddTrustline(asset)}
                      className="btn btn-secondary btn-sm shrink-0"
                    >
                      {trustingKey === assetKey(asset) ? "Adding…" : "Add trustline"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="panel-inset mt-3 px-3.5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Reserve impact
          </p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-300">
            Each trustline adds one subentry to this account. Stellar&rsquo;s current base reserve,
            every other subentry, liabilities, and the transaction fee are checked again in the
            wallet&rsquo;s signing review—this screen does not guess a fixed reserve value.
          </p>
          {missingCount > 0 && (
            <p className="mt-2 text-[12px] leading-relaxed text-[#FF9F0A]">
              {missingCount} {missingCount === 1 ? "trustline is" : "trustlines are"} still required.
            </p>
          )}
        </div>
      </Block>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 — how you sell                                               */
/* ------------------------------------------------------------------ */

function StepSelling({
  draft,
  patch,
}: {
  draft: Draft;
  patch: (next: Partial<Draft>) => void;
}) {
  const standard = parsePercent(draft.rates[0]?.percentText ?? "0") ?? 0;
  const tipPercents = parsePercentList(draft.tipPercentsText) ?? [];
  /** A worked example on one 4.80 ticket, so the tax mode is not an abstraction. */
  const exampleGross = 480;
  const taxInside = Math.round((exampleGross * standard) / (100 + standard));
  const taxAdded = Math.round((exampleGross * standard) / 100);

  return (
    <>
      <Block icon={<IconPercent size={15} />} tint="#BF5AF2" title="Tax">
        <StepLabel>Tax mode</StepLabel>
        <SegmentedControl<TaxMode>
          ariaLabel="How tax is applied"
          value={draft.taxMode}
          options={[
            { label: "Included in price", value: "inclusive" },
            { label: "Added at checkout", value: "added" },
          ]}
          onChange={(taxMode) => patch({ taxMode })}
        />
        <Hint>
          {draft.taxMode === "inclusive" ? (
            <>
              A {fmtMinor(exampleGross, draft.currency)} ticket already contains{" "}
              <span className="mono text-neutral-300">{fmtMinor(taxInside, draft.currency)}</span> of
              tax at {standard} %; the customer pays {fmtMinor(exampleGross, draft.currency)}.
            </>
          ) : (
            <>
              A {fmtMinor(exampleGross, draft.currency)} ticket picks up{" "}
              <span className="mono text-neutral-300">{fmtMinor(taxAdded, draft.currency)}</span> at{" "}
              {standard} %; the customer pays{" "}
              {fmtMinor(exampleGross + taxAdded, draft.currency)}.
            </>
          )}
        </Hint>

        <div className="mt-3.5 space-y-2">
          <StepLabel>Rates</StepLabel>
          {draft.rates.map((rate, index) => (
            <div key={rate.id} className="flex items-center gap-2.5">
              <input
                type="text"
                value={rate.label}
                aria-label={`Name of rate ${index + 1}`}
                onChange={(e) => {
                  const rates = draft.rates.map((existing) =>
                    existing.id === rate.id ? { ...existing, label: e.target.value } : existing,
                  );
                  patch({ rates });
                }}
                className="input min-w-0 flex-1 !py-2.5 text-base sm:text-[13.5px]"
              />
              <div className="relative w-[96px] shrink-0">
                <input
                  type="text"
                  inputMode="decimal"
                  value={rate.percentText}
                  aria-label={`Percent of the ${rate.label || `rate ${index + 1}`} rate`}
                  onChange={(e) => {
                    const rates = draft.rates.map((existing) =>
                      existing.id === rate.id
                        ? { ...existing, percentText: e.target.value }
                        : existing,
                    );
                    patch({ rates });
                  }}
                  className={`input mono !py-2.5 !pr-8 text-base sm:text-[13.5px] ${
                    parsePercent(rate.percentText) === null
                      ? "ring-1 ring-inset ring-[#FF9F0A]/60"
                      : ""
                  }`}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-neutral-400"
                >
                  %
                </span>
              </div>
            </div>
          ))}
        </div>
      </Block>

      <Block icon={<IconStorefront size={15} />} tint="#30D158" title="Tips">
        <StepLabel>Tip prompt</StepLabel>
        <SegmentedControl<TipMode>
          ariaLabel="How tips are offered"
          value={draft.tipMode}
          options={[
            { label: "Off", value: "off" },
            { label: "Percentage", value: "percent" },
            { label: "Fixed", value: "fixed" },
          ]}
          onChange={(tipMode) => patch({ tipMode })}
        />
        {draft.tipMode === "percent" && (
          <div className="mt-3">
            <StepLabel>Percentage presets</StepLabel>
            <input
              type="text"
              inputMode="decimal"
              value={draft.tipPercentsText}
              aria-label="Percentage tip presets, comma separated"
              onChange={(e) => patch({ tipPercentsText: e.target.value })}
              className="input mono text-base sm:text-[13.5px]"
            />
            <div className="mt-2.5 flex flex-wrap gap-2">
              {tipPercents.map((percent) => (
                <span key={percent} className="chip cursor-default">
                  {percent} % · {fmtMinor(Math.round((480 * percent) / 100), draft.currency)}
                </span>
              ))}
            </div>
            <Hint>What the customer would be offered on a {fmtMinor(PREVIEW_TOTAL_MINOR, draft.currency)} ticket.</Hint>
          </div>
        )}
        {draft.tipMode === "fixed" && (
          <Hint>
            Fixed amounts are offered instead of percentages, which round to nothing on a small
            ticket. The presets are edited in Merchant settings.
          </Hint>
        )}
        {draft.tipMode === "off" && <Hint>No tip step: the ticket total is what is asked for.</Hint>}
      </Block>

      <Block icon={<IconClock size={15} />} tint="#FF9F0A" title="The clock and the footer">
        <StepLabel>A charge stays payable for</StepLabel>
        <Select
          value={String(draft.chargeExpirySeconds)}
          ariaLabel="Charge expiry"
          options={EXPIRY_OPTIONS.map((option) => ({
            value: String(option.seconds),
            label: option.label,
          }))}
          onChange={(next) => {
            const chargeExpirySeconds = Number.parseInt(next, 10);
            if (Number.isFinite(chargeExpirySeconds)) patch({ chargeExpirySeconds });
          }}
        />
        <Hint>
          The quote is held for exactly this long, so the shop&rsquo;s figure cannot move while the
          customer is paying.
        </Hint>

        <div className="mt-3.5">
          <StepLabel>Receipt footer</StepLabel>
          <input
            type="text"
            value={draft.profile.receiptFooter}
            aria-label="Receipt footer"
            placeholder="Thank you — see you again"
            onChange={(e) =>
              patch({ profile: { ...draft.profile, receiptFooter: e.target.value } })
            }
            className="input text-base sm:text-[13.5px]"
          />
          <div className="panel-inset mt-2.5 px-3.5 py-3 text-center">
            <p className="mono text-[11.5px] leading-relaxed text-neutral-400">
              {draft.profile.receiptFooter.trim() || "Thank you — see you again"}
            </p>
          </div>
        </div>
      </Block>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Step 4 — the till                                                   */
/* ------------------------------------------------------------------ */

function StepTill({
  draft,
  patch,
  acceptedCount,
  receivingLabel,
  memoPrefix,
}: {
  draft: Draft;
  patch: (next: Partial<Draft>) => void;
  acceptedCount: number;
  receivingLabel: string | null;
  memoPrefix: string;
}) {
  const pinFilled = draft.pin.length;
  return (
    <>
      <Block icon={<IconTerminal size={15} />} tint="#5E5CE6" title="This device">
        <StepLabel>Terminal name</StepLabel>
        <input
          type="text"
          value={draft.terminalName}
          aria-label="Terminal name"
          placeholder="Front counter"
          onChange={(e) => patch({ terminalName: e.target.value })}
          className="input text-base sm:text-[13.5px]"
        />
        <Hint>
          Attributed to every order this device rings up, and printed on the Z-report so two tills
          never blur into one.
        </Hint>

        <div className="mt-3.5">
          <StepLabel>Staff PIN</StepLabel>
          <div className="flex items-center gap-2.5">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={draft.pin}
              aria-label="Staff PIN"
              placeholder="4 to 6 digits"
              onChange={(e) => patch({ pin: e.target.value.replace(/\D/g, "").slice(0, 6) })}
              className="input mono min-w-0 flex-1 text-base sm:text-[13.5px]"
            />
            <span aria-hidden="true" className="flex shrink-0 items-center gap-1.5">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <span
                  key={index}
                  className={`h-2 w-2 rounded-full ${
                    index < pinFilled ? "bg-[#0A84FF]" : "bg-white/15"
                  }`}
                />
              ))}
            </span>
          </div>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={draft.pinConfirm}
            aria-label="Confirm staff PIN"
            placeholder="Type it again"
            onChange={(e) => patch({ pinConfirm: e.target.value.replace(/\D/g, "").slice(0, 6) })}
            className="input mono mt-2.5 text-base sm:text-[13.5px]"
          />
          <Hint>
            A PIN authorises till actions, never a signature. Only a salted digest is kept inside
            encrypted merchant storage, and the wallet must be unlocked before the till can use it.
          </Hint>
        </div>
      </Block>

      <Block icon={<IconReceipt size={15} />} tint="#0A84FF" title="Till text size">
        <SegmentedControl<TillTextSize>
          ariaLabel="Till text size"
          value={draft.textSize}
          options={(Object.keys(TEXT_SIZE_LABEL) as TillTextSize[]).map((size) => ({
            label: TEXT_SIZE_LABEL[size],
            value: size,
          }))}
          onChange={(textSize) => patch({ textSize })}
        />
        <div className="panel-inset mt-3 px-4 py-4 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Total
          </p>
          <p
            className={`mono mt-1 font-semibold leading-none text-white ${TEXT_SIZE_TOTAL[draft.textSize]}`}
          >
            {fmtMinor(PREVIEW_TOTAL_MINOR, draft.currency)}
          </p>
        </div>
        <Hint>
          The web has no Dynamic Type, so the till carries its own scale. It can be changed later in
          Settings → Merchant → Peripherals.
        </Hint>
      </Block>

      <Block icon={<IconCheck size={15} />} tint="#30D158" title="Ready">
        <dl className="panel-inset divide-y divide-white/[0.08]">
          <SummaryRow label="Shop" value={draft.profile.name.trim() || "—"} />
          <SummaryRow label="Books in" value={draft.currency} />
          <SummaryRow label="Receiving" value={receivingLabel ?? "—"} />
          <SummaryRow
            label="Accepts"
            value={`${acceptedCount} ${acceptedCount === 1 ? "asset" : "assets"}`}
          />
          <SummaryRow
            label="Tax"
            value={draft.taxMode === "inclusive" ? "Included in prices" : "Added at checkout"}
          />
          <SummaryRow label="Charges expire in" value={`${draft.chargeExpirySeconds / 60} min`} />
          <SummaryRow label="This till" value={draft.terminalName.trim() || "—"} />
          <SummaryRow label="First order" value={`${memoPrefix}-O-1001`} mono />
        </dl>
        <div className="mt-3">
          <Notice tone="pos">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0 text-[#30D158]">
                <IconInfo size={15} />
              </span>
              <span>
                The counter opens on the till. Ring an item up or key an amount, and the Charge
                button puts a QR in front of the customer — that is the first charge.
              </span>
            </div>
          </Notice>
        </div>
      </Block>
    </>
  );
}

function SummaryRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <dt className="shrink-0 text-[12.5px] text-neutral-400">{label}</dt>
      <dd className={`min-w-0 truncate text-right text-[13px] font-semibold text-white${mono ? " mono" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
