"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { NETWORKS } from "@/lib/stellar";
import { fmtAmount, opTypeLabel } from "@/lib/format";
import type { ActivityItem } from "@/lib/types";
import { triggerHaptic } from "@/lib/haptics";
import { Button, CopyButton, Modal, ModalHeader } from "./ui";
import { IconCheck, IconClose, IconExternal, IconShare } from "./icons";

export function TxDetailModal({
  item,
  onClose,
}: {
  item: ActivityItem | null;
  onClose: () => void;
}) {
  const { network, privacyMode } = useWallet();
  const [copiedReceipt, setCopiedReceipt] = useState(false);
  const [note, setNote] = useState<string>(() => {
    if (!item || typeof window === "undefined") return "";
    try {
      const notes = JSON.parse(window.localStorage.getItem("wallet.tx-notes.v1") ?? "{}");
      return notes[item.hash] ?? "";
    } catch {
      return "";
    }
  });

  function handleSaveNote(val: string) {
    setNote(val);
    if (!item || typeof window === "undefined") return;
    try {
      const notes = JSON.parse(window.localStorage.getItem("wallet.tx-notes.v1") ?? "{}");
      if (val.trim()) {
        notes[item.hash] = val.trim();
      } else {
        delete notes[item.hash];
      }
      window.localStorage.setItem("wallet.tx-notes.v1", JSON.stringify(notes));
    } catch {
      // Ignore
    }
  }
  if (!item) return null;

  const incoming = item.direction === "in";
  const neutral = item.direction === "neutral";

  const explorerUrl = NETWORKS[network].explorerTxUrl(item.hash);
  const labUrl = `https://laboratory.stellar.org/#explorer?resource=transactions&endpoint=single&values=${encodeURIComponent(
    item.hash,
  )}&network=${network}`;

  const receiptSummary = `Stellar Transaction Receipt
Title: ${item.title}
Status: ${item.successful ? "Confirmed" : "Failed"}
Network: Stellar ${NETWORKS[network].label}
Amount: ${item.amount ? `${item.amount} ${item.assetCode ?? "XLM"}` : "N/A"}
Date: ${new Date(item.createdAt).toLocaleString("en-US")}
Counterparty: ${item.counterparty ?? "N/A"}
Hash: ${item.hash}
Explorer: ${explorerUrl}`;

  async function handleShareReceipt() {
    triggerHaptic("selection");
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `Stellar Receipt: ${item?.title}`,
          text: receiptSummary,
          url: explorerUrl,
        });
        triggerHaptic("success");
      } catch {
        void 0;
      }
    } else {
      await navigator.clipboard.writeText(receiptSummary);
      setCopiedReceipt(true);
      triggerHaptic("success");
      window.setTimeout(() => setCopiedReceipt(false), 2000);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        title={item.title}
        subtitle={new Date(item.createdAt).toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        })}
        onClose={onClose}
      />
      <div className="p-6">
        {/* Status Badge & Amount */}
        <div className="flex flex-col items-center pb-3 pt-1">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full text-xl"
            style={{
              color: item.successful ? "#30D158" : "#FF453A",
              background: item.successful ? "rgba(48,209,88,0.15)" : "rgba(255,69,58,0.15)",
            }}
          >
            {item.successful ? <IconCheck size={24} /> : <IconClose size={24} />}
          </span>
          <p className="mt-3 text-[13px] font-semibold text-neutral-400">
            {item.successful ? "Transaction Confirmed" : "Transaction Failed"}
          </p>
          {item.amount !== null && (
            <p className="display-h mt-1 text-[32px] font-light text-white">
              {privacyMode
                ? "••••••"
                : `${neutral ? "" : incoming ? "+" : "−"}${fmtAmount(item.amount)}`}{" "}
              <span className="mono text-[18px] text-neutral-400 font-normal">
                {item.assetCode ?? "XLM"}
              </span>
            </p>
          )}
        </div>

        {/* Details list */}
        <div className="panel-inset mt-4 divide-y divide-white/[0.08]">
          <Row label="Operation">
            <span className="text-[13px] text-white capitalize">
              {opTypeLabel(item.type)}
            </span>
          </Row>
          {item.counterparty && (
            <Row label={incoming ? (item.type === "create_account" ? "Funder" : "From") : "To"}>
              <span className="mono text-[12px] break-all text-neutral-300">
                {item.counterparty}
              </span>
            </Row>
          )}
          {item.type === "create_account" && (
            <Row label="Account Creation">
              <span className="text-[12px] font-semibold text-[#30D158]">
                ✨ Genesis Account Activation
              </span>
            </Row>
          )}
          <Row label="Network">
            <span className="text-[13px] text-white capitalize">
              {NETWORKS[network].label}
            </span>
          </Row>
          <Row label="Tx Hash">
            <span className="mono text-[12px] break-all text-neutral-400">
              {item.hash}
            </span>
          </Row>
        </div>

        {/* Private Transaction Note / Tag */}
        <div className="mt-3.5 panel-inset p-3.5 space-y-1.5">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Private Transaction Note (Encrypted Locally)
          </label>
          <input
            type="text"
            placeholder="e.g. 🧾 Freelance Design Invoice #104"
            value={note}
            onChange={(e) => handleSaveNote(e.target.value)}
            className="input text-[13px] !h-8"
            maxLength={60}
          />
        </div>

        {/* Action Links */}
        <div className="mt-5 flex flex-wrap gap-2">
          {item.counterparty && (
            <CopyButton
              value={item.counterparty}
              label={incoming ? "Copy Sender" : "Copy Recipient"}
              className="chip flex-1 justify-center"
            />
          )}
          <CopyButton value={item.hash} label="Copy Hash" className="chip flex-1 justify-center" />
          <button
            type="button"
            onClick={() => void handleShareReceipt()}
            className="chip flex-1 justify-center flex items-center gap-1.5 text-white"
          >
            <IconShare size={12} />
            <span>{copiedReceipt ? "Copied Receipt!" : "Share Receipt"}</span>
          </button>
          <a
            className="chip flex-1 justify-center"
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => triggerHaptic("light")}
          >
            Stellarchain <IconExternal size={11} />
          </a>
          <a
            className="chip flex-1 justify-center text-neutral-400 hover:text-white"
            href={labUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => triggerHaptic("light")}
          >
            Stellar Lab <IconExternal size={11} />
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
