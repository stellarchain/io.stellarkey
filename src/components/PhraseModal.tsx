"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { triggerHaptic } from "@/lib/haptics";
import { hasMnemonic } from "@/lib/vault";
import { Button, CopyButton, ErrorText, Modal, ModalHeader } from "./ui";
import { IconAlert, IconDownload, IconEyeOff } from "./icons";
import { PaperWalletModal } from "./PaperWalletModal";

export function PhraseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activeAccount, revealRecoveryPhrase } = useWallet();
  const hasPhrase = hasMnemonic();
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paperOpen, setPaperOpen] = useState(false);

  async function handleReveal() {
    setBusy(true);
    setError(null);
    try {
      setRevealed(await revealRecoveryPhrase(password));
      triggerHaptic("success");
    } catch (e) {
      triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Failed to decrypt.");
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    // Wipe sensitive state on close
    setRevealed(null);
    setPassword("");
    setError(null);
    onClose();
  }

  return (
    <>
      <Modal open={open} onClose={handleClose}>
        <ModalHeader
          title="Recovery Phrase"
          subtitle="Your 12 words recreate the entire wallet"
          onClose={handleClose}
        />
        <div className="px-6 pb-6 pt-5">
          <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-[#FF9F0A]/25 bg-[#FF9F0A]/10 px-3.5 py-3">
            <IconAlert size={15} className="mt-0.5 shrink-0 text-[#FF9F0A]" />
            <p className="text-[11.5px] leading-relaxed text-[#FF9F0A]">
              These words recreate your wallet at m/44&apos;/148&apos;/account&apos; (compatible with Trezor &amp; Ledger). Write them
              down safely offline — anyone with them controls your funds.
            </p>
          </div>

          {!hasPhrase ? (
            <p className="text-center text-[13.5px] text-neutral-400">
              This wallet was imported from a single secret key and has no recovery phrase.
            </p>
          ) : revealed ? (
            <>
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-[12.5px] font-semibold uppercase tracking-wider text-neutral-400">
                    12-Word Recovery Phrase
                  </span>
                  <CopyButton value={revealed} label="Copy" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {revealed.split(" ").map((word, i) => (
                    <span
                      key={`${i}-${word}`}
                      className="rounded-xl border border-white/10 bg-white/[0.04] px-2 py-2 text-center text-[13px] text-white"
                    >
                      <span className="mr-1.5 text-[10.5px] text-neutral-500">{i + 1}</span>
                      {word}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-3.5 flex flex-wrap gap-2">
                {activeAccount && (
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection");
                      setPaperOpen(true);
                    }}
                    className="chip flex items-center gap-1.5"
                  >
                    <IconDownload size={13} />
                    <span>Print Paper Wallet Certificate</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection");
                    setRevealed(null);
                    setPassword("");
                  }}
                  className="chip flex items-center gap-1.5 text-neutral-400"
                >
                  <IconEyeOff size={13} /> Hide Phrase
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  className="input flex-1 text-[13.5px]"
                  type="password"
                  placeholder="Wallet Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && password) void handleReveal();
                  }}
                />
                <Button loading={busy} disabled={!password || busy} onClick={() => void handleReveal()}>
                  Reveal
                </Button>
              </div>
              <div className="mt-3">
                <ErrorText message={error ?? ""} />
              </div>
            </>
          )}
        </div>
      </Modal>

      {paperOpen && revealed && activeAccount && (
        <PaperWalletModal
          open
          onClose={() => setPaperOpen(false)}
          accountLabel={activeAccount.label}
          publicKey={activeAccount.publicKey}
          secretOrPhrase={revealed}
          kind="mnemonic"
          path={activeAccount.path}
        />
      )}
    </>
  );
}
