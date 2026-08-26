"use client";

import type { StorageIssue } from "@/lib/storage-load";
import { Button } from "./ui";
import { IconAlert, IconDownload, LogoMark } from "./icons";

function downloadRawWallet(raw: string): void {
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `wallet-recovery-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function StorageRecoveryScreen({
  issue,
  onReset,
}: {
  issue: StorageIssue;
  onReset: () => void;
}) {
  return (
    <main className="app-safe-top flex min-h-screen items-center justify-center px-5 py-10">
      <section className="panel w-full max-w-[460px] p-6 text-center sm:p-8">
        <LogoMark size={42} />
        <span className="mx-auto mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-[#FF9F0A]/15 text-[#FF9F0A]">
          <IconAlert size={22} />
        </span>
        <h1 className="display-h mt-4 text-[24px] font-bold text-white">Wallet data needs recovery</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-neutral-400">{issue.message}</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-neutral-500">
          Nothing has been overwritten. Export the original record before deciding whether to erase it.
        </p>
        <div className="mt-7 space-y-3">
          <Button className="w-full" onClick={() => downloadRawWallet(issue.raw)}>
            <IconDownload size={16} /> Export recovery data
          </Button>
          <Button
            variant="danger"
            className="w-full"
            onClick={() => {
              if (window.confirm("Erase this device's wallet and merchant data? This cannot be undone.")) {
                onReset();
              }
            }}
          >
            Erase local data
          </Button>
        </div>
      </section>
    </main>
  );
}
