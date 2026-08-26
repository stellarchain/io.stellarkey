import type {
  CatalogueItem,
  MerchantSettings,
  MerchantStore,
  ModifierGroup,
  TaxRate,
} from "./types";

/** Portugal's rates, because the shop has to start somewhere. All editable. */
export const DEFAULT_TAX_RATES: TaxRate[] = [
  { id: "standard", label: "Standard", percent: 23 },
  { id: "intermediate", label: "Intermediate", percent: 13 },
  { id: "reduced", label: "Reduced", percent: 6 },
  { id: "exempt", label: "Exempt", percent: 0 },
];

export const DEFAULT_MODIFIER_GROUPS: ModifierGroup[] = [
  {
    id: "milk",
    name: "Milk",
    min: 0,
    max: 1,
    modifiers: [
      { id: "oat", name: "Oat", priceMinor: 40 },
      { id: "almond", name: "Almond", priceMinor: 40 },
      { id: "skimmed", name: "Skimmed", priceMinor: 0 },
    ],
  },
  {
    id: "extras",
    name: "Extras",
    min: 0,
    max: 2,
    modifiers: [
      { id: "extra-shot", name: "Extra shot", priceMinor: 60 },
      { id: "decaf", name: "Decaf", priceMinor: 0 },
      { id: "takeaway", name: "Takeaway cup", priceMinor: 10 },
    ],
  },
];

const TILE_COLOURS = ["#0A84FF", "#5E5CE6", "#FF9F0A", "#BF5AF2", "#64D2FF", "#30D158"];

function item(
  index: number,
  name: string,
  sku: string,
  category: string,
  priceMinor: number,
  taxRateId: string,
  modifierGroupIds: string[] = [],
): CatalogueItem {
  return {
    id: sku.toLowerCase(),
    name,
    sku,
    category,
    priceMinor,
    taxRateId,
    colour: TILE_COLOURS[index % TILE_COLOURS.length],
    modifierGroupIds,
    trackStock: false,
    stockOnHand: null,
    lowStockAt: null,
    active: true,
    sortIndex: index,
  };
}

/** A starter catalogue, so the till is usable the moment the shop opens. */
export const DEFAULT_CATALOGUE: CatalogueItem[] = [
  item(0, "Espresso", "ESP", "Coffee", 140, "standard", ["extras"]),
  item(1, "Cortado", "COR", "Coffee", 190, "standard", ["milk", "extras"]),
  item(2, "Flat White", "FLW", "Coffee", 320, "standard", ["milk", "extras"]),
  item(3, "Filter", "FIL", "Coffee", 280, "standard", ["extras"]),
  item(4, "Cold Brew", "CBR", "Coffee", 360, "standard", ["milk"]),
  item(5, "Pastel de Nata", "NAT", "Bakery", 160, "intermediate"),
  item(6, "Croissant", "CRO", "Bakery", 240, "intermediate"),
  item(7, "Toastie", "TST", "Kitchen", 520, "intermediate"),
  item(8, "Beans 250g", "BAG", "Retail", 1200, "standard"),
  item(9, "Keep Cup", "CUP", "Retail", 1400, "standard"),
];

/**
 * Deliberately round numbers: a testnet quote must never be mistaken for a real
 * one. USD per whole unit, so it converts through the same path a live rate does.
 */
export const TESTNET_DEMO_USD: Record<string, number> = {
  XLM: 0.25,
  USDC: 1,
  EURC: 1.1,
};

export function defaultSettings(): MerchantSettings {
  return {
    enabled: false,
    profile: {
      name: "",
      addressLines: [],
      taxId: "",
      receiptFooter: "",
    },
    receivingPublicKey: null,
    settlementAsset: { code: "XLM", issuer: null },
    acceptedAssets: [{ code: "XLM", issuer: null }],
    currency: "EUR",
    taxMode: "inclusive",
    taxRates: DEFAULT_TAX_RATES,
    defaultTaxRateId: "standard",
    tips: {
      mode: "percent",
      percents: [10, 15, 20],
      fixedMinor: [20, 50, 100],
      thresholdMinor: 1000,
      onNet: true,
    },
    chargeExpirySeconds: 600,
    toleranceBps: 150,
    toleranceFloorMinor: 2,
    holdAutoLockDuringCharge: true,
    terminalName: "This device",
    recordRetentionMonths: 120,
  };
}

export function emptyStore(): MerchantStore {
  const settings = defaultSettings();
  return {
    version: 2,
    settings,
    catalogue: DEFAULT_CATALOGUE,
    modifierGroups: DEFAULT_MODIFIER_GROUPS,
    orders: [],
    charges: [],
    refunds: [],
    unmatched: [],
    paymentReconciliations: [],
    staff: [],
    activeStaffId: null,
    shifts: [],
    invoices: [],
    counterCodes: [],
    counterPayments: [],
    customers: [],
    settlementRule: {
      autoConvert: false,
      maxSlippageBps: 100,
      sweepAboveMinor: null,
      sweepDestination: null,
      retainedFloatMinor: 0,
      sweepPromptHour: null,
    },
    adjustments: [],
    refundRequests: [],
    peripherals: [],
    exportRecords: [],
    terminal: {
      name: settings.terminalName,
      appVersion: "0.1.0",
      queuedCharges: 0,
    },
    tillTextSize: "standard",
    nextOrderNumber: 1001,
    nextShiftNumber: 1,
    nextInvoiceNumber: 1,
    cursors: {},
  };
}
