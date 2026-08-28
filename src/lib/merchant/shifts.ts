import type { NetworkKey } from "../stellar";
import type {
  Adjustment,
  CashCount,
  MerchantStore,
  Minor,
  Shift,
  ShiftReport,
  ShiftStaffTotal,
  StaffMember,
  TenderKind,
} from "./types";

export type UnresolvedShiftFlowKind =
  | "order"
  | "refund_request"
  | "refund"
  | "payment";

export interface UnresolvedShiftFlow {
  kind: UnresolvedShiftFlowKind;
  id: string;
  label: string;
}

export interface OpenShiftInput {
  id: string;
  actor: StaffMember;
  terminalName: string;
  network: NetworkKey;
  floatMinor: Minor;
  now: number;
}

export interface CloseShiftInput {
  shiftId: string;
  actor: StaffMember;
  countedMinor: Minor;
  now: number;
}

function validMinor(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative minor-unit amount.`);
  }
}

function validTime(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("The shift audit time is invalid.");
}

function shiftActor(store: MerchantStore, actor: StaffMember): StaffMember {
  const current = store.staff.find((member) => member.id === actor.id);
  if (!current?.active || !current.permissions.openDrawer) {
    throw new Error("An active staff member with drawer access is required for shifts.");
  }
  return current;
}

function cleanTerminalName(value: string): string {
  const terminalName = value.trim();
  if (!terminalName || terminalName.length > 80) {
    throw new Error("The terminal name must be between 1 and 80 characters.");
  }
  return terminalName;
}

function inWindow(at: number, shift: Shift, until: number): boolean {
  return at >= shift.openedAt && at <= until;
}

function cloneAdjustment(adjustment: Adjustment): Adjustment {
  return { ...adjustment };
}

function cloneReport(report: ShiftReport): ShiftReport {
  return {
    ...report,
    taxByRate: { ...report.taxByRate },
    tenderByKind: { ...report.tenderByKind },
    staffTotals: report.staffTotals.map((line) => ({ ...line })),
    adjustments: report.adjustments.map(cloneAdjustment),
    cash: report.cash ? { ...report.cash } : null,
  };
}

export function activeShiftForTerminal(store: MerchantStore): Shift | null {
  // A local merchant store represents one physical install. The editable terminal
  // name is a receipt snapshot, not identity; renaming this device must never
  // orphan an active shift or let a second one open beside it.
  return store.shifts.find((shift) => shift.closedAt === null) ?? null;
}

export function openShift(
  store: MerchantStore,
  input: OpenShiftInput,
): { store: MerchantStore; shift: Shift } {
  const actor = shiftActor(store, input.actor);
  validMinor(input.floatMinor, "The opening float");
  validTime(input.now);
  const terminalName = cleanTerminalName(input.terminalName);
  if (!input.id || store.shifts.some((shift) => shift.id === input.id)) {
    throw new Error("A shift with this ID already exists.");
  }
  if (activeShiftForTerminal(store)) {
    throw new Error(`${terminalName} already has an open shift.`);
  }
  if (!Number.isSafeInteger(store.nextShiftNumber) || store.nextShiftNumber <= 0) {
    throw new Error("The next Z-report number is invalid.");
  }

  const shift: Shift = {
    id: input.id,
    number: store.nextShiftNumber,
    openedAt: input.now,
    closedAt: null,
    openedById: actor.id,
    openedBy: actor.name,
    closedById: null,
    closedBy: null,
    terminalName,
    network: input.network,
    floatMinor: input.floatMinor,
    grossMinor: 0,
    refundsMinor: 0,
    tipsMinor: 0,
    discountsMinor: 0,
    compsMinor: 0,
    voidsMinor: 0,
    taxByRate: {},
    orderCount: 0,
    cash: null,
    openTabs: 0,
    zReport: null,
  };
  return {
    shift,
    store: {
      ...store,
      shifts: [shift, ...store.shifts],
      nextShiftNumber: store.nextShiftNumber + 1,
    },
  };
}

function shiftOrThrow(store: MerchantStore, shiftId: string): Shift {
  const shift = store.shifts.find((entry) => entry.id === shiftId);
  if (!shift) throw new Error("That shift no longer exists.");
  return shift;
}

function scopedOrders(store: MerchantStore, shift: Shift, until: number) {
  return store.orders.filter(
    (order) =>
      order.network === shift.network &&
      order.terminalName === shift.terminalName &&
      order.createdAt <= until &&
      (order.createdAt >= shift.openedAt || (order.paidAt !== null && order.paidAt >= shift.openedAt)),
  );
}

export function unresolvedShiftFlows(
  store: MerchantStore,
  shiftId: string,
  now = Date.now(),
): UnresolvedShiftFlow[] {
  const shift = shiftOrThrow(store, shiftId);
  const until = shift.closedAt ?? now;
  const orders = scopedOrders(store, shift, until);
  const flows: UnresolvedShiftFlow[] = [];

  for (const order of orders) {
    if (order.status === "open" || order.status === "awaiting") {
      flows.push({ kind: "order", id: order.id, label: `Order #${order.number} is ${order.status}.` });
    }
  }

  for (const request of store.refundRequests) {
    if (request.status === "pending" && inWindow(request.requestedAt, shift, until)) {
      flows.push({
        kind: "refund_request",
        id: request.id,
        label: `Refund approval for order #${request.orderNumber} is pending.`,
      });
    }
  }

  for (const refund of store.refunds) {
    if (
      refund.network === shift.network &&
      (refund.submissionStatus === "prepared" ||
        refund.submissionStatus === "accepted" ||
        refund.submissionStatus === "status_unknown") &&
      inWindow(refund.createdAt, shift, until)
    ) {
      flows.push({ kind: "refund", id: refund.id, label: "A submitted refund is not final yet." });
    }
  }

  const paymentIds = new Set<string>();
  for (const record of store.paymentReconciliations) {
    if (
      record.network === shift.network &&
      record.outcome !== "settled" &&
      record.resolution === null &&
      inWindow(record.observedAt, shift, until)
    ) {
      paymentIds.add(record.id);
      flows.push({ kind: "payment", id: record.id, label: "An incoming payment still needs review." });
    }
  }
  for (const payment of store.unmatched) {
    if (!paymentIds.has(payment.id) && inWindow(payment.seenAt, shift, until)) {
      flows.push({ kind: "payment", id: payment.id, label: "An incoming payment still needs review." });
    }
  }

  return flows;
}

function deriveLiveReport(store: MerchantStore, shift: Shift, generatedAt: number): ShiftReport {
  const allOrders = scopedOrders(store, shift, generatedAt);
  const settled = allOrders.filter(
    (order) =>
      order.paidAt !== null &&
      inWindow(order.paidAt, shift, generatedAt) &&
      (order.status === "paid" || order.status === "refunded" || order.status === "partially_refunded"),
  );
  const scopedOrderIds = new Set(allOrders.map((order) => order.id));
  const adjustments = store.adjustments
    .filter(
      (adjustment) =>
        scopedOrderIds.has(adjustment.orderId) && inWindow(adjustment.at, shift, generatedAt),
    )
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .map(cloneAdjustment);
  const confirmedRefunds = store.refunds.filter(
    (refund) =>
      refund.kind === "order" &&
      refund.network === shift.network &&
      refund.submissionStatus === "confirmed" &&
      inWindow(refund.createdAt, shift, generatedAt),
  );

  const taxByRate: Record<string, Minor> = {};
  const tenderByKind: Record<TenderKind, Minor> = { cash: 0, card: 0, crypto: 0 };
  const staff = new Map<string, ShiftStaffTotal>();
  let grossMinor = 0;
  let tipsMinor = 0;

  for (const order of settled) {
    grossMinor += order.totals.totalMinor;
    tipsMinor += order.totals.tipMinor;
    for (const [rateId, amountMinor] of Object.entries(order.totals.taxByRate)) {
      taxByRate[rateId] = (taxByRate[rateId] ?? 0) + amountMinor;
    }
    for (const tender of order.tender) {
      tenderByKind[tender.kind] += tender.amountMinor;
    }
    const key = order.staffId ?? `name:${order.staffName}`;
    const current = staff.get(key) ?? {
      staffId: order.staffId,
      staffName: order.staffName,
      orderCount: 0,
      takingsMinor: 0,
      tipsMinor: 0,
    };
    current.orderCount += 1;
    current.takingsMinor += order.totals.totalMinor;
    current.tipsMinor += order.totals.tipMinor;
    staff.set(key, current);
  }

  const sumAdjustment = (kind: Adjustment["kind"]): Minor =>
    adjustments.reduce((sum, adjustment) => sum + (adjustment.kind === kind ? adjustment.amountMinor : 0), 0);
  const openTabs = allOrders.filter((order) => order.status === "open" || order.status === "awaiting").length;

  return {
    kind: "x",
    shiftId: shift.id,
    sequence: shift.number,
    terminalName: shift.terminalName,
    network: shift.network,
    openedAt: shift.openedAt,
    generatedAt,
    openedById: shift.openedById,
    openedBy: shift.openedBy,
    closedById: null,
    closedBy: null,
    floatMinor: shift.floatMinor,
    grossMinor,
    refundsMinor: confirmedRefunds.reduce((sum, refund) => sum + refund.amountMinor, 0),
    tipsMinor,
    discountsMinor: sumAdjustment("discount"),
    compsMinor: sumAdjustment("comp"),
    voidsMinor: sumAdjustment("void"),
    taxByRate,
    tenderByKind,
    expectedCashMinor: shift.floatMinor + tenderByKind.cash,
    orderCount: settled.length,
    staffTotals: [...staff.values()].sort(
      (a, b) => b.takingsMinor - a.takingsMinor || a.staffName.localeCompare(b.staffName),
    ),
    adjustments,
    openTabs,
    cash: null,
  };
}

export function buildShiftReport(
  store: MerchantStore,
  shiftId: string,
  generatedAt = Date.now(),
): ShiftReport {
  validTime(generatedAt);
  const shift = shiftOrThrow(store, shiftId);
  if (shift.closedAt !== null) {
    if (!shift.zReport) throw new Error("This legacy shift does not contain an immutable Z-report.");
    return cloneReport(shift.zReport);
  }
  if (generatedAt < shift.openedAt) throw new Error("A report cannot predate its shift.");
  return deriveLiveReport(store, shift, generatedAt);
}

export function closeShift(
  store: MerchantStore,
  input: CloseShiftInput,
): { store: MerchantStore; shift: Shift; report: ShiftReport } {
  const actor = shiftActor(store, input.actor);
  validMinor(input.countedMinor, "The drawer count");
  validTime(input.now);
  const shift = shiftOrThrow(store, input.shiftId);
  if (shift.closedAt !== null) throw new Error(`Shift ${shift.number} is already closed.`);
  if (input.now < shift.openedAt) throw new Error("A shift cannot close before it opened.");
  const unresolved = unresolvedShiftFlows(store, shift.id, input.now);
  if (unresolved.length > 0) {
    throw new Error(
      `This shift cannot close while ${unresolved.length} unresolved ${unresolved.length === 1 ? "flow remains" : "flows remain"}.`,
    );
  }

  const live = deriveLiveReport(store, shift, input.now);
  const cash: CashCount = {
    countedMinor: input.countedMinor,
    expectedMinor: live.expectedCashMinor,
    varianceMinor: input.countedMinor - live.expectedCashMinor,
  };
  const report: ShiftReport = {
    ...live,
    kind: "z",
    generatedAt: input.now,
    closedById: actor.id,
    closedBy: actor.name,
    cash,
  };
  const closed: Shift = {
    ...shift,
    closedAt: input.now,
    closedById: actor.id,
    closedBy: actor.name,
    grossMinor: report.grossMinor,
    refundsMinor: report.refundsMinor,
    tipsMinor: report.tipsMinor,
    discountsMinor: report.discountsMinor,
    compsMinor: report.compsMinor,
    voidsMinor: report.voidsMinor,
    taxByRate: { ...report.taxByRate },
    orderCount: report.orderCount,
    cash,
    openTabs: 0,
    zReport: cloneReport(report),
  };
  return {
    shift: closed,
    report: cloneReport(report),
    store: {
      ...store,
      shifts: store.shifts.map((entry) => (entry.id === closed.id ? closed : entry)),
    },
  };
}
