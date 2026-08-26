// Type-only, so the fixture is literally the shape the till derives from
// settled orders. It is erased at build time: no module edge is added.
import type { InsightsHistory, TodaySummary } from "@/hooks/useMerchant";
import type {
  Adjustment,
  CounterCode,
  CustomerRecord,
  ExportRecord,
  Invoice,
  Minor,
  Peripheral,
  RefundRequest,
  SettlementRule,
  Shift,
  StaffMember,
  StaffPermissions,
  TaxPeriod,
  TerminalDevice,
} from "./types";

/**
 * FIXTURES FOR THE DESIGN MOCKS.
 *
 * Every screen under `src/components/merchant/` that is still a mock reads its
 * data from here and writes nothing. Replacing this module with real state is
 * the whole of "wiring it up": the shapes are the real types, so a screen that
 * renders a fixture today renders a record tomorrow without changing.
 *
 * Merchant Mode runs entirely on this device: Horizon is the only network
 * dependency, storage is local, and nothing is served from anywhere.
 *
 * Nothing in here touches even that — no Horizon, no vault, no localStorage.
 */

/** Fixed so a screenshot, a test and a demo all show the same shop. */
const DAY = 24 * 60 * 60 * 1000;
export const MOCK_NOW = Date.UTC(2026, 7, 24, 18, 12, 0);
const at = (hour: number, minute = 0) => Date.UTC(2026, 7, 24, hour, minute, 0);
const daysAgo = (n: number) => MOCK_NOW - n * DAY;

const TILL = "GAVLAAAWTBEO5XJELA3TID4XVHELGTFYRMMFRU2MQ25C5VVCBI476ZVG";
const TREASURY = "GC6HZZADIIW6XLI7IADCNEBDD5AZ7754QND7HDI5LDDWUA7HUKETYBQF";
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const EURC_ISSUER = "GCQVUN6FMPTTEI23MZ3ZPSHV5CSCYURCMF3VIPLJN47SJBMYJWLRGNDK";

export const MOCK_XLM = { code: "XLM", issuer: null } as const;
export const MOCK_USDC = { code: "USDC", issuer: USDC_ISSUER } as const;
export const MOCK_EURC = { code: "EURC", issuer: EURC_ISSUER } as const;

export const MOCK_TILL_ADDRESS = TILL;
export const MOCK_TREASURY_ADDRESS = TREASURY;

/* ---------------- staff, this device, shift ---------------- */

function permissions(over: Partial<StaffPermissions> = {}): StaffPermissions {
  return {
    takePayment: true,
    applyDiscount: true,
    comp: false,
    void: true,
    refundCeilingMinor: 2000,
    openDrawer: true,
    seeReports: false,
    exportRecords: false,
    ...over,
  };
}

export const MOCK_STAFF: StaffMember[] = [
  {
    id: "st_ana",
    name: "Ana Reis",
    role: "owner",
    permissions: permissions({
      comp: true,
      refundCeilingMinor: null,
      seeReports: true,
      exportRecords: true,
    }),
    pinDigest: "set",
    pinSetAt: daysAgo(71),
    active: true,
  },
  {
    id: "st_tomas",
    name: "Tomás Silva",
    role: "server",
    permissions: permissions({ refundCeilingMinor: 2000 }),
    pinDigest: "set",
    pinSetAt: daysAgo(54),
    active: true,
  },
  {
    id: "st_ceu",
    name: "Céu Marques",
    role: "server",
    permissions: permissions({ refundCeilingMinor: 1000, applyDiscount: false }),
    pinDigest: "set",
    pinSetAt: daysAgo(28),
    active: true,
  },
  {
    id: "st_rui",
    name: "Rui Fonseca",
    role: "accountant",
    permissions: permissions({
      takePayment: false,
      applyDiscount: false,
      void: false,
      refundCeilingMinor: 0,
      openDrawer: false,
      seeReports: true,
      exportRecords: true,
    }),
    pinDigest: null,
    pinSetAt: null,
    active: true,
  },
];

/**
 * The shop's till, singular. There is no roster to list and no block of order
 * numbers to reserve — this device mints its own sequence and shares it with
 * nobody. `queuedCharges` is deliberately non-zero: the offline specimens in
 * `OfflineStates.tsx` need a shop that is carrying something unconfirmed.
 */
export const MOCK_TERMINAL: TerminalDevice = {
  name: "Counter iPad",
  appVersion: "1.4.2",
  queuedCharges: 3,
};

export const MOCK_SHIFT: Shift = {
  id: "sh_0168",
  number: 168,
  openedAt: at(7, 30),
  closedAt: null,
  openedById: "st_ana",
  openedBy: "Ana Reis",
  closedById: null,
  closedBy: null,
  terminalName: MOCK_TERMINAL.name,
  network: "mainnet",
  floatMinor: 5000,
  // The shift is the same trading day MOCK_INSIGHTS reports, seen from the till
  // rather than from the charts, so every figure below matches it. The ledger:
  // 48,820 rung up − 465 discounted + 1,845 tipped = 50,200 taken.
  // `tests/merchant-fixtures.test.mjs` fails if the two ever drift apart.
  grossMinor: 50200,
  refundsMinor: 520,
  tipsMinor: 1845,
  discountsMinor: 465,
  compsMinor: 280,
  voidsMinor: 0,
  taxByRate: { standard: 5656, intermediate: 2083 },
  orderCount: 122,
  cash: null,
  openTabs: 2,
  zReport: null,
};

/* ---------------- a day on the counter ---------------- */

/**
 * One believable trading day, in the shape the till derives for itself from
 * settled orders. Insights reads it only while the shop has never traded, so a
 * fresh install shows a legible screen instead of an empty one; the first
 * settled charge replaces every figure below with the real thing.
 *
 * It reconciles, because a figure that does not is worse than no figure at all:
 *
 *   byHour       07:00–18:00 sums to 122 orders and 50 200 — the two headline
 *                figures, so no bar can disagree with the tile above it.
 *   avgTicket    50 200 / 122 = 411.4754 → 411.
 *   assetMix     shares 0.68 + 0.25 + 0.07 = 1, amounts 34 136 + 12 550 +
 *                3 514 = 50 200.
 *   topItems     48 100 of the 48 820 rung up. Beyond the eighth row the till
 *                stops ranking, and here the tail is Cold Brew, 2 at 720.
 *   takings      48 820 rung up − 465 discounted + 1 845 tipped = 50 200. Neither
 *                discounts nor the ranking tail is a field on this summary; they
 *                are why item revenue and takings are not the same number.
 *   taxMinor     5 656 + 2 083 = 7 739, tax-inclusive at two rates: coffee and
 *                retail at 23 % of the 30 249 payable against them, bakery and
 *                kitchen at 13 % of 18 106. That is 16.0 % blended — what a mixed
 *                basket actually collects, and not 23 % of the total.
 *
 * `taxByRate` and `refundCount` are not on `TodaySummary`: the till reads both
 * off the orders and refunds themselves. The fixture carries them so the tax
 * card and the refund card cannot contradict the summary above them.
 */
export const MOCK_INSIGHTS: TodaySummary & {
  taxByRate: { id: string; label: string; percent: number; minor: Minor }[];
  refundCount: number;
} = {
  takingsMinor: 50200,
  orderCount: 122,
  avgTicketMinor: 411,
  tipsMinor: 1845,
  taxMinor: 7739,
  refundedMinor: 520,
  refundCount: 1,

  // Two morning peaks and a lunch peak, the shape a counter actually trades in.
  byHour: [
    { hour: 7, orders: 6, takingsMinor: 1915 },
    { hour: 8, orders: 14, takingsMinor: 4680 },
    { hour: 9, orders: 17, takingsMinor: 6240 },
    { hour: 10, orders: 12, takingsMinor: 4415 },
    { hour: 11, orders: 9, takingsMinor: 3120 },
    { hour: 12, orders: 15, takingsMinor: 7860 },
    { hour: 13, orders: 16, takingsMinor: 8420 },
    { hour: 14, orders: 10, takingsMinor: 4090 },
    { hour: 15, orders: 8, takingsMinor: 3265 },
    { hour: 16, orders: 7, takingsMinor: 2740 },
    { hour: 17, orders: 5, takingsMinor: 2180 },
    { hour: 18, orders: 3, takingsMinor: 1275 },
  ],

  // Revenue is what the line was rung up at, modifiers included, which is why
  // 46 flat whites at 320 come to more than 46 × 320: eleven of them took oat.
  topItems: [
    { name: "Flat White", units: 46, revenueMinor: 15160 },
    { name: "Toastie", units: 17, revenueMinor: 8840 },
    { name: "Pastel de Nata", units: 41, revenueMinor: 6560 },
    { name: "Espresso", units: 38, revenueMinor: 5440 },
    { name: "Cortado", units: 22, revenueMinor: 4300 },
    { name: "Croissant", units: 12, revenueMinor: 2880 },
    { name: "Filter", units: 9, revenueMinor: 2520 },
    { name: "Beans 250g", units: 2, revenueMinor: 2400 },
  ],

  assetMix: [
    { asset: MOCK_USDC, takingsMinor: 34136, share: 0.68 },
    { asset: MOCK_XLM, takingsMinor: 12550, share: 0.25 },
    { asset: MOCK_EURC, takingsMinor: 3514, share: 0.07 },
  ],

  taxByRate: [
    { id: "standard", label: "Standard", percent: 23, minor: 5656 },
    { id: "intermediate", label: "Intermediate", percent: 13, minor: 2083 },
  ],
};

/**
 * What the sample day is measured against. A takings figure on its own tells a
 * shop owner nothing; the whole of Insights is the answer to "compared to
 * what?", so the fixture has to carry the comparison too.
 *
 * The sample day is Monday 24 August 2026, read at 18:12 — `MOCK_NOW`. It is a
 * good day, visibly but not absurdly:
 *
 *   last week      Monday 17 August took 44 150 across 108 orders in full, and
 *                  42 600 across 105 by 18:12. Today is measured against the
 *                  second of those, because 18:12 is not a whole day.
 *   the lead       50 200 against 42 600 to the same hour is +17.8 %, which the
 *                  screen rounds to +18 %; 122 orders against 105 is +16.2 %;
 *                  the ticket, 411 against 406, is +1.2 %. Takings ran ahead of
 *                  orders, so the ticket rose a little — the three agree.
 *   last14Days     ends on the sample day itself, so the trend line and the
 *                  headline are the same number. Sundays are closed and stay in
 *                  the series as zeros, because a shut day is information. Each
 *                  day also carries what it had taken by 18:12, so the fortnight
 *                  can be plotted like with like while today is still filling.
 *   typicalByHour  the mean of the last four Mondays, hour for hour, over the
 *                  same 07:00–18:00 `MOCK_INSIGHTS.byHour` covers, summing to
 *                  44 260 — a normal Monday, which today beats at lunch and not
 *                  much else. `tests/merchant-fixtures.test.mjs` holds both of
 *                  those to `MOCK_INSIGHTS`.
 *   hoursElapsed   18.2. The shop trades to 18:00, so 18:00 is still running:
 *                  the sample day is partial and the screen says so rather than
 *                  comparing a part day to a whole one.
 */
const sampleDayAt = (daysBack: number) => Date.UTC(2026, 7, 24 - daysBack, 10, 0, 0);

export const MOCK_INSIGHTS_HISTORY: InsightsHistory = {
  sameDayLastWeek: { takingsMinor: 44150, orderCount: 108 },
  sameDayLastWeekToDate: { takingsMinor: 42600, orderCount: 105 },

  // Oldest first. A weekly rhythm — Saturdays busy, Sundays shut — so the line
  // reads as a fortnight of trading rather than as noise.
  //
  // `toDateMinor` is the same day counted to 18:12, which is what the fortnight
  // is plotted from while today is still filling: the 18:00 hour is the only one
  // still open, so each trading day gives up most of it and a shut day gives up
  // nothing it never had. The seventh day back is 42 600 exactly, because that
  // is the figure the lead compares against.
  last14Days: [
    { at: sampleDayAt(13), takingsMinor: 43120, orderCount: 104, toDateMinor: 41660 },
    { at: sampleDayAt(12), takingsMinor: 41880, orderCount: 101, toDateMinor: 40450 },
    { at: sampleDayAt(11), takingsMinor: 45360, orderCount: 110, toDateMinor: 43810 },
    { at: sampleDayAt(10), takingsMinor: 52640, orderCount: 128, toDateMinor: 50820 },
    { at: sampleDayAt(9), takingsMinor: 58310, orderCount: 141, toDateMinor: 56290 },
    { at: sampleDayAt(8), takingsMinor: 0, orderCount: 0, toDateMinor: 0 },
    { at: sampleDayAt(7), takingsMinor: 44150, orderCount: 108, toDateMinor: 42600 },
    { at: sampleDayAt(6), takingsMinor: 42970, orderCount: 103, toDateMinor: 41480 },
    { at: sampleDayAt(5), takingsMinor: 46230, orderCount: 112, toDateMinor: 44640 },
    { at: sampleDayAt(4), takingsMinor: 44890, orderCount: 109, toDateMinor: 43350 },
    { at: sampleDayAt(3), takingsMinor: 53180, orderCount: 130, toDateMinor: 51340 },
    { at: sampleDayAt(2), takingsMinor: 60420, orderCount: 147, toDateMinor: 58330 },
    { at: sampleDayAt(1), takingsMinor: 0, orderCount: 0, toDateMinor: 0 },
    { at: sampleDayAt(0), takingsMinor: 50200, orderCount: 122, toDateMinor: 50200 },
  ],

  // The same two morning peaks and the same lunch, one Monday in four. Today
  // clears it at 12:00 and 13:00 and sits on it either side of them.
  typicalByHour: [
    { hour: 7, takingsMinor: 1690 },
    { hour: 8, takingsMinor: 4340 },
    { hour: 9, takingsMinor: 5880 },
    { hour: 10, takingsMinor: 4030 },
    { hour: 11, takingsMinor: 2930 },
    { hour: 12, takingsMinor: 6180 },
    { hour: 13, takingsMinor: 6460 },
    { hour: 14, takingsMinor: 3830 },
    { hour: 15, takingsMinor: 3010 },
    { hour: 16, takingsMinor: 2510 },
    { hour: 17, takingsMinor: 1970 },
    { hour: 18, takingsMinor: 1430 },
  ],

  hoursElapsed: 18.2,
};

/* ---------------- invoices ---------------- */

function invoiceTotals(netMinor: Minor, taxMinor: Minor) {
  return {
    grossMinor: netMinor + taxMinor,
    discountMinor: 0,
    tipMinor: 0,
    netMinor,
    taxByRate: { standard: taxMinor },
    taxMinor,
    totalMinor: netMinor + taxMinor,
  };
}

export const MOCK_INVOICES: Invoice[] = [
  {
    id: "inv_0118",
    number: "INV-2026-0118",
    status: "overdue",
    customerName: "Praça Hotel",
    customerEmail: "contas@pracahotel.pt",
    customerAddress: null,
    reference: "MCINV0118",
    network: "mainnet",
    destination: null,
    quotes: [],
    payments: [],
    lines: [
      { id: "l1", description: "Beans 250g — Gatomboya AA", quantity: 40, unitPriceMinor: 1200, taxRateId: "standard" },
      { id: "l2", description: "Delivery", quantity: 1, unitPriceMinor: 1500, taxRateId: "standard" },
    ],
    totals: invoiceTotals(40244, 9256),
    currency: "EUR",
    issuedAt: daysAgo(21),
    dueAt: daysAgo(6),
    paidAt: null,
    paidMinor: 0,
    note: "Monthly wholesale order.",
    createdAt: daysAgo(21),
    updatedAt: daysAgo(21),
    createdById: "st_ana",
    createdBy: "Ana Reis",
    issuedById: "st_ana",
    issuedBy: "Ana Reis",
    voidedAt: null,
    voidedById: null,
    voidedBy: null,
    voidReason: null,
  },
  {
    id: "inv_0117",
    number: "INV-2026-0117",
    status: "partially_paid",
    customerName: "Rua Coworking",
    customerEmail: "ops@ruacowork.pt",
    customerAddress: "GCUXWZHL7FGVL3MVYH6N5G3RACCKAC7ZLTUBKKN4I5MCCTDPJXITNGFD",
    reference: "MCINV0117",
    network: "mainnet",
    destination: null,
    quotes: [],
    payments: [],
    lines: [
      { id: "l1", description: "Office coffee subscription — August", quantity: 1, unitPriceMinor: 62000, taxRateId: "standard" },
    ],
    totals: invoiceTotals(50407, 11593),
    currency: "EUR",
    issuedAt: daysAgo(12),
    dueAt: daysAgo(-3),
    paidAt: null,
    paidMinor: 32000,
    note: null,
    createdAt: daysAgo(12),
    updatedAt: daysAgo(12),
    createdById: "st_ana",
    createdBy: "Ana Reis",
    issuedById: "st_ana",
    issuedBy: "Ana Reis",
    voidedAt: null,
    voidedById: null,
    voidedBy: null,
    voidReason: null,
  },
  {
    id: "inv_0116",
    number: "INV-2026-0116",
    status: "paid",
    customerName: "Alfama Bakery",
    customerEmail: "hello@alfamabakery.pt",
    customerAddress: "GDVPZQMATHMBM6B3V5JK4SYOFBTCVTLV4TLFNP5LMFW3NAU7D63ZFKIO",
    reference: "MCINV0116",
    network: "mainnet",
    destination: null,
    quotes: [],
    payments: [],
    lines: [
      { id: "l1", description: "Keep Cup — branded, 50 units", quantity: 50, unitPriceMinor: 1400, taxRateId: "standard" },
    ],
    totals: invoiceTotals(56911, 13089),
    currency: "EUR",
    issuedAt: daysAgo(30),
    dueAt: daysAgo(16),
    paidAt: daysAgo(18),
    paidMinor: 70000,
    note: null,
    createdAt: daysAgo(30),
    updatedAt: daysAgo(18),
    createdById: "st_ana",
    createdBy: "Ana Reis",
    issuedById: "st_ana",
    issuedBy: "Ana Reis",
    voidedAt: null,
    voidedById: null,
    voidedBy: null,
    voidReason: null,
  },
  {
    id: "inv_0119",
    number: "INV-2026-0119",
    status: "draft",
    customerName: "Baixa Studio",
    customerEmail: null,
    customerAddress: null,
    reference: "MCINV0119",
    network: "mainnet",
    destination: null,
    quotes: [],
    payments: [],
    lines: [
      { id: "l1", description: "Catering — 30 covers", quantity: 1, unitPriceMinor: 45000, taxRateId: "standard" },
    ],
    totals: invoiceTotals(36585, 8415),
    currency: "EUR",
    issuedAt: null,
    dueAt: null,
    paidAt: null,
    paidMinor: 0,
    note: "Waiting on the final headcount.",
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    createdById: "st_ana",
    createdBy: "Ana Reis",
    issuedById: null,
    issuedBy: null,
    voidedAt: null,
    voidedById: null,
    voidedBy: null,
    voidReason: null,
  },
];

/* ---------------- the sample ticket used in previews ---------------- */

/**
 * One basket, so the setup wizard, the receipt preview and the tip preview all
 * price the same sale instead of each inventing its own.
 */
export const MOCK_PREVIEW_LINES: { name: string; quantity: number; unitPriceMinor: Minor }[] = [
  { name: "Flat White", quantity: 1, unitPriceMinor: 320 },
  { name: "Pastel de Nata", quantity: 1, unitPriceMinor: 160 },
];

export const MOCK_PREVIEW_TOTAL_MINOR: Minor = MOCK_PREVIEW_LINES.reduce(
  (sum, line) => sum + line.unitPriceMinor * line.quantity,
  0,
);

/* ---------------- counter codes ---------------- */

/**
 * Each of these is a saved SEP-7 request the shop prints and stands on the
 * counter. `payments` and `takingsMinor` are what Horizon totals from the memo
 * prefix; there is no scan count, because nothing serves a page to be scanned.
 */
export const MOCK_COUNTER_CODES: CounterCode[] = [
  {
    id: "cc_tip",
    title: "Tip jar",
    kind: "tip",
    amountMinor: null,
    suggestedMinor: [100, 200, 500],
    currency: "EUR",
    acceptedAssets: [MOCK_USDC, MOCK_XLM],
    memoPrefix: "TIP",
    requestMessage: "North Star · Tip jar",
    network: "mainnet",
    destination: MOCK_TILL_ADDRESS,
    quotes: [],
    staffId: null,
    active: true,
    payments: 213,
    takingsMinor: 41880,
    expiresAt: null,
    createdAt: daysAgo(96),
    updatedAt: daysAgo(96),
    createdById: "st_ana",
    createdBy: "Ana",
  },
  {
    id: "cc_beans",
    title: "Beans 250g — Gatomboya AA",
    kind: "fixed",
    amountMinor: 1200,
    suggestedMinor: [],
    currency: "EUR",
    acceptedAssets: [MOCK_USDC, MOCK_XLM],
    memoPrefix: "BAG",
    requestMessage: "North Star · Beans 250g — Gatomboya AA",
    network: "mainnet",
    destination: MOCK_TILL_ADDRESS,
    quotes: [
      { asset: MOCK_USDC, unitPriceMinorE6: 92_000_000, amount: "13.0434783", quotedAt: daysAgo(64) },
      { asset: MOCK_XLM, unitPriceMinorE6: 25_320_000, amount: "47.3933649", quotedAt: daysAgo(64) },
    ],
    staffId: null,
    active: true,
    payments: 74,
    takingsMinor: 88800,
    expiresAt: null,
    createdAt: daysAgo(64),
    updatedAt: daysAgo(64),
    createdById: "st_ana",
    createdBy: "Ana",
  },
  {
    id: "cc_tomas",
    title: "Tip — Tomás",
    kind: "tip",
    amountMinor: null,
    suggestedMinor: [100, 200, 500],
    currency: "EUR",
    acceptedAssets: [MOCK_USDC],
    memoPrefix: "TIPT",
    requestMessage: "North Star · Tip — Tomás",
    network: "mainnet",
    destination: MOCK_TILL_ADDRESS,
    quotes: [],
    staffId: "st_tomas",
    active: true,
    payments: 32,
    takingsMinor: 6280,
    expiresAt: null,
    createdAt: daysAgo(41),
    updatedAt: daysAgo(41),
    createdById: "st_ana",
    createdBy: "Ana",
  },
  {
    id: "cc_fund",
    title: "Community fund",
    kind: "open",
    amountMinor: null,
    suggestedMinor: [500, 1000, 2500],
    currency: "EUR",
    acceptedAssets: [MOCK_USDC, MOCK_XLM],
    memoPrefix: "FUND",
    requestMessage: "North Star · Community fund",
    network: "mainnet",
    destination: MOCK_TILL_ADDRESS,
    quotes: [],
    staffId: null,
    active: false,
    payments: 9,
    takingsMinor: 12500,
    expiresAt: null,
    createdAt: daysAgo(19),
    updatedAt: daysAgo(19),
    createdById: "st_ana",
    createdBy: "Ana",
  },
];

/* ---------------- customers ---------------- */

export const MOCK_CUSTOMERS: CustomerRecord[] = [
  {
    address: "GCUXWZHL7FGVL3MVYH6N5G3RACCKAC7ZLTUBKKN4I5MCCTDPJXITNGFD",
    name: "Marta Coelho",
    firstSeenAt: daysAgo(74),
    lastSeenAt: MOCK_NOW - 2 * 60 * 1000,
    orderCount: 10,
    lifetimeMinor: 24213,
    averageMinor: 2421,
    preferredAsset: MOCK_USDC,
    loyalty: { stamps: 10, target: 10, redeemedCount: 1 },
    note: "Oat flat white, no sugar.",
  },
  {
    address: "GDVPZQMATHMBM6B3V5JK4SYOFBTCVTLV4TLFNP5LMFW3NAU7D63ZFKIO",
    name: "Alfama Bakery",
    firstSeenAt: daysAgo(120),
    lastSeenAt: daysAgo(3),
    orderCount: 26,
    lifetimeMinor: 184600,
    averageMinor: 7100,
    preferredAsset: MOCK_USDC,
    loyalty: null,
    note: null,
  },
  {
    address: "GBQKMSHEK72ZFUMUTMNQ74C5QXO6JQOL6R3WJZXGSJBSYLP7A7OPHKY6",
    name: null,
    firstSeenAt: daysAgo(38),
    lastSeenAt: daysAgo(1),
    orderCount: 9,
    lifetimeMinor: 8640,
    averageMinor: 960,
    preferredAsset: MOCK_XLM,
    loyalty: { stamps: 9, target: 10, redeemedCount: 0 },
    note: null,
  },
  {
    address: "GDUIM423AUH3OWG4AENQYQO34UWMPB4ZY7HAUMYAUE7CFDEMH3KHPBZW",
    name: null,
    firstSeenAt: daysAgo(11),
    lastSeenAt: daysAgo(11),
    orderCount: 1,
    lifetimeMinor: 320,
    averageMinor: 320,
    preferredAsset: MOCK_XLM,
    loyalty: { stamps: 1, target: 10, redeemedCount: 0 },
    note: null,
  },
];

/* ---------------- settlement ---------------- */

export const MOCK_SETTLEMENT: SettlementRule = {
  autoConvert: true,
  maxSlippageBps: 50,
  sweepAboveMinor: 50000,
  sweepDestination: TREASURY,
  retainedFloatMinor: 20000,
  sweepPromptHour: 21,
};

/* ---------------- tax and records ---------------- */

export const MOCK_TAX_PERIODS: TaxPeriod[] = [
  {
    id: "tp_aug",
    label: "August 2026",
    from: Date.UTC(2026, 7, 1),
    to: MOCK_NOW,
    grossMinor: 2390580,
    netMinor: 1956091,
    taxByRate: { standard: 401649, intermediate: 32840 },
    refundsMinor: 41260,
    orderCount: 890,
  },
  {
    id: "tp_jul",
    label: "July 2026",
    from: Date.UTC(2026, 6, 1),
    to: Date.UTC(2026, 6, 31),
    grossMinor: 2814300,
    netMinor: 2302680,
    taxByRate: { standard: 472990, intermediate: 38630 },
    refundsMinor: 52400,
    orderCount: 1043,
  },
];

export const MOCK_EXPORTS: ExportRecord[] = [
  { id: "ex_1", format: "csv", rangeLabel: "1 – 24 Aug 2026", rowCount: 890, runBy: "Rui Fonseca", runAt: daysAgo(0) - 4 * 60 * 60 * 1000 },
  { id: "ex_2", format: "json", rangeLabel: "July 2026", rowCount: 1043, runBy: "Rui Fonseca", runAt: daysAgo(23) },
  { id: "ex_3", format: "xero", rangeLabel: "Q2 2026", rowCount: 3120, runBy: "Ana Reis", runAt: daysAgo(55) },
];

export const MOCK_ADJUSTMENTS: Adjustment[] = [
  { id: "aj_1", kind: "discount", orderId: "ord_2093", orderNumber: 2093, lineId: null, lineName: null, amountMinor: 430, reasonCode: "Staff friend", staffId: "st_tomas", staffName: "Tomás Silva", at: at(17, 40) },
  { id: "aj_2", kind: "comp", orderId: "ord_2088", orderNumber: 2088, lineId: "line_2088_1", lineName: "Flat White", amountMinor: 320, reasonCode: "Remake — spilled", staffId: "st_ana", staffName: "Ana Reis", at: at(15, 12) },
  { id: "aj_3", kind: "discount", orderId: "ord_2071", orderNumber: 2071, lineId: null, lineName: null, amountMinor: 510, reasonCode: "Loyalty reward", staffId: "st_ceu", staffName: "Céu Marques", at: at(11, 24) },
  { id: "aj_4", kind: "void", orderId: "ord_2064", orderNumber: 2064, lineId: "line_2064_1", lineName: "Cold Brew", amountMinor: 360, reasonCode: "Rung twice", staffId: "st_tomas", staffName: "Tomás Silva", at: at(9, 58) },
];

export const MOCK_REFUND_REQUESTS: RefundRequest[] = [
  {
    id: "rr_1",
    orderId: "ord_2081",
    orderNumber: 2081,
    amountMinor: 4200,
    reason: "customer_request",
    note: null,
    sourcePaymentId: null,
    requestedById: "st_tomas",
    requestedBy: "Tomás Silva",
    requestedAt: at(16, 5),
    status: "pending",
    reviewedById: null,
    reviewedAt: null,
    refundId: null,
  },
];

/* ---------------- peripherals ---------------- */

export const MOCK_PERIPHERALS: Peripheral[] = [
  { id: "pr_printer", kind: "printer", name: "Star TSP143", connected: false, detail: "Bluetooth thermal · 48 columns", unavailable: true },
  { id: "pr_drawer", kind: "drawer", name: "Cash drawer", connected: false, detail: "Kicked through the printer port", unavailable: true },
  { id: "pr_scanner", kind: "scanner", name: "HID barcode scanner", connected: true, detail: "Keyboard wedge · no driver needed" },
  { id: "pr_display", kind: "display", name: "Customer display", connected: true, detail: "Rotates this screen 180°" },
];
