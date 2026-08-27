"use client";

import { useState } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { triggerHaptic } from "@/lib/haptics";
import { fmtMinor } from "@/lib/merchant/money";
import { canReleaseRefund } from "@/lib/merchant/permissions";
import type { RefundReason, RefundRequest, StaffMember } from "@/lib/merchant/types";
import { useToast } from "../Toast";
import { Button } from "../ui";
import { IconCheck, IconClose, IconLock } from "../icons";
import { IconRefund } from "./icons";

const REASON_LABEL: Record<RefundReason, string> = {
  wrong_item: "Wrong item",
  customer_request: "Customer request",
  item_returned: "Item returned",
  duplicate: "Duplicate payment",
  overpayment: "Overpayment",
  other: "Other",
};

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function requesterOf(id: string, staff: StaffMember[]): StaffMember | undefined {
  return staff.find((member) => member.id === id);
}

export function RefundRequestsPanel({
  className = "",
}: {
  className?: string;
}) {
  const {
    settings,
    staff,
    activeStaff,
    refunds,
    refundRequests: requests,
    approveRefundRequest,
    declineRefundRequest,
  } = useMerchant();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currency = settings.currency;
  const pending = requests.filter((request) => request.status === "pending");

  async function decide(request: RefundRequest, decision: "approved" | "declined") {
    if (busyId) return;
    setBusyId(request.id);
    setError(null);
    try {
      if (decision === "approved") {
        const refund = await approveRefundRequest(request.id);
        const confirmed = refund.submissionStatus === "confirmed";
        triggerHaptic(confirmed ? "success" : "warning");
        toast(
          confirmed
            ? `Refund confirmed for ${fmtMinor(request.amountMinor, currency)}`
            : refund.submissionStatus === "status_unknown"
              ? "Refund status unknown. Do not retry while its hash is tracked."
              : "Refund approved, submitted, and confirming.",
          confirmed ? "success" : "info",
        );
      } else {
        await declineRefundRequest(request.id);
        triggerHaptic("warning");
        toast(`Declined refund request for order #${request.orderNumber}`, "info");
      }
    } catch (cause) {
      triggerHaptic("error");
      setError(cause instanceof Error ? cause.message : "The refund request could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="refund-requests-title" className={className}>
      <div className="panel">
        <div className="flex items-start gap-3 px-4 pb-3 pt-4">
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[#FF9F0A]/15 text-[#FF9F0A]">
            <IconRefund size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 id="refund-requests-title" className="text-[15.5px] font-semibold text-white">
                Refund requests
              </h2>
              {pending.length > 0 && (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#FF9F0A]/15 px-1.5 py-[2px] text-[11px] font-semibold text-[#FF9F0A]">
                  {pending.length}
                </span>
              )}
            </div>
            <p aria-live="polite" className="mt-0.5 text-[12.5px] leading-relaxed text-neutral-400">
              A refund larger than a member&rsquo;s ceiling is not refused — it is raised here for
              someone who can release it.
            </p>
            <p className="mt-1 text-[11.5px] text-neutral-500">
              Reviewing as {activeStaff?.name ?? "no active staff member"}
            </p>
          </div>
        </div>

        {error && (
          <p role="alert" className="border-t border-[#FF453A]/20 bg-[#FF453A]/10 px-4 py-3 text-[12px] text-[#FF6961]">
            {error}
          </p>
        )}

        {requests.length === 0 ? (
          <p className="border-t border-white/[0.08] px-4 py-5 text-center text-[13px] text-neutral-500">
            Nothing is waiting on approval.
          </p>
        ) : (
          requests.map((request) => {
            const requester = requesterOf(request.requestedById, staff);
            const ceiling = requester?.permissions.refundCeilingMinor ?? null;
            const reviewerCanDecide = canReleaseRefund(activeStaff, request.amountMinor);
            const linkedRefund = request.refundId
              ? refunds.find((refund) => refund.id === request.refundId) ?? null
              : null;

            return (
              <div key={request.id} className="border-t border-white/[0.08] px-4 py-3.5">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="mono text-[17px] font-semibold text-white">
                    {fmtMinor(request.amountMinor, currency)}
                  </span>
                  <span className="mono text-[13px] text-neutral-400">
                    {request.invoiceNumber ?? `#${request.orderNumber}`}
                  </span>
                  <span className="text-[11.5px] text-neutral-500">
                    {request.requestedBy} · {fmtClock(request.requestedAt)}
                  </span>
                </div>

                <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-400">
                  {REASON_LABEL[request.reason]}
                  {request.note ? ` · ${request.note}` : ""}
                  {ceiling === null
                    ? ""
                    : ceiling === 0
                      ? ` · ${request.requestedBy.split(" ")[0]} cannot release a refund at all`
                      : ` · above ${request.requestedBy.split(" ")[0]}’s ${fmtMinor(ceiling, currency)} ceiling`}
                </p>

                {request.status === "pending" ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      className="min-h-11 px-4 py-2 text-[13px]"
                      loading={busyId === request.id}
                      disabled={!reviewerCanDecide || (busyId !== null && busyId !== request.id)}
                      onClick={() => void decide(request, "approved")}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="secondary"
                      className="min-h-11 px-4 py-2 text-[13px]"
                      disabled={!reviewerCanDecide || busyId !== null}
                      onClick={() => void decide(request, "declined")}
                    >
                      Decline
                    </Button>
                    <span className="flex items-center gap-1.5 text-[11.5px] text-neutral-500">
                      <IconLock size={11} />
                      {reviewerCanDecide
                        ? "Approving still needs the vault to sign"
                        : "Switch to staff with a sufficient refund ceiling"}
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-semibold ${
                        request.status === "approved"
                          ? "bg-[#30D158]/15 text-[#30D158]"
                          : "bg-white/[0.08] text-neutral-400"
                      }`}
                    >
                      {request.status === "approved" ? <IconCheck size={10} /> : <IconClose size={10} />}
                      {request.status === "approved"
                        ? linkedRefund?.submissionStatus === "confirmed"
                          ? "Approved & confirmed"
                          : linkedRefund?.submissionStatus === "failed"
                            ? "Approved · failed"
                            : linkedRefund?.submissionStatus === "status_unknown"
                              ? "Approved · status unknown"
                              : "Approved · confirming"
                        : "Declined"}
                    </span>
                    <span className="text-[12px] leading-relaxed text-neutral-400">
                      {request.status === "approved"
                        ? `Refund record ${request.refundId ?? "saved"}. Never retry an unconfirmed hash blindly.`
                        : `Reviewed by ${staff.find((member) => member.id === request.reviewedById)?.name ?? "staff"}.`}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
