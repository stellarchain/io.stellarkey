import { isMerchantPinCredential } from "./pin";
import { availableRefundMinor } from "./refunds";
import type {
  MerchantStore,
  RefundReason,
  RefundRequest,
  StaffMember,
  StaffPermissions,
  StaffRole,
} from "./types";

const ROLE_PERMISSIONS: Record<StaffRole, StaffPermissions> = {
  owner: {
    takePayment: true,
    applyDiscount: true,
    comp: true,
    void: true,
    refundCeilingMinor: null,
    openDrawer: true,
    seeReports: true,
    exportRecords: true,
  },
  manager: {
    takePayment: true,
    applyDiscount: true,
    comp: true,
    void: true,
    refundCeilingMinor: 10_000,
    openDrawer: true,
    seeReports: true,
    exportRecords: true,
  },
  server: {
    takePayment: true,
    applyDiscount: true,
    comp: false,
    void: true,
    refundCeilingMinor: 2_000,
    openDrawer: true,
    seeReports: false,
    exportRecords: false,
  },
  accountant: {
    takePayment: false,
    applyDiscount: false,
    comp: false,
    void: false,
    refundCeilingMinor: 0,
    openDrawer: false,
    seeReports: true,
    exportRecords: true,
  },
};

export interface PinAttemptState {
  failures: number;
  blockedUntil: number;
}

export interface PinAttemptResult {
  state: PinAttemptState;
  blocked: boolean;
}

const MAX_PIN_FAILURES = 5;
const PIN_LOCKOUT_MS = 30_000;

export function defaultPermissionsFor(role: StaffRole): StaffPermissions {
  return { ...ROLE_PERMISSIONS[role] };
}

export function canReleaseRefund(member: StaffMember | null | undefined, amountMinor: number): boolean {
  if (!member?.active || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return false;
  const ceiling = member.permissions.refundCeilingMinor;
  return ceiling === null || (ceiling > 0 && amountMinor <= ceiling);
}

function activeOwner(store: MerchantStore, actorId: string): StaffMember {
  const actor = store.staff.find((member) => member.id === actorId);
  if (!actor?.active || actor.role !== "owner") {
    throw new Error("Only an active owner can manage staff on this device.");
  }
  return actor;
}

function cleanName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80) throw new Error("Staff names must be between 1 and 80 characters.");
  return name;
}

function validRole(value: unknown): value is StaffRole {
  return value === "owner" || value === "manager" || value === "server" || value === "accountant";
}

function validatePermissions(value: StaffPermissions): StaffPermissions {
  const switches: Array<Exclude<keyof StaffPermissions, "refundCeilingMinor">> = [
    "takePayment",
    "applyDiscount",
    "comp",
    "void",
    "openDrawer",
    "seeReports",
    "exportRecords",
  ];
  if (switches.some((key) => typeof value[key] !== "boolean")) {
    throw new Error("The staff permission matrix is invalid.");
  }
  const ceiling = value.refundCeilingMinor;
  if (ceiling !== null && (!Number.isSafeInteger(ceiling) || ceiling < 0)) {
    throw new Error("Refund ceilings must be a non-negative minor-unit amount.");
  }
  return { ...value };
}

export function addStaffMember(
  store: MerchantStore,
  actorId: string,
  input: {
    id: string;
    name: string;
    role: StaffRole;
    pinDigest: string;
    now: number;
    permissions?: StaffPermissions;
  },
): MerchantStore {
  activeOwner(store, actorId);
  if (!input.id || store.staff.some((member) => member.id === input.id)) {
    throw new Error("A staff member with this ID already exists.");
  }
  if (!validRole(input.role)) throw new Error("Choose a supported staff role.");
  if (!isMerchantPinCredential(input.pinDigest)) throw new Error("The staff PIN credential is invalid.");
  if (!Number.isSafeInteger(input.now) || input.now <= 0) throw new Error("Staff audit time is invalid.");
  const member: StaffMember = {
    id: input.id,
    name: cleanName(input.name),
    role: input.role,
    permissions: validatePermissions(input.permissions ?? defaultPermissionsFor(input.role)),
    pinDigest: input.pinDigest,
    pinSetAt: input.now,
    active: true,
  };
  return { ...store, staff: [member, ...store.staff] };
}

export function updateStaffMember(
  store: MerchantStore,
  actorId: string,
  memberId: string,
  patch: Partial<Pick<StaffMember, "name" | "role" | "permissions" | "pinDigest" | "pinSetAt" | "active">>,
): MerchantStore {
  activeOwner(store, actorId);
  const member = store.staff.find((entry) => entry.id === memberId);
  if (!member) throw new Error("That staff member no longer exists.");
  if (patch.role !== undefined && !validRole(patch.role)) throw new Error("Choose a supported staff role.");
  if (patch.pinDigest !== undefined && patch.pinDigest !== null && !isMerchantPinCredential(patch.pinDigest)) {
    throw new Error("The staff PIN credential is invalid.");
  }
  if (patch.pinSetAt !== undefined && patch.pinSetAt !== null && (!Number.isSafeInteger(patch.pinSetAt) || patch.pinSetAt <= 0)) {
    throw new Error("Staff audit time is invalid.");
  }
  const next: StaffMember = {
    ...member,
    ...patch,
    name: patch.name === undefined ? member.name : cleanName(patch.name),
    permissions:
      patch.permissions === undefined
        ? member.permissions
        : validatePermissions(patch.permissions),
  };
  if (member.active && member.role === "owner" && (!next.active || next.role !== "owner")) {
    const otherOwners = store.staff.filter(
      (entry) => entry.id !== member.id && entry.active && entry.role === "owner",
    );
    if (otherOwners.length === 0) throw new Error("The last active owner cannot be removed or demoted.");
  }
  if (patch.active === false && member.id === store.activeStaffId) {
    throw new Error("Switch operators before deactivating the active staff member.");
  }
  if (patch.active === false && store.onShiftStaffIds.includes(member.id)) {
    throw new Error("End their operator session before deactivating this staff member.");
  }
  return {
    ...store,
    staff: store.staff.map((entry) => (entry.id === memberId ? next : entry)),
  };
}

export function nextPinAttempt(
  prior: PinAttemptState,
  success: boolean,
  now: number,
): PinAttemptResult {
  if (now < prior.blockedUntil) return { state: prior, blocked: true };
  if (success) return { state: { failures: 0, blockedUntil: 0 }, blocked: false };
  const failures = (prior.blockedUntil > 0 ? 0 : prior.failures) + 1;
  if (failures >= MAX_PIN_FAILURES) {
    return {
      state: { failures, blockedUntil: now + PIN_LOCKOUT_MS },
      blocked: true,
    };
  }
  return { state: { failures, blockedUntil: 0 }, blocked: false };
}

export function createRefundRequest(
  store: MerchantStore,
  input: {
    id: string;
    orderId: string;
    amountMinor: number;
    reason: RefundReason;
    note?: string;
    requestedById: string;
    now: number;
  },
): { store: MerchantStore; request: RefundRequest } {
  const requester = store.staff.find((member) => member.id === input.requestedById);
  if (!requester?.active) throw new Error("Choose an active staff member before requesting a refund.");
  const order = store.orders.find((entry) => entry.id === input.orderId);
  if (!order) throw new Error("The order no longer exists.");
  const remaining = availableRefundMinor(store, order.id);
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || input.amountMinor > remaining) {
    throw new Error(`Only ${remaining} minor units remain refundable on this order.`);
  }
  if (canReleaseRefund(requester, input.amountMinor)) {
    throw new Error("This refund is within the active staff member's ceiling and can be released directly.");
  }
  if (store.refundRequests.some(
    (request) =>
      request.status === "pending" &&
      request.sourcePaymentId === null &&
      request.orderId === input.orderId &&
      request.amountMinor === input.amountMinor,
  )) {
    throw new Error("An identical refund request is already pending.");
  }
  const request: RefundRequest = {
    id: input.id,
    orderId: order.id,
    orderNumber: order.number,
    amountMinor: input.amountMinor,
    reason: input.reason,
    note: input.note?.trim() || null,
    sourcePaymentId: null,
    requestedById: requester.id,
    requestedBy: requester.name,
    requestedAt: input.now,
    status: "pending",
    reviewedById: null,
    reviewedAt: null,
    refundId: null,
  };
  return { store: { ...store, refundRequests: [request, ...store.refundRequests] }, request };
}

/** Request approval to return a reviewed incoming payment without refunding the sale itself. */
export function createPaymentRefundRequest(
  store: MerchantStore,
  input: {
    id: string;
    paymentId: string;
    requestedById: string;
    note?: string;
    now: number;
  },
): { store: MerchantStore; request: RefundRequest } {
  const requester = store.staff.find((member) => member.id === input.requestedById);
  if (!requester?.active) throw new Error("Choose an active staff member before requesting a refund.");
  const reconciliation = store.paymentReconciliations.find(
    (entry) => entry.id === input.paymentId,
  );
  if (!reconciliation || reconciliation.resolution) {
    throw new Error("That incoming payment is no longer available for refund.");
  }
  const order = reconciliation.orderId
    ? store.orders.find((entry) => entry.id === reconciliation.orderId) ?? null
    : null;
  const invoice = reconciliation.invoiceId
    ? store.invoices.find((entry) => entry.id === reconciliation.invoiceId) ?? null
    : null;
  const amountMinor = reconciliation.amountMinor;
  if (
    (!order && !invoice) ||
    amountMinor === null ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0
  ) {
    throw new Error("This payment has no verified sale or invoice value to approve.");
  }
  if (canReleaseRefund(requester, amountMinor)) {
    throw new Error("This refund is within the active staff member's ceiling and can be released directly.");
  }
  if (store.refundRequests.some(
    (request) => request.status === "pending" && request.sourcePaymentId === reconciliation.id,
  )) {
    throw new Error("A refund request for this payment is already pending.");
  }
  const request: RefundRequest = {
    id: input.id,
    orderId: order?.id ?? invoice?.id ?? "",
    orderNumber: order?.number ?? 0,
    invoiceId: invoice?.id ?? null,
    invoiceNumber: invoice?.number ?? null,
    amountMinor,
    reason: reconciliation.outcome === "overpaid" ? "overpayment" : "duplicate",
    note: input.note?.trim() || null,
    sourcePaymentId: reconciliation.id,
    requestedById: requester.id,
    requestedBy: requester.name,
    requestedAt: input.now,
    status: "pending",
    reviewedById: null,
    reviewedAt: null,
    refundId: null,
  };
  return {
    store: { ...store, refundRequests: [request, ...store.refundRequests] },
    request,
  };
}

/** Validate refund-review authority without pretending an outbound payment already exists. */
export function assertCanReviewRefundRequest(
  store: MerchantStore,
  input: { requestId: string; reviewerId: string },
): RefundRequest {
  const request = store.refundRequests.find((entry) => entry.id === input.requestId);
  if (!request || request.status !== "pending") {
    throw new Error("That refund request is no longer pending.");
  }
  const reviewer = store.staff.find((member) => member.id === input.reviewerId);
  if (!canReleaseRefund(reviewer, request.amountMinor)) {
    throw new Error("This refund is above the reviewer's ceiling.");
  }
  return request;
}

export function decideRefundRequest(
  store: MerchantStore,
  input: {
    requestId: string;
    reviewerId: string;
    decision: "approved" | "declined";
    now: number;
    refundId?: string;
  },
): MerchantStore {
  const request = assertCanReviewRefundRequest(store, input);
  const reviewer = store.staff.find((member) => member.id === input.reviewerId);
  if (!Number.isSafeInteger(input.now) || input.now <= 0) throw new Error("Refund audit time is invalid.");
  if (input.decision === "approved" && !input.refundId) {
    throw new Error("Approval requires the persisted signed refund result.");
  }
  if (input.decision === "approved") {
    const refund = store.refunds.find((entry) => entry.id === input.refundId);
    if (!refund) throw new Error("Approval requires the persisted signed refund result.");
    if (refund.submissionStatus === "failed") {
      throw new Error("The signed refund failed and did not move funds, so the request remains pending.");
    }
    const paymentRefundMatches =
      request.sourcePaymentId !== null &&
      refund.kind === "payment_reversal" &&
      refund.sourcePaymentId === request.sourcePaymentId;
    const orderRefundMatches = request.sourcePaymentId === null && refund.kind === "order";
    if (
      (!paymentRefundMatches && !orderRefundMatches) ||
      refund.orderId !== request.orderId ||
      refund.amountMinor !== request.amountMinor ||
      refund.reason !== request.reason
    ) {
      throw new Error("The persisted signed refund does not match this approval request.");
    }
  }
  return {
    ...store,
    refundRequests: store.refundRequests.map((entry) =>
      entry.id === request.id
        ? {
            ...entry,
            status: input.decision,
            reviewedById: reviewer?.id ?? null,
            reviewedAt: input.now,
            refundId: input.decision === "approved" ? (input.refundId ?? null) : null,
          }
        : entry,
    ),
  };
}
