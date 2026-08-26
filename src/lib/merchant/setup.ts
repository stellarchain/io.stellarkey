import { Asset, StrKey } from "@stellar/stellar-sdk";
import type { FiatCurrency } from "../format";
import { isMerchantPinCredential } from "./pin";
import type {
  AcceptedAsset,
  MerchantProfile,
  MerchantSettings,
  MerchantStore,
  StaffMember,
  TaxMode,
  TaxRate,
  TillTextSize,
  TipSettings,
} from "./types";

const CURRENCIES = new Set<FiatCurrency>(["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"]);
const TEXT_SIZES = new Set<TillTextSize>(["standard", "large", "xlarge"]);

export const OWNER_PERMISSIONS: StaffMember["permissions"] = {
  takePayment: true,
  applyDiscount: true,
  comp: true,
  void: true,
  refundCeilingMinor: null,
  openDrawer: true,
  seeReports: true,
  exportRecords: true,
};

export interface MerchantSetupInput {
  profile: MerchantProfile;
  receivingPublicKey: string;
  settlementAsset: AcceptedAsset;
  acceptedAssets: AcceptedAsset[];
  currency: FiatCurrency;
  taxMode: TaxMode;
  taxRates: TaxRate[];
  tips: TipSettings;
  chargeExpirySeconds: number;
  terminalName: string;
  textSize: TillTextSize;
  ownerName: string;
  pinDigest: string;
}

export interface MerchantSetupMetadata {
  now: number;
  ownerId: string;
}

function cleanAsset(asset: AcceptedAsset): AcceptedAsset {
  const code = asset.code.trim().toUpperCase();
  const issuer = asset.issuer?.trim() || null;
  if (issuer === null) {
    if (code !== "XLM") throw new Error("Only XLM can be stored as the native asset.");
    return { code: "XLM", issuer: null };
  }
  if (!StrKey.isValidEd25519PublicKey(issuer)) throw new Error(`${code || "Asset"} has an invalid issuer.`);
  try {
    void new Asset(code, issuer);
  } catch {
    throw new Error("Accepted asset codes must follow Stellar asset rules.");
  }
  return { code, issuer };
}

function assetIdentity(asset: AcceptedAsset): string {
  return `${asset.code}:${asset.issuer ?? "native"}`;
}

function cleanProfile(profile: MerchantProfile): MerchantProfile {
  const name = profile.name.trim();
  if (!name) throw new Error("The shop needs a name.");
  if (name.length > 80) throw new Error("The shop name must be 80 characters or fewer.");
  return {
    name,
    addressLines: profile.addressLines.map((line) => line.trim()).filter(Boolean).slice(0, 8),
    taxId: profile.taxId.trim().slice(0, 80),
    receiptFooter: profile.receiptFooter.trim().slice(0, 240),
  };
}

function cleanTaxRates(rates: TaxRate[]): TaxRate[] {
  if (!Array.isArray(rates) || rates.length === 0) throw new Error("Add at least one tax rate.");
  const ids = new Set<string>();
  return rates.map((rate) => {
    const id = rate.id.trim();
    const label = rate.label.trim();
    if (!id || !label || ids.has(id)) throw new Error("Tax rates need unique names and IDs.");
    if (!Number.isFinite(rate.percent) || rate.percent < 0 || rate.percent > 100) {
      throw new Error("Every tax rate must be between 0 and 100 percent.");
    }
    ids.add(id);
    return { id, label, percent: rate.percent };
  });
}

function cleanTips(tips: TipSettings): TipSettings {
  if (tips.mode !== "off" && tips.mode !== "percent" && tips.mode !== "fixed") {
    throw new Error("Choose a supported tip mode.");
  }
  const percents = tips.percents.filter(
    (value) => Number.isFinite(value) && value > 0 && value <= 100,
  );
  const fixedMinor = tips.fixedMinor.filter(
    (value) => Number.isSafeInteger(value) && value > 0,
  );
  if (tips.mode === "percent" && percents.length === 0) {
    throw new Error("Percentage tips need at least one valid preset.");
  }
  if (tips.mode === "fixed" && fixedMinor.length === 0) {
    throw new Error("Fixed tips need at least one valid preset.");
  }
  if (!Number.isSafeInteger(tips.thresholdMinor) || tips.thresholdMinor < 0) {
    throw new Error("The tip threshold must be a positive minor-unit amount.");
  }
  return {
    mode: tips.mode,
    percents: [...new Set(percents)],
    fixedMinor: [...new Set(fixedMinor)],
    thresholdMinor: tips.thresholdMinor,
    onNet: Boolean(tips.onNet),
  };
}

export function needsMerchantSetup(
  settings: MerchantSettings,
  staff: StaffMember[],
): boolean {
  const hasOwner = staff.some(
    (member) => member.active && member.role === "owner" && isMerchantPinCredential(member.pinDigest),
  );
  return !settings.profile.name.trim() || !settings.receivingPublicKey || !hasOwner;
}

/** Validate every field before producing a new store; the input store is untouched on failure. */
export function completeMerchantSetup(
  store: MerchantStore,
  input: MerchantSetupInput,
  metadata: MerchantSetupMetadata,
): MerchantStore {
  const profile = cleanProfile(input.profile);
  const receivingPublicKey = input.receivingPublicKey.trim();
  if (!StrKey.isValidEd25519PublicKey(receivingPublicKey)) {
    throw new Error("Choose a valid Stellar receiving account.");
  }
  if (!CURRENCIES.has(input.currency)) throw new Error("Choose a supported display currency.");
  if (input.taxMode !== "inclusive" && input.taxMode !== "added") {
    throw new Error("Choose how tax is applied.");
  }
  const taxRates = cleanTaxRates(input.taxRates);
  const acceptedAssets = input.acceptedAssets.map(cleanAsset);
  if (acceptedAssets.length === 0) throw new Error("Accept at least one payment asset.");
  const identities = acceptedAssets.map(assetIdentity);
  if (new Set(identities).size !== identities.length) {
    throw new Error("Each accepted asset can appear only once.");
  }
  const settlementAsset = cleanAsset(input.settlementAsset);
  if (!identities.includes(assetIdentity(settlementAsset))) {
    throw new Error("The settlement asset must also be accepted.");
  }
  if (!Number.isSafeInteger(input.chargeExpirySeconds) || input.chargeExpirySeconds < 60 || input.chargeExpirySeconds > 86_400) {
    throw new Error("Charge expiry must be between one minute and one day.");
  }
  const terminalName = input.terminalName.trim();
  if (!terminalName || terminalName.length > 80) throw new Error("Give this terminal a short name.");
  const ownerName = input.ownerName.trim();
  if (!ownerName || ownerName.length > 80) throw new Error("Give the owner a name.");
  if (!TEXT_SIZES.has(input.textSize)) throw new Error("Choose a supported till text size.");
  if (!isMerchantPinCredential(input.pinDigest)) throw new Error("The merchant PIN credential is invalid.");
  if (!Number.isSafeInteger(metadata.now) || metadata.now <= 0 || !metadata.ownerId) {
    throw new Error("Setup audit metadata is invalid.");
  }

  const tips = cleanTips(input.tips);
  const defaultTaxRateId = taxRates.some((rate) => rate.id === store.settings.defaultTaxRateId)
    ? store.settings.defaultTaxRateId
    : taxRates[0].id;
  const existingOwner = store.staff.find((member) => member.role === "owner");
  const owner: StaffMember = {
    id: existingOwner?.id ?? metadata.ownerId,
    name: ownerName,
    role: "owner",
    permissions: { ...OWNER_PERMISSIONS },
    pinDigest: input.pinDigest,
    pinSetAt: metadata.now,
    active: true,
  };
  const staff = existingOwner
    ? store.staff.map((member) => (member.id === existingOwner.id ? owner : member))
    : [owner, ...store.staff];

  return {
    ...store,
    settings: {
      ...store.settings,
      enabled: true,
      profile,
      receivingPublicKey,
      settlementAsset,
      acceptedAssets,
      currency: input.currency,
      taxMode: input.taxMode,
      taxRates,
      defaultTaxRateId,
      tips,
      chargeExpirySeconds: input.chargeExpirySeconds,
      terminalName,
    },
    staff,
    activeStaffId: owner.id,
    terminal: { ...store.terminal, name: terminalName },
    tillTextSize: input.textSize,
  };
}
