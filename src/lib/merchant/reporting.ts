import type { NetworkKey } from "../stellar";
import { assetKey } from "./charge";
import { distribute, linePayableMinor } from "./money";
import { indexMerchantRecords, type MerchantRecordIndex } from "./selectors";
import type {
  AcceptedAsset,
  ExportRecord,
  MerchantStore,
  Minor,
  Order,
  Refund,
  StaffMember,
  TaxPeriod,
  TenderKind,
} from "./types";

export type ReportBasis = ExportRecord["basis"];
export type ReportFormat = ExportRecord["format"];

export interface ReportRange {
  network: NetworkKey;
  /** Inclusive Unix millisecond boundary. */
  from: number;
  /** Exclusive Unix millisecond boundary. */
  to: number;
}

export interface ReportAssetTotal {
  asset: AcceptedAsset;
  amountMinor: Minor;
}

export interface MerchantReport extends ReportRange {
  grossMinor: Minor;
  netMinor: Minor;
  taxMinor: Minor;
  taxByRate: Record<string, Minor>;
  refundsMinor: Minor;
  refundCount: number;
  discountsMinor: Minor;
  orderCount: number;
  byTender: Record<TenderKind, Minor>;
  byAsset: ReportAssetTotal[];
}

export interface ReportRow {
  kind: "sale" | "refund";
  at: number;
  orderId: string;
  orderNumber: number;
  reference: string;
  lineId: string | null;
  item: string;
  quantity: number;
  netMinor: Minor;
  taxMinor: Minor;
  grossMinor: Minor;
  taxRateId: string;
  taxByRate: Record<string, Minor>;
  staffId: string | null;
  staffName: string;
  terminalName: string;
  tender: string;
  transactionHash: string | null;
  ledger: number | null;
  payerAddress: string | null;
  asset: AcceptedAsset | null;
  reason: string | null;
}

export interface ReportFile {
  fileName: string;
  mimeType: string;
  contents: string;
  rowCount: number;
}

const SETTLED_ORDER_STATUSES = new Set(["paid", "partially_refunded", "refunded"]);

function assertRange({ from, to }: Pick<ReportRange, "from" | "to">): void {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new Error("Choose a valid reporting date range.");
  }
}

function inRange(at: number | null, from: number, to: number): at is number {
  return at !== null && at >= from && at < to;
}

function ordersInRange(store: MerchantStore, range: ReportRange): Order[] {
  return store.orders
    .filter(
      (order) =>
        order.network === range.network &&
        SETTLED_ORDER_STATUSES.has(order.status) &&
        inRange(order.paidAt, range.from, range.to),
    )
    .sort((a, b) => (a.paidAt ?? 0) - (b.paidAt ?? 0) || a.id.localeCompare(b.id));
}

function refundsInRange(store: MerchantStore, range: ReportRange): Refund[] {
  return store.refunds
    .filter(
      (refund) =>
        refund.kind === "order" &&
        refund.network === range.network &&
        refund.submissionStatus === "confirmed" &&
        inRange(refund.createdAt, range.from, range.to),
    )
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function addRate(target: Record<string, Minor>, rateId: string, amount: Minor): void {
  if (amount === 0) return;
  target[rateId] = (target[rateId] ?? 0) + amount;
  if (target[rateId] === 0) delete target[rateId];
}

function paymentForOrder(index: MerchantRecordIndex, order: Order) {
  for (const tender of order.tender) {
    if (tender.kind !== "crypto" || !tender.chargeId) continue;
    const payment = index.chargesById.get(tender.chargeId)?.payment;
    if (payment) return payment;
  }
  return null;
}

function taxAllocatedToLines(order: Order): Minor[] {
  const allocated = order.lines.map(() => 0);
  for (const [rateId, taxMinor] of Object.entries(order.totals.taxByRate)) {
    const indexes = order.lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.taxRateId === rateId);
    const parts = distribute(
      taxMinor,
      indexes.map(({ line }) => linePayableMinor(line)),
    );
    indexes.forEach(({ index }, partIndex) => {
      allocated[index] = parts[partIndex] ?? 0;
    });
  }
  return allocated;
}

function netAllocatedToLines(order: Order): Minor[] {
  return distribute(
    order.totals.netMinor,
    order.lines.map((line) => linePayableMinor(line)),
  );
}

function saleRows(index: MerchantRecordIndex, order: Order): ReportRow[] {
  const taxes = taxAllocatedToLines(order);
  const nets = netAllocatedToLines(order);
  const payment = paymentForOrder(index, order);
  const tender = [...new Set(order.tender.map((part) => part.kind))].join("+");

  return order.lines.map((line, index) => {
    const taxMinor = taxes[index] ?? 0;
    const netMinor = nets[index] ?? 0;
    return {
      kind: "sale",
      at: order.paidAt ?? order.createdAt,
      orderId: order.id,
      orderNumber: order.number,
      reference: order.reference,
      lineId: line.id,
      item: line.name,
      quantity: line.quantity,
      netMinor,
      taxMinor,
      grossMinor: netMinor + taxMinor,
      taxRateId: line.taxRateId,
      taxByRate: taxMinor === 0 ? {} : { [line.taxRateId]: taxMinor },
      staffId: order.staffId,
      staffName: order.staffName,
      terminalName: order.terminalName,
      tender,
      transactionHash: payment?.transactionHash ?? null,
      ledger: payment?.ledger ?? null,
      payerAddress: payment?.from ?? order.payerAddress,
      asset: payment?.asset ?? null,
      reason: null,
    };
  });
}

function refundTaxByRate(order: Order | undefined, refund: Refund): Record<string, Minor> {
  if (!order || order.totals.taxMinor <= 0 || order.totals.totalMinor <= 0) return {};
  const taxTarget = Math.min(
    refund.amountMinor,
    Math.round((refund.amountMinor * order.totals.taxMinor) / order.totals.totalMinor),
  );
  const entries = Object.entries(order.totals.taxByRate).sort(([a], [b]) => a.localeCompare(b));
  const parts = distribute(
    taxTarget,
    entries.map(([, minor]) => minor),
  );
  return Object.fromEntries(
    entries.map(([rateId], index) => [rateId, parts[index] ?? 0]).filter(([, minor]) => minor !== 0),
  );
}

function refundRow(index: MerchantRecordIndex, refund: Refund): ReportRow {
  const order = index.ordersById.get(refund.orderId);
  const taxByRate = refundTaxByRate(order, refund);
  const taxMinor = Object.values(taxByRate).reduce((sum, minor) => sum + minor, 0);
  const grossMinor = -refund.amountMinor;
  return {
    kind: "refund",
    at: refund.createdAt,
    orderId: refund.orderId,
    orderNumber: order?.number ?? 0,
    reference: order?.reference ?? refund.orderId,
    lineId: null,
    item: "Refund",
    quantity: 1,
    netMinor: grossMinor + taxMinor,
    taxMinor: -taxMinor,
    grossMinor,
    taxRateId: Object.keys(taxByRate).length === 1 ? Object.keys(taxByRate)[0] : "mixed",
    taxByRate: Object.fromEntries(
      Object.entries(taxByRate).map(([rateId, minor]) => [rateId, -minor]),
    ),
    staffId: order?.staffId ?? null,
    staffName: order?.staffName ?? "Unknown",
    terminalName: order?.terminalName ?? "Unknown",
    tender: "refund",
    transactionHash: refund.transactionHash,
    ledger: null,
    payerAddress: refund.destination,
    asset: refund.asset,
    reason: refund.reason,
  };
}

function indexedReportRows(
  index: MerchantRecordIndex,
  orders: readonly Order[],
  refunds: readonly Refund[],
): ReportRow[] {
  const rows = orders.flatMap((order) => saleRows(index, order));
  rows.push(...refunds.map((refund) => refundRow(index, refund)));
  return rows.sort(
    (a, b) =>
      a.at - b.at ||
      a.orderNumber - b.orderNumber ||
      a.kind.localeCompare(b.kind) ||
      (a.lineId ?? "").localeCompare(b.lineId ?? ""),
  );
}

export function reportRows(store: MerchantStore, range: ReportRange): ReportRow[] {
  assertRange(range);
  return indexedReportRows(
    indexMerchantRecords(store.orders, store.charges),
    ordersInRange(store, range),
    refundsInRange(store, range),
  );
}

export function deriveReport(store: MerchantStore, range: ReportRange): MerchantReport {
  assertRange(range);
  const orders = ordersInRange(store, range);
  const refunds = refundsInRange(store, range);
  const index = indexMerchantRecords(store.orders, store.charges);
  const rows = indexedReportRows(index, orders, refunds);
  const taxByRate: Record<string, Minor> = {};
  for (const row of rows) {
    for (const [rateId, minor] of Object.entries(row.taxByRate)) addRate(taxByRate, rateId, minor);
  }

  const byTender: Record<TenderKind, Minor> = { cash: 0, card: 0, crypto: 0 };
  const assets = new Map<string, ReportAssetTotal>();
  for (const order of orders) {
    for (const tender of order.tender) {
      byTender[tender.kind] += tender.amountMinor;
      if (tender.kind !== "crypto") continue;
      const payment = tender.chargeId
        ? index.chargesById.get(tender.chargeId)?.payment
        : null;
      if (!payment) continue;
      const key = assetKey(payment.asset);
      const current = assets.get(key);
      assets.set(key, {
        asset: payment.asset,
        amountMinor: (current?.amountMinor ?? 0) + tender.amountMinor,
      });
    }
  }

  const grossMinor = rows.reduce((sum, row) => sum + row.grossMinor, 0);
  const taxMinor = Object.values(taxByRate).reduce((sum, minor) => sum + minor, 0);
  return {
    ...range,
    grossMinor,
    netMinor: grossMinor - taxMinor,
    taxMinor,
    taxByRate,
    refundsMinor: refunds.reduce((sum, refund) => sum + refund.amountMinor, 0),
    refundCount: refunds.length,
    discountsMinor: orders.reduce((sum, order) => sum + order.totals.discountMinor, 0),
    orderCount: orders.length,
    byTender,
    byAsset: [...assets.values()].sort((a, b) => assetKey(a.asset).localeCompare(assetKey(b.asset))),
  };
}

function monthStart(at: number): number {
  const date = new Date(at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function nextMonth(at: number): number {
  const date = new Date(at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

export function deriveTaxPeriods(
  store: MerchantStore,
  { network, now }: { network: NetworkKey; now: number },
): TaxPeriod[] {
  const current = monthStart(now);
  const eventTimes = [
    ...store.orders
      .filter((order) => order.network === network && SETTLED_ORDER_STATUSES.has(order.status))
      .map((order) => order.paidAt)
      .filter((at): at is number => at !== null && at <= now),
    ...store.refunds
      .filter(
        (refund) =>
          refund.kind === "order" &&
          refund.network === network &&
          refund.submissionStatus === "confirmed" &&
          refund.createdAt <= now,
      )
      .map((refund) => refund.createdAt),
  ];
  const earliest = eventTimes.length > 0 ? monthStart(Math.min(...eventTimes)) : current;
  const periods: TaxPeriod[] = [];
  for (let from = current; from >= earliest; ) {
    const to = nextMonth(from);
    const report = deriveReport(store, { network, from, to });
    const date = new Date(from);
    periods.push({
      id: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
      label: new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date),
      from,
      to,
      grossMinor: report.grossMinor,
      netMinor: report.netMinor,
      taxByRate: report.taxByRate,
      refundsMinor: report.refundsMinor,
      orderCount: report.orderCount,
    });
    const prior = new Date(from);
    from = Date.UTC(prior.getUTCFullYear(), prior.getUTCMonth() - 1, 1);
  }
  return periods;
}

function csvField(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function assetText(asset: AcceptedAsset | null): string {
  return asset ? (asset.issuer ? `${asset.code}:${asset.issuer}` : asset.code) : "";
}

const CSV_COLUMNS: { label: string; value: (row: ReportRow) => string | number | null }[] = [
  { label: "kind", value: (row) => row.kind },
  { label: "date", value: (row) => new Date(row.at).toISOString() },
  { label: "order_id", value: (row) => row.orderId },
  { label: "order_number", value: (row) => row.orderNumber },
  { label: "reference", value: (row) => row.reference },
  { label: "item", value: (row) => row.item },
  { label: "quantity", value: (row) => row.quantity },
  { label: "net_minor", value: (row) => row.netMinor },
  { label: "tax_rate_id", value: (row) => row.taxRateId },
  { label: "tax_minor", value: (row) => row.taxMinor },
  { label: "gross_minor", value: (row) => row.grossMinor },
  { label: "staff_id", value: (row) => row.staffId },
  { label: "staff", value: (row) => row.staffName },
  { label: "terminal", value: (row) => row.terminalName },
  { label: "tender", value: (row) => row.tender },
  { label: "transaction_hash", value: (row) => row.transactionHash },
  { label: "ledger", value: (row) => row.ledger },
  { label: "payer_address", value: (row) => row.payerAddress },
  { label: "asset", value: (row) => assetText(row.asset) },
  { label: "reason", value: (row) => row.reason },
];

function fileStem(network: NetworkKey, from: number, to: number): string {
  const first = new Date(from).toISOString().slice(0, 10);
  const last = new Date(Math.max(from, to - 1)).toISOString().slice(0, 10);
  return `merchant-${network}-${first}-to-${last}`;
}

export function buildReportFile(
  store: MerchantStore,
  input: ReportRange & { basis: ReportBasis; format: ReportFormat },
): ReportFile {
  assertRange(input);
  if (input.basis === "settlement") {
    throw new Error("Settlement-rate reporting is not available until conversion batches are recorded.");
  }
  if (input.format !== "csv" && input.format !== "json") {
    throw new Error(`${input.format.toUpperCase()} export is not available in this build.`);
  }
  const rows = reportRows(store, input);
  const stem = fileStem(input.network, input.from, input.to);
  if (input.format === "json") {
    return {
      fileName: `${stem}.json`,
      mimeType: "application/json;charset=utf-8",
      contents: JSON.stringify(
        {
          schema: "merchant-report/v1",
          basis: input.basis,
          network: input.network,
          from: new Date(input.from).toISOString(),
          toExclusive: new Date(input.to).toISOString(),
          summary: deriveReport(store, input),
          rows,
        },
        null,
        2,
      ),
      rowCount: rows.length,
    };
  }
  const csv = [
    CSV_COLUMNS.map((column) => csvField(column.label)).join(","),
    ...rows.map((row) => CSV_COLUMNS.map((column) => csvField(column.value(row))).join(",")),
  ].join("\r\n");
  return {
    fileName: `${stem}.csv`,
    mimeType: "text/csv;charset=utf-8",
    contents: `\uFEFF${csv}`,
    rowCount: rows.length,
  };
}

export function createReportExport(
  store: MerchantStore,
  input: ReportRange & {
    id: string;
    actor: StaffMember;
    basis: ReportBasis;
    format: ReportFormat;
    now: number;
  },
): { store: MerchantStore; file: ReportFile; record: ExportRecord } {
  const currentActor = store.staff.find((member) => member.id === input.actor.id);
  if (!currentActor?.active || !currentActor.permissions.exportRecords) {
    throw new Error("This staff member cannot export merchant records.");
  }
  if (store.exportRecords.some((record) => record.id === input.id)) {
    throw new Error("This export has already been recorded.");
  }
  const file = buildReportFile(store, input);
  const last = new Date(Math.max(input.from, input.to - 1)).toISOString().slice(0, 10);
  const record: ExportRecord = {
    id: input.id,
    format: input.format,
    basis: input.basis,
    from: input.from,
    to: input.to,
    fileName: file.fileName,
    rangeLabel: `${new Date(input.from).toISOString().slice(0, 10)} – ${last}`,
    rowCount: file.rowCount,
    runById: currentActor.id,
    runBy: currentActor.name,
    runAt: input.now,
  };
  return { store: { ...store, exportRecords: [record, ...store.exportRecords] }, file, record };
}
