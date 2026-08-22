"use client";

import { useWallet } from "@/hooks/useWallet";
import { NETWORKS } from "@/lib/stellar";
import { fmtAmount, opTypeLabel } from "@/lib/format";
import type { ActivityItem } from "@/lib/types";
import { triggerHaptic } from "@/lib/haptics";
import { Button, CopyButton, Modal, ModalHeader } from "./ui";
import { IconCheck, IconExternal } from "./icons";

export function TxDetailModal({
  item,
  onClose,
}: {
  item: ActivityItem | null;
  onClose: () => void;
}) {
  const { network, privacyMode } = useWallet();
  if (!item) return null;

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        title={item.title}
        subtitle={new Date(item.createdAt).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
        onClose={onClose}
      />
      <div className="px-6 py-6">
        {/* Status Badge & Amount */}
        <div className="flex flex-col items-center pb-3 pt-1">
          <div className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30 mb-3">
            <IconCheck size={12} />
            <span>Success</span>
          </div>

          {item.amount && item.assetCode ? (
            <p className="display-h text-[32px] font-light text-white">
              {item.direction === "out" ? "−" : item.direction === "in" ? "+" : ""}
              {privacyMode ? "••••••" : fmtAmount(item.amount)}{" "}
              <span className="mono text-[20px] text-neutral-400 font-normal">
                {item.assetCode}
              </span>
            </p>
          ) : (
            <p className="text-[15px] font-medium text-neutral-300">
              {opTypeLabel(item.type)}
            </p>
          )}
        </div>

        {/* Details list */}
        <div className="panel-inset mt-4 divide-y divide-white/[0.08]">
          <Row label="Operation">
            <span className="text-[13px] text-white">{opTypeLabel(item.type)}</span>
          </Row>
          {item.counterparty && (
            <Row label={item.direction === "in" ? "From" : "To"}>
              <span className="mono text-[12px] break-all text-neutral-300">
                {item.counterparty}
              </span>
            </Row>
          )}
          <Row label="Transaction Hash">
            <span className="mono text-[12px] break-all text-neutral-300">
              {item.hash}
            </span>
          </Row>
          <Row label="Network">
            <span className="text-[13px] text-white capitalize">{NETWORKS[network].label}</span>
          </Row>
        </div>

        {/* Action Links */}
        <div className="mt-5 flex flex-wrap gap-2">
          <CopyButton value={item.hash} label="Copy Hash" className="chip flex-1 justify-center" />
          {item.counterparty && (
            <CopyButton
              value={item.counterparty}
              label="Copy Address"
              className="chip flex-1 justify-center"
            />
          )}
          <a
            className="chip flex-1 justify-center"
            href={NETWORKS[network].explorerTxUrl(item.hash)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => triggerHaptic("light")}
          >
            Stellarchain <IconExternal size={11} />
          </a>
        </div>

        <Button variant="ghost" className="mt-6 w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="shrink-0 pt-0.5 text-[13px] font-medium text-neutral-400">
        {label}
      </span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}
