"use client";

/**
 * MOCK — the queue a refund lands in when it is larger than the ceiling of the
 * person asking for it.
 *
 * What is mocked: the queue itself (`MOCK_REFUND_REQUESTS`) and the ceilings it
 * is judged against (`MOCK_STAFF`). Approving or declining moves local state and
 * raises a toast; nothing is recorded and no money moves.
 *
 * What a real implementation replaces: the fixtures become the requests recorded
 * against the shift, Decline writes the outcome back to the requesting till, and
 * Approve hands the refund to the existing refund path — an ordinary outbound
 * payment, which is why it needs the vault unlocked to sign and can never be
 * released by a PIN alone. Nothing here writes, signs, or reaches Horizon.
 */

import { useState } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { triggerHaptic } from "@/lib/haptics";
import { MOCK_REFUND_REQUESTS, MOCK_STAFF } from "@/lib/merchant/mock";
import { fmtMinor } from "@/lib/merchant/money";
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

type Decision = "approved" | "declined";

/** Fixtures are UTC instants: format them in UTC so the shop reads 16:05. */
function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function requesterOf(name: string, staff: StaffMember[]): StaffMember | undefined {
  return staff.find((member) => member.name === name);
}

export function RefundRequestsPanel({
  requests = MOCK_REFUND_REQUESTS,
  staff = MOCK_STAFF,
  className = "",
}: {
  requests?: RefundRequest[];
  staff?: StaffMember[];
  className?: string;
}) {
  const { settings } = useMerchant();
  const { toast } = useToast();
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  const currency = settings.currency;
  const pending = requests.filter(
    (request) => request.status === "pending" && !decisions[request.id],
  );

  function decide(request: RefundRequest, decision: Decision) {
    triggerHaptic(decision === "approved" ? "success" : "warning");
    setDecisions((prev) => ({ ...prev, [request.id]: decision }));
    toast(
      decision === "approved"
        ? `Approved. Sending ${fmtMinor(request.amountMinor, currency)} back for order #${request.orderNumber} needs the vault unlocked to sign.`
        : `Declined. ${request.requestedBy} would see it on the till with your note.`,
      decision === "approved" ? "success" : "info",
    );
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
          </div>
        </div>

        {requests.length === 0 ? (
          <p className="border-t border-white/[0.08] px-4 py-5 text-center text-[13px] text-neutral-500">
            Nothing is waiting on approval.
          </p>
        ) : (
          requests.map((request) => {
            const decision = decisions[request.id] ?? null;
            const requester = requesterOf(request.requestedBy, staff);
            const ceiling = requester?.permissions.refundCeilingMinor ?? null;

            return (
              <div key={request.id} className="border-t border-white/[0.08] px-4 py-3.5">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="mono text-[17px] font-semibold text-white">
                    {fmtMinor(request.amountMinor, currency)}
                  </span>
                  <span className="mono text-[13px] text-neutral-400">#{request.orderNumber}</span>
                  <span className="text-[11.5px] text-neutral-500">
                    {request.requestedBy} · {fmtClock(request.requestedAt)}
                  </span>
                </div>

                <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-400">
                  {REASON_LABEL[request.reason]}
                  {ceiling === null
                    ? ""
                    : ceiling === 0
                      ? ` · ${request.requestedBy.split(" ")[0]} cannot release a refund at all`
                      : ` · above ${request.requestedBy.split(" ")[0]}’s ${fmtMinor(ceiling, currency)} ceiling`}
                </p>

                {decision === null ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      className="min-h-11 px-4 py-2 text-[13px]"
                      onClick={() => decide(request, "approved")}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="secondary"
                      className="min-h-11 px-4 py-2 text-[13px]"
                      onClick={() => decide(request, "declined")}
                    >
                      Decline
                    </Button>
                    <span className="flex items-center gap-1.5 text-[11.5px] text-neutral-500">
                      <IconLock size={11} />
                      Approving still needs the vault to sign
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-semibold ${
                        decision === "approved"
                          ? "bg-[#30D158]/15 text-[#30D158]"
                          : "bg-white/[0.08] text-neutral-400"
                      }`}
                    >
                      {decision === "approved" ? <IconCheck size={10} /> : <IconClose size={10} />}
                      {decision === "approved" ? "Approved" : "Declined"}
                    </span>
                    <span className="text-[12px] leading-relaxed text-neutral-400">
                      {decision === "approved"
                        ? "Queued as an outbound payment. Unlock the vault to sign and send it."
                        : `Sent back to ${request.requestedBy} on the till.`}
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
