"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useWalletIdentity, useWalletPreferences } from "@/hooks/useWallet";
import { NETWORKS, privateBalanceExplorerTxHash } from "@/lib/stellar";
import { activityAmountLines, opTypeLabel } from "@/lib/format";
import type { ActivityItem } from "@/lib/types";
import { triggerHaptic } from "@/lib/haptics";
import { loadPrivateTxNote, savePrivateTxNote } from "@/lib/vault";
import { Button, CopyButton, HashValue, ModalBody, ModalFooter } from "./ui";
import { FiatValue } from "./FiatValue";
import { IconCheck, IconClose, IconExternal, IconRefresh, IconShare, IconStellar } from "./icons";
import { activityAssetPresentation } from "@/lib/transaction-intent";

/** Header the body reports so the owning shell shows the item title and its date. */
export type TxDetailHeader = { title: string; subtitle?: string; onBack?: () => void };

export function decodePrivateMemoHex(memoHex: string | undefined): string | null {
  if (!memoHex || memoHex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(memoHex)) return null;
  try {
    const bytes = Uint8Array.from(
      memoHex.match(/.{2}/g) ?? [],
      byte => Number.parseInt(byte, 16),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export type TxDetailModalBodyProps = {
  item: ActivityItem;
  onClose: () => void;
  onHeaderChange?: (header: TxDetailHeader | null) => void;
};

export function TxDetailModalBody({ item, onClose, onHeaderChange }: TxDetailModalBodyProps) {
  const { network } = useWalletIdentity();
  const { privacyMode } = useWalletPreferences();
  const [copiedReceipt, setCopiedReceipt] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const [note, setNote] = useState("");
  const noteFieldId = useId();
  const [noteError, setNoteError] = useState<string | null>(null);

  const itemTitle = item.title;
  const itemCreatedAt = item.createdAt;
  useLayoutEffect(() => {
    if (!onHeaderChange) return;
    onHeaderChange({
      title: itemTitle,
      subtitle: new Date(itemCreatedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    });
    return () => onHeaderChange(null);
  }, [itemCreatedAt, itemTitle, onHeaderChange]);

  useEffect(() => {
    let alive = true;
    void loadPrivateTxNote(item.hash)
      .then((value) => {
        if (alive) setNote(value);
      })
      .catch((cause) => {
        if (alive) setNoteError(cause instanceof Error ? cause.message : "Unable to decrypt note.");
      });
    return () => {
      alive = false;
    };
  }, [item.hash]);

  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);

  async function handleSaveNote() {
    setNoteError(null);
    try {
      await savePrivateTxNote(item.hash, note);
    } catch (cause) {
      setNoteError(cause instanceof Error ? cause.message : "Unable to encrypt note.");
    }
  }

  const incoming = item.direction === "in";
  const presentedAsset = activityAssetPresentation(item);
  const amountLines = activityAmountLines(item);
  const privateMemo = decodePrivateMemoHex(item.private?.memoHex);
  const privateExplorerHash = item.private
    ? privateBalanceExplorerTxHash(item.private.actionKind, item.hash)
    : null;

  const explorerUrl = NETWORKS[network].explorerTxUrl(item.hash);
  const labUrl = `https://laboratory.stellar.org/#explorer?resource=transactions&endpoint=single&values=${encodeURIComponent(
    item.hash,
  )}&network=${network}`;

  const receiptSummary = `Stellar Transaction Receipt
Title: ${item.title}
Status: ${item.pending ? "Confirming" : item.successful ? "Confirmed" : "Failed"}
Network: Stellar ${NETWORKS[network].label}
Amount: ${amountLines.length > 0 ? amountLines.map((line) => line.display).join(" / ") : "N/A"}
Asset Issuer: ${item.swap ? `Debited: ${item.swap.debit.assetIssuer ?? "Native"}; Credited: ${item.swap.credit.assetIssuer ?? "Native"}` : presentedAsset.issuer ?? (presentedAsset.isNative ? "Native" : "N/A")}
Date: ${new Date(item.createdAt).toLocaleString()}
Counterparty: ${item.counterparty ?? "N/A"}
Hash: ${item.hash}
Explorer: ${explorerUrl}`;

  async function handleShareReceipt() {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `Stellar Receipt: ${item.title}`,
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
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => {
        copiedTimer.current = null;
        setCopiedReceipt(false);
      }, 2000);
    }
  }

  return (
    <ModalBody>
      {/* Status Badge & Amount */}
      <div className="flex flex-col items-center pb-1 pt-1">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full text-xl"
          style={{
            color: item.pending ? "#FF9F0A" : item.successful ? "#30D158" : "#FF453A",
            background: item.pending ? "rgba(255,159,10,0.15)" : item.successful ? "rgba(48,209,88,0.15)" : "rgba(255,69,58,0.15)",
          }}
        >
          {item.pending ? <IconRefresh size={24} /> : item.successful ? <IconCheck size={24} /> : <IconClose size={24} />}
        </span>
        <p className="mt-3 text-[13px] font-semibold text-neutral-400">
          {item.pending
            ? "Confirming on Stellar"
            : item.private
              ? "Verified locally"
            : item.successful
              ? "Transaction Confirmed"
              : "Transaction Failed"}
        </p>
        {item.swap || item.internalTransfer ? (
          <div className="mt-3 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            {amountLines.map((line) => (
              <div
                key={`${line.balance ?? "asset"}:${line.direction}`}
                className="flex items-center justify-between gap-3 py-1 first:pt-0 last:pb-0"
              >
                <span className="text-[12px] font-medium text-neutral-400">
                  {line.balance
                    ? `${line.balance === "public" ? "Public" : "Private"} balance`
                    : line.direction === "out"
                      ? "You paid"
                      : "You received"}
                </span>
                <span
                  className={`mono whitespace-nowrap text-[16px] font-semibold ${
                    line.direction === "out" ? "text-[#FF453A]" : "text-[#30D158]"
                  }`}
                >
                  {privacyMode ? "••••••" : line.display}
                </span>
              </div>
            ))}
          </div>
        ) : item.amount !== null ? (
          <p className="display-h mt-1 text-[32px] font-light text-white">
            {privacyMode ? "••••••" : amountLines[0]?.display.replace(/\s+\S+$/, "")}{" "}
            {presentedAsset.code && (
              <span className="mono text-[18px] text-neutral-400 font-normal">
                {presentedAsset.code}
              </span>
            )}
          </p>
        ) : null}
        {!item.swap && !item.internalTransfer && item.amount !== null && presentedAsset.code && (
          <FiatValue
            amount={item.amount}
            code={presentedAsset.code}
            issuer={presentedAsset.issuer}
            isNative={presentedAsset.isNative}
            className="mt-1 text-[12.5px] text-neutral-400"
          />
        )}
      </div>

      {/* Details list */}
      <div className="panel-inset divide-y divide-white/[0.08]">
        <Row label="Operation">
          <span className="text-[13px] text-white capitalize">
            {opTypeLabel(item.type)}
          </span>
        </Row>
        {item.counterparty && (
          <Row label={incoming ? (item.type === "create_account" ? "Funder" : "From") : "To"}>
            <HashValue
              value={item.counterparty}
              className="justify-end text-[12px] text-neutral-300"
            />
          </Row>
        )}
        {item.swap ? (
          <>
            {item.swap.debit.assetIssuer && (
              <Row label="Debited Issuer">
                <HashValue
                  value={item.swap.debit.assetIssuer}
                  className="justify-end text-[12px] text-neutral-300"
                />
              </Row>
            )}
            {item.swap.credit.assetIssuer && (
              <Row label="Credited Issuer">
                <HashValue
                  value={item.swap.credit.assetIssuer}
                  className="justify-end text-[12px] text-neutral-300"
                />
              </Row>
            )}
          </>
        ) : presentedAsset.issuer ? (
          <Row label="Asset Issuer">
            <HashValue
              value={presentedAsset.issuer}
              className="justify-end text-[12px] text-neutral-300"
            />
          </Row>
        ) : null}
        {item.type === "create_account" && (
          <Row label="Account Creation">
            <span className="inline-flex items-center justify-end gap-1.5 text-[12px] font-semibold text-[#30D158]">
              <IconStellar size={12} className="shrink-0" />
              <span>Genesis Account Activation</span>
            </span>
          </Row>
        )}
        <Row label="Network">
          <span className="text-[13px] text-white capitalize">
            {NETWORKS[network].label}
          </span>
        </Row>
        {item.private?.actionIndex !== undefined ? (
          <Row label="Private action">
            <span className="mono text-[13px] text-white">#{item.private.actionIndex}</span>
          </Row>
        ) : (
          <Row label="Tx Hash">
            <HashValue
              value={item.hash}
              className="justify-end text-[12px] text-neutral-400"
            />
          </Row>
        )}
        {privateExplorerHash ? (
          <Row label="Tx Hash">
            <HashValue
              value={privateExplorerHash}
              className="justify-end text-[12px] text-neutral-400"
            />
          </Row>
        ) : null}
        {item.private?.actionKind === "transfer" && (
          <Row label="Private memo">
            <span className="max-w-[65%] break-words text-right text-[13px] text-white">
              {privacyMode ? "••••••" : privateMemo ?? "None"}
            </span>
          </Row>
        )}
      </div>

      {/* Private Transaction Note / Tag */}
      <div className="panel-inset p-3.5 space-y-1.5">
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400" htmlFor={noteFieldId}>
          Private Transaction Note (Encrypted Locally)
        </label>
        <input
          id={noteFieldId}
          type="text"
          placeholder="e.g. Freelance design invoice #104"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => void handleSaveNote()}
          onKeyDown={(event) => {
            // Enter commits like Done on the iOS keyboard: leaving the field saves.
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          enterKeyHint="done"
          autoComplete="off"
          className="input text-base sm:text-[14px]"
          maxLength={60}
        />
        {noteError && <p role="alert" className="text-[11px] text-[#FF453A]">{noteError}</p>}
      </div>

      {/* Action Links */}
      {!item.private && <div className="flex flex-wrap gap-2">
        {item.counterparty && (
          <CopyButton
            value={item.counterparty}
            label={incoming ? "Copy Sender" : "Copy Recipient"}
            className="chip tap flex-1 justify-center"
          />
        )}
        <CopyButton value={item.hash} label="Copy Hash" className="chip tap flex-1 justify-center" />
        <button
          type="button"
          onClick={() => void handleShareReceipt()}
          className="chip flex-1 justify-center text-white"
        >
          <IconShare size={12} />
          <span>{copiedReceipt ? "Copied Receipt!" : "Share Receipt"}</span>
        </button>
        <a
          className="chip tap flex-1 justify-center"
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Stellarchain <IconExternal size={11} />
        </a>
        <a
          className="chip tap flex-1 justify-center text-neutral-400 hover:text-white"
          href={labUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Stellar Lab <IconExternal size={11} />
        </a>
      </div>}

      {privateExplorerHash ? (
        <div className="flex flex-wrap gap-2">
          <CopyButton value={privateExplorerHash} label="Copy Hash" className="chip tap flex-1 justify-center" />
          <a
            className="chip tap flex-1 justify-center"
            href={NETWORKS[network].explorerTxUrl(privateExplorerHash)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Stellarchain <IconExternal size={11} />
          </a>
        </div>
      ) : null}

      <ModalFooter
        primary={
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        }
      />
    </ModalBody>
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
