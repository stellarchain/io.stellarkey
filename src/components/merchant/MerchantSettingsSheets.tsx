"use client";

import { useMemo } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { useWalletIdentity, useWalletLedger } from "@/hooks/useWallet";
import { formatTrezorAddress } from "@/lib/address-display";
import { fmtAmount, FIAT_SYMBOLS, type FiatCurrency } from "@/lib/format";
import { sameAsset } from "@/lib/merchant/charge";
import { minorToDecimal, toMinor } from "@/lib/merchant/money";
import type {
  SettlementSwapIntent,
  SettlementSweepIntent,
} from "@/lib/merchant/settlement";
import type { AcceptedAsset, TaxMode, TipMode } from "@/lib/merchant/types";
import { BASE_RESERVE_XLM } from "@/lib/stellar";
import type { SettingsSub } from "../SettingsPage";
import { Avatar, ModalHeader, Notice, SegmentedControl, Select, Toggle } from "../ui";
import { useToast } from "../Toast";
import {
  IconArrowUpRight,
  IconFileText,
  IconShield,
  IconSwap,
  IconWallet,
} from "../icons";
import {
  IconClock,
  IconPercent,
  IconReceipt,
  IconStorefront,
  IconTerminal,
} from "./icons";
import { MerchantDisclosure } from "./Disclosure";
import {
  ChoiceRow,
  DraftInput,
  NoteRow,
  SettingsCaption,
  SettingsRow,
  SheetBody,
  TextRow,
} from "./MerchantSettingsControls";

export type MerchantSettingsSheet =
  | "business"
  | "payments"
  | "assets"
  | "tax"
  | "rates"
  | "tips"
  | "settlement"
  | "device";

const CURRENCIES: FiatCurrency[] = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"];

const SLIPPAGE_OPTIONS = [
  { value: "10", label: "0.10 %" },
  { value: "25", label: "0.25 %" },
  { value: "50", label: "0.50 %" },
  { value: "100", label: "1.00 %" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));

const EXPIRY_OPTIONS = [
  { seconds: 300, label: "5 minutes" },
  { seconds: 600, label: "10 minutes" },
  { seconds: 900, label: "15 minutes" },
  { seconds: 1800, label: "30 minutes" },
];

export function MerchantSettingsSheetContent({
  activeSheet,
  onClose,
  onNavigate,
  onOpenSwap,
  onOpenSend,
}: {
  activeSheet: MerchantSettingsSheet | null;
  onClose: () => void;
  onNavigate?: (sub: SettingsSub) => void;
  onOpenSwap?: (intent: SettlementSwapIntent) => void;
  onOpenSend?: (intent: SettlementSweepIntent) => void;
}) {
  const {
    settings,
    updateSettings,
    settlementRule,
    settlementHandoffs,
    updateSettlementRule,
    storageHealth,
    requestPersistentStorage,
  } = useMerchant();
  const { accounts } = useWalletIdentity();
  const { balances } = useWalletLedger();
  const { toast } = useToast();

  const symbol = FIAT_SYMBOLS[settings.currency] ?? "";
  const accountOptions = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.publicKey,
        label: account.label,
        sublabel: formatTrezorAddress(account.publicKey),
      })),
    [accounts],
  );
  const receivingAccount = accounts.find(
    (account) => account.publicKey === settings.receivingPublicKey,
  );
  const assetChoices = useMemo(() => {
    const list: AcceptedAsset[] = [{ code: "XLM", issuer: null }];
    for (const balance of balances ?? []) {
      if (balance.isNative || balance.issuer === null) continue;
      const asset: AcceptedAsset = { code: balance.code, issuer: balance.issuer };
      if (!list.some((existing) => sameAsset(existing, asset))) list.push(asset);
    }
    for (const accepted of settings.acceptedAssets) {
      if (!list.some((existing) => sameAsset(existing, accepted))) list.push(accepted);
    }
    return list;
  }, [balances, settings.acceptedAssets]);
  const subentries = (balances ?? []).filter(
    (balance) => !balance.isNative && balance.issuer !== null,
  ).length;
  const reserveXlm = BASE_RESERVE_XLM * (2 + subentries);
  const askAt = `${String(settlementRule.sweepPromptHour ?? 21).padStart(2, "0")}:00`;
  const treasury = settlementRule.sweepDestination ?? "";

  function navigateFromSheet(sub: SettingsSub) {
    onClose();
    onNavigate?.(sub);
  }

  function changeSettlementRule(patch: Parameters<typeof updateSettlementRule>[0]): void {
    void updateSettlementRule(patch).catch((error: unknown) => {
      toast(
        error instanceof Error ? error.message : "Settlement settings could not be saved.",
        "error",
      );
    });
  }

  function toggleAsset(asset: AcceptedAsset, on: boolean) {
    updateSettings({
      acceptedAssets: on
        ? [...settings.acceptedAssets, asset]
        : settings.acceptedAssets.filter((existing) => !sameAsset(existing, asset)),
    });
  }

  function parseMinorList(raw: string): number[] | null {
    const parts = raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length === 0) return null;
    try {
      const minors = parts.map((part) => toMinor(part));
      return minors.some((minor) => minor <= 0) ? null : minors;
    } catch {
      return null;
    }
  }

  async function handlePersistentStorage() {
    try {
      const granted = await requestPersistentStorage();
      toast(
        granted
          ? "This browser granted persistent offline storage."
          : "Storage remains best effort. Keep an encrypted wallet backup current.",
        granted ? "success" : "info",
      );
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Storage permission could not be requested.",
        "error",
      );
    }
  }

  if (activeSheet === "business") {
    return (
      <>
        <ModalHeader
          title="Business details"
          subtitle="Shown on receipts and payment references"
          onClose={onClose}
        />
        <SheetBody sheet="business">
          <div className="list-group">
            <TextRow
              first
              icon={<IconStorefront size={16} />}
              tint="#30D158"
              label="Shop name"
              value={settings.profile.name}
              placeholder="Rua Coffee"
              onCommit={(next) => {
                const name = next.trim();
                updateSettings({ profile: { ...settings.profile, name } });
                return name;
              }}
            />
            <TextRow
              icon={<IconReceipt size={16} />}
              tint="#64D2FF"
              label="Tax ID"
              value={settings.profile.taxId}
              placeholder="PT123456789"
              className="mono"
              onCommit={(next) => {
                const taxId = next.trim();
                updateSettings({ profile: { ...settings.profile, taxId } });
                return taxId;
              }}
            />
            <ChoiceRow
              icon={<IconStorefront size={16} />}
              tint="#30D158"
              label="Address"
              sub="One line per receipt line"
            >
              <DraftInput
                ariaLabel="Address"
                multiline
                value={settings.profile.addressLines.join("\n")}
                placeholder={"12 Rua da Prata\n1100-052 Lisboa"}
                onCommit={(next) => {
                  const addressLines = next
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0);
                  updateSettings({ profile: { ...settings.profile, addressLines } });
                  return addressLines.join("\n");
                }}
              />
            </ChoiceRow>
            <TextRow
              icon={<IconReceipt size={16} />}
              tint="#5E5CE6"
              label="Receipt footer"
              value={settings.profile.receiptFooter}
              placeholder="Thank you. See you again."
              onCommit={(next) => {
                const receiptFooter = next.trim();
                updateSettings({ profile: { ...settings.profile, receiptFooter } });
                return receiptFooter;
              }}
            />
          </div>
          <SettingsCaption>
            Changes save to this device when you finish editing a field.
          </SettingsCaption>
        </SheetBody>
      </>
    );
  }

  if (activeSheet === "payments") {
    return (
      <>
        <ModalHeader
          title="Payment setup"
          subtitle="Where payments arrive and how charges behave"
          onClose={onClose}
        />
        <SheetBody sheet="payments">
          {!settings.receivingPublicKey && (
            <Notice tone="warn">
              Charges are paused until you choose the account that receives payments.
            </Notice>
          )}
          <div className="list-group">
            <SettingsRow
              first
              icon={<IconWallet size={16} />}
              tint="#30D158"
              label="Receiving account"
              sub={
                receivingAccount
                  ? formatTrezorAddress(receivingAccount.publicKey)
                  : "Paid straight to your own account"
              }
            >
              <Select
                size="sm"
                className="shrink-0"
                value={settings.receivingPublicKey ?? ""}
                options={accountOptions}
                placeholder="Choose"
                ariaLabel="Receiving account"
                onChange={(receivingPublicKey) => updateSettings({ receivingPublicKey })}
              />
            </SettingsRow>
            <NoteRow>
              Issued requests keep their original receiving account and remain monitored until
              resolved.
            </NoteRow>
            <SettingsRow
              icon={<span className="mono text-[12px] font-bold">{symbol}</span>}
              tint="#64D2FF"
              label="Display currency"
              sub="The books are kept in this currency"
            >
              <Select
                size="sm"
                className="shrink-0"
                value={settings.currency}
                options={CURRENCIES.map((code) => ({
                  value: code,
                  label: code,
                  sublabel: FIAT_SYMBOLS[code],
                }))}
                ariaLabel="Display currency"
                onChange={(next) => {
                  const currency = CURRENCIES.find((code) => code === next);
                  if (currency) updateSettings({ currency });
                }}
              />
            </SettingsRow>
            <SettingsRow
              icon={<IconClock size={16} />}
              tint="#FF9F0A"
              label="Charge expires after"
              sub="The held quote cannot move mid-sale"
            >
              <Select
                size="sm"
                className="shrink-0"
                value={String(settings.chargeExpirySeconds)}
                options={EXPIRY_OPTIONS.map((option) => ({
                  value: String(option.seconds),
                  label: option.label,
                }))}
                ariaLabel="Charge expiry"
                onChange={(next) => {
                  const chargeExpirySeconds = Number.parseInt(next, 10);
                  if (Number.isFinite(chargeExpirySeconds)) updateSettings({ chargeExpirySeconds });
                }}
              />
            </SettingsRow>
            <TextRow
              icon={<IconPercent size={16} />}
              tint="#BF5AF2"
              label="Amount tolerance"
              sub="Only for a payment that arrives without a memo"
              suffix="%"
              value={(settings.toleranceBps / 100).toFixed(2)}
              inputMode="decimal"
              className="mono"
              onCommit={(next) => {
                const percent = Number.parseFloat(next.replace(",", "."));
                if (!Number.isFinite(percent) || percent < 0 || percent > 20) {
                  toast("Enter a tolerance between 0 and 20 percent.", "error");
                  return (settings.toleranceBps / 100).toFixed(2);
                }
                const toleranceBps = Math.round(percent * 100);
                updateSettings({ toleranceBps });
                return (toleranceBps / 100).toFixed(2);
              }}
            />
            <SettingsRow
              icon={<IconClock size={16} />}
              tint="#FF9F0A"
              label="Hold auto-lock during a charge"
              sub="Keeps the watcher active until the charge closes"
            >
              <Toggle
                on={settings.holdAutoLockDuringCharge}
                label="Hold auto-lock while a charge is open"
                onChange={() =>
                  updateSettings({
                    holdAutoLockDuringCharge: !settings.holdAutoLockDuringCharge,
                  })
                }
              />
            </SettingsRow>
            <NoteRow>
              An exact amount is always matched first. Tolerance only resolves a single remaining
              memo-less candidate.
            </NoteRow>
          </div>
        </SheetBody>
      </>
    );
  }

  if (activeSheet === "assets") {
    return (
      <>
        <ModalHeader
          title="Accepted assets"
          subtitle="Choose the exact assets this till can quote"
          onClose={onClose}
        />
        <SheetBody sheet="assets">
          <div className="list-group">
            {assetChoices.map((asset, index) => {
              const on = settings.acceptedAssets.some((accepted) => sameAsset(accepted, asset));
              return (
                <SettingsRow
                  key={`${asset.code}:${asset.issuer ?? "native"}`}
                  first={index === 0}
                  icon={
                    <Avatar
                      seed={`${asset.code}:${asset.issuer ?? "native"}`}
                      size={28}
                      label={asset.code.slice(0, 1)}
                    />
                  }
                  label={asset.code}
                  sub={asset.issuer === null ? "Native Stellar asset" : formatTrezorAddress(asset.issuer)}
                >
                  <Toggle
                    on={on}
                    label={`Accept ${asset.code}`}
                    onChange={() => toggleAsset(asset, !on)}
                  />
                </SettingsRow>
              );
            })}
          </div>
          {settings.acceptedAssets.length === 0 ? (
            <SettingsCaption tone="warn">Select at least one asset to create charges.</SettingsCaption>
          ) : (
            <SettingsCaption>
              Issued assets remain bound to their full issuer address, even when codes match.
            </SettingsCaption>
          )}
        </SheetBody>
      </>
    );
  }

  if (activeSheet === "tax") {
    return (
      <>
        <ModalHeader title="Tax" subtitle="How tax appears on tickets and receipts" onClose={onClose} />
        <SheetBody sheet="tax">
          <div className="list-group">
            <ChoiceRow
              first
              icon={<IconPercent size={16} />}
              tint="#FF9F0A"
              label="Tax mode"
            >
              <SegmentedControl<TaxMode>
                value={settings.taxMode}
                options={[
                  { label: "Included", value: "inclusive" },
                  { label: "Added", value: "added" },
                ]}
                onChange={(taxMode) => updateSettings({ taxMode })}
              />
            </ChoiceRow>
            <SettingsRow
              icon={<IconPercent size={16} />}
              tint="#BF5AF2"
              label="Keypad amounts use"
              sub="Default rate when there is no catalogue item"
            >
              <Select
                size="sm"
                className="shrink-0"
                value={settings.defaultTaxRateId}
                options={settings.taxRates.map((rate) => ({
                  value: rate.id,
                  label: rate.label,
                  sublabel: `${rate.percent} %`,
                }))}
                ariaLabel="Rate applied to keypad amounts"
                onChange={(defaultTaxRateId) => updateSettings({ defaultTaxRateId })}
              />
            </SettingsRow>
            <SettingsRow
              icon={<IconFileText size={16} />}
              tint="#BF5AF2"
              label="Tax records"
              sub="Filing periods, exports and adjustments"
              chevron={Boolean(onNavigate)}
              onClick={onNavigate ? () => navigateFromSheet("tax") : undefined}
            />
          </div>
          <SettingsCaption>
            {settings.taxMode === "inclusive"
              ? "Catalogue prices already contain tax; the ticket shows the included amount."
              : "Catalogue prices are net; tax is added at checkout."}
          </SettingsCaption>
        </SheetBody>
      </>
    );
  }

  if (activeSheet === "rates") {
    return (
      <>
        <ModalHeader
          title="Tax rates"
          subtitle="Names and percentages used by catalogue items"
          onClose={onClose}
        />
        <SheetBody sheet="rates">
          <div className="list-group">
            {settings.taxRates.map((rate, index) => (
              <SettingsRow
                key={rate.id}
                first={index === 0}
                icon={<IconPercent size={16} />}
                tint="#BF5AF2"
                label={
                  <DraftInput
                    inline
                    align="left"
                    ariaLabel={`Name of the ${rate.label} rate`}
                    value={rate.label}
                    onCommit={(next) => {
                      const label = next.trim();
                      if (!label) return rate.label;
                      updateSettings({
                        taxRates: settings.taxRates.map((existing) =>
                          existing.id === rate.id ? { ...existing, label } : existing,
                        ),
                      });
                      return label;
                    }}
                  />
                }
              >
                <span className="flex w-[92px] shrink-0 items-center gap-1">
                  <DraftInput
                    inline
                    ariaLabel={`Percent of the ${rate.label} rate`}
                    inputMode="decimal"
                    value={String(rate.percent)}
                    className="mono"
                    onCommit={(next) => {
                      const percent = Number.parseFloat(next.replace(",", "."));
                      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
                        toast("Enter a tax rate between 0 and 100 percent.", "error");
                        return String(rate.percent);
                      }
                      updateSettings({
                        taxRates: settings.taxRates.map((existing) =>
                          existing.id === rate.id ? { ...existing, percent } : existing,
                        ),
                      });
                      return String(percent);
                    }}
                  />
                  <span className="shrink-0 text-[15.5px] text-neutral-400">%</span>
                </span>
              </SettingsRow>
            ))}
          </div>
          <SettingsCaption>
            The rate name appears on catalogue items. Keypad sales use the default selected in Tax.
          </SettingsCaption>
        </SheetBody>
      </>
    );
  }

  if (activeSheet === "tips") {
    return (
      <>
        <ModalHeader title="Tips" subtitle="Prompt style and suggested amounts" onClose={onClose} />
        <SheetBody sheet="tips">
          <div className="list-group">
            <ChoiceRow
              first
              icon={<IconReceipt size={16} />}
              tint="#BF5AF2"
              label="Tip prompt"
            >
              <SegmentedControl<TipMode>
                value={settings.tips.mode}
                options={[
                  { label: "Off", value: "off" },
                  { label: "Percent", value: "percent" },
                  { label: "Fixed", value: "fixed" },
                ]}
                onChange={(mode) => updateSettings({ tips: { ...settings.tips, mode } })}
              />
            </ChoiceRow>
            {settings.tips.mode === "percent" && (
              <TextRow
                icon={<IconPercent size={16} />}
                tint="#BF5AF2"
                label="Percentage presets"
                sub="Comma separated"
                value={settings.tips.percents.join(", ")}
                inputMode="decimal"
                className="mono"
                onCommit={(next) => {
                  const percents = next
                    .split(",")
                    .map((part) => Number.parseFloat(part.trim().replace(",", ".")))
                    .filter((value) => Number.isFinite(value) && value > 0 && value <= 100);
                  if (percents.length === 0) {
                    toast("Enter at least one percentage between 0 and 100.", "error");
                    return settings.tips.percents.join(", ");
                  }
                  updateSettings({ tips: { ...settings.tips, percents } });
                  return percents.join(", ");
                }}
              />
            )}
            {settings.tips.mode !== "off" && (
              <TextRow
                icon={<IconWallet size={16} />}
                tint="#30D158"
                label="Fixed presets"
                sub={`Offered on small tickets, in ${symbol}`}
                value={settings.tips.fixedMinor.map(minorToDecimal).join(", ")}
                inputMode="decimal"
                className="mono"
                onCommit={(next) => {
                  const fixedMinor = parseMinorList(next);
                  if (!fixedMinor) {
                    toast("Enter at least one amount, such as 0.50, 1.00.", "error");
                    return settings.tips.fixedMinor.map(minorToDecimal).join(", ");
                  }
                  updateSettings({ tips: { ...settings.tips, fixedMinor } });
                  return fixedMinor.map(minorToDecimal).join(", ");
                }}
              />
            )}
            {settings.tips.mode === "percent" && (
              <TextRow
                icon={<IconWallet size={16} />}
                tint="#30D158"
                label="Show fixed presets below"
                sub={`Ticket threshold, in ${symbol}`}
                value={minorToDecimal(settings.tips.thresholdMinor)}
                inputMode="decimal"
                className="mono"
                onCommit={(next) => {
                  const parsed = parseMinorList(next);
                  if (!parsed || parsed.length !== 1) {
                    toast("Enter a single amount, such as 10.00.", "error");
                    return minorToDecimal(settings.tips.thresholdMinor);
                  }
                  updateSettings({ tips: { ...settings.tips, thresholdMinor: parsed[0] } });
                  return minorToDecimal(parsed[0]);
                }}
              />
            )}
            {settings.tips.mode !== "off" && (
              <SettingsRow
                icon={<IconPercent size={16} />}
                tint="#BF5AF2"
                label="Calculate on the net"
                sub="Use the tax-exclusive figure"
              >
                <Toggle
                  on={settings.tips.onNet}
                  label="Calculate tips on the net"
                  onChange={() =>
                    updateSettings({ tips: { ...settings.tips, onNet: !settings.tips.onNet } })
                  }
                />
              </SettingsRow>
            )}
          </div>
        </SheetBody>
      </>
    );
  }

  if (activeSheet === "settlement") {
    return (
      <>
        <ModalHeader
          title="Settlement rules"
          subtitle="Prompts only. Every movement still requires a signature."
          onClose={onClose}
        />
        <SheetBody sheet="settlement">
          <div className="list-group">
            <SettingsRow
              first
              icon={<IconSwap size={16} />}
              tint="#5E5CE6"
              label="Convert takings"
              sub={`Into ${settings.settlementAsset.code} at settlement`}
            >
              <Toggle
                on={settlementRule.autoConvert}
                label="Convert takings at settlement"
                onChange={() =>
                  changeSettlementRule({ autoConvert: !settlementRule.autoConvert })
                }
              />
            </SettingsRow>
            <SettingsRow
              icon={<IconPercent size={16} />}
              tint="#BF5AF2"
              label="Maximum slippage"
              sub="The whole swap fails above this"
            >
              <Select
                size="sm"
                className="shrink-0"
                value={String(settlementRule.maxSlippageBps)}
                options={SLIPPAGE_OPTIONS}
                ariaLabel="Maximum slippage"
                onChange={(next) => {
                  const maxSlippageBps = Number.parseInt(next, 10);
                  if (Number.isFinite(maxSlippageBps)) changeSettlementRule({ maxSlippageBps });
                }}
              />
            </SettingsRow>
            <TextRow
              icon={<IconArrowUpRight size={16} />}
              tint="#0A84FF"
              label="Sweep above"
              sub={`Prompt above this, in ${symbol}`}
              value={minorToDecimal(settlementRule.sweepAboveMinor ?? 0)}
              inputMode="decimal"
              className="mono"
              onCommit={(next) => {
                const parsed = parseMinorList(next);
                if (!parsed || parsed.length !== 1) {
                  toast("Enter a single amount, such as 500.00.", "error");
                  return minorToDecimal(settlementRule.sweepAboveMinor ?? 0);
                }
                changeSettlementRule({
                  sweepAboveMinor: parsed[0],
                  sweepPromptHour: settlementRule.sweepPromptHour ?? 21,
                });
                return minorToDecimal(parsed[0]);
              }}
            />
            <TextRow
              icon={<IconWallet size={16} />}
              tint="#30D158"
              label="Retained float"
              sub={`Never swept, in ${symbol}`}
              value={minorToDecimal(settlementRule.retainedFloatMinor)}
              inputMode="decimal"
              className="mono"
              onCommit={(next) => {
                const parsed = parseMinorList(next);
                if (!parsed || parsed.length !== 1) {
                  toast("Enter a single amount, such as 200.00.", "error");
                  return minorToDecimal(settlementRule.retainedFloatMinor);
                }
                changeSettlementRule({ retainedFloatMinor: parsed[0] });
                return minorToDecimal(parsed[0]);
              }}
            />
            <ChoiceRow
              icon={<IconShield size={16} />}
              tint="#5E5CE6"
              label="Treasury"
              sub={treasury ? formatTrezorAddress(treasury) : "No destination"}
            >
              <DraftInput
                ariaLabel="Treasury account"
                className="mono"
                placeholder="G…"
                value={treasury}
                onCommit={(next) => {
                  const sweepDestination = next.trim().toUpperCase();
                  changeSettlementRule({
                    sweepDestination: sweepDestination || null,
                    sweepPromptHour: sweepDestination
                      ? settlementRule.sweepPromptHour ?? 21
                      : null,
                  });
                  return sweepDestination;
                }}
              />
            </ChoiceRow>
            <SettingsRow
              icon={<IconClock size={16} />}
              tint="#FF9F0A"
              label="Ask at"
              sub="Local time on this device"
            >
              <Select
                size="sm"
                className="shrink-0"
                value={String(settlementRule.sweepPromptHour ?? 21)}
                options={HOUR_OPTIONS}
                ariaLabel="Hour the till offers the sweep"
                onChange={(next) => {
                  const sweepPromptHour = Number.parseInt(next, 10);
                  if (Number.isFinite(sweepPromptHour)) {
                    changeSettlementRule({ sweepPromptHour });
                  }
                }}
              />
            </SettingsRow>
          </div>
          <SettingsCaption>
            Nothing moves automatically. At {askAt}, the till offers the due swap or payment for
            review and signing.
          </SettingsCaption>

          <div className="list-group">
            {settlementHandoffs.swaps.map((intent, index) => (
              <SettingsRow
                key={intent.contextId}
                first={index === 0}
                icon={<IconSwap size={16} />}
                tint="#5E5CE6"
                label={`Convert ${intent.sourceAsset.code} in DEX Swap`}
                sub={`${fmtAmount(intent.amount)} ${intent.sourceAsset.code} → ${intent.destinationAsset.code}`}
                chevron={Boolean(onOpenSwap)}
                onClick={
                  onOpenSwap
                    ? () => {
                        onClose();
                        onOpenSwap(intent);
                      }
                    : undefined
                }
              />
            ))}
            {settlementHandoffs.swaps.length === 0 && (
              <SettingsRow
                first
                icon={<IconSwap size={16} />}
                tint="#5E5CE6"
                label="No conversion due"
                sub={
                  settlementRule.autoConvert
                    ? "No priced accepted balance is ready"
                    : "Conversion prompts are off"
                }
              />
            )}
            <SettingsRow
              icon={<IconArrowUpRight size={16} />}
              tint="#0A84FF"
              label={settlementHandoffs.sweep ? "Review treasury sweep in Send" : "No sweep due"}
              sub={
                settlementHandoffs.sweep
                  ? `${fmtAmount(settlementHandoffs.sweep.amount)} ${settlementHandoffs.sweep.asset.code} to ${formatTrezorAddress(settlementHandoffs.sweep.destination)}`
                  : treasury
                    ? `Nothing ready for ${formatTrezorAddress(treasury)}`
                    : "Add a treasury address to enable sweep prompts"
              }
              chevron={Boolean(onOpenSend && settlementHandoffs.sweep)}
              onClick={
                onOpenSend && settlementHandoffs.sweep
                  ? () => {
                      const intent = settlementHandoffs.sweep as SettlementSweepIntent;
                      onClose();
                      onOpenSend(intent);
                    }
                  : undefined
              }
            />
          </div>
          {settlementHandoffs.blocked.length > 0 && (
            <SettingsCaption tone="warn">{settlementHandoffs.blocked[0]}</SettingsCaption>
          )}

          <MerchantDisclosure label="Why a sweep never goes to zero">
            <p>Reserve, transaction fees, and refund headroom all have to remain available.</p>
            <ul className="space-y-1.5">
              <li>
                <span className="font-semibold text-neutral-200">Reserve:</span>{" "}
                <span className="mono text-neutral-300">
                  {fmtAmount(BASE_RESERVE_XLM)} × (2 + {subentries}) = {fmtAmount(reserveXlm)} XLM
                </span>
              </li>
              <li>
                <span className="font-semibold text-neutral-200">Fee headroom:</span> the account
                must still be able to pay for its next conversion, sweep, or refund.
              </li>
              <li>
                <span className="font-semibold text-neutral-200">Refund headroom:</span> a counter
                refund cannot wait for funds to return from treasury.
              </li>
            </ul>
          </MerchantDisclosure>
        </SheetBody>
      </>
    );
  }

  if (activeSheet === "device") {
    return (
      <>
        <ModalHeader
          title="This device"
          subtitle="Terminal identity and local storage"
          onClose={onClose}
        />
        <SheetBody sheet="device">
          <div className="list-group">
            <TextRow
              first
              icon={<IconTerminal size={16} />}
              tint="#5E5CE6"
              label="Terminal name"
              sub="Attributed to every order rung up here"
              value={settings.terminalName}
              placeholder="Front counter"
              onCommit={(next) => {
                const terminalName = next.trim() || "This device";
                updateSettings({ terminalName });
                return terminalName;
              }}
            />
            <SettingsRow
              icon={<IconShield size={16} />}
              tint="#30D158"
              label="Offline storage"
              sub={
                storageHealth?.usageRatio !== null && storageHealth?.usageRatio !== undefined
                  ? `${Math.round(storageHealth.usageRatio * 100)}% of available browser storage used`
                  : "Encrypted records stay on this device"
              }
              value={storageHealth?.persistence === "persistent" ? "Persistent" : "Best effort"}
              chevron={storageHealth?.persistence === "best-effort"}
              onClick={
                storageHealth?.persistence === "best-effort"
                  ? () => void handlePersistentStorage()
                  : undefined
              }
            />
          </div>
          <SettingsCaption>
            Keep an encrypted wallet backup current. Browser storage is local and can be cleared by
            the operating system unless persistence is granted.
          </SettingsCaption>
        </SheetBody>
      </>
    );
  }

  return null;
}
