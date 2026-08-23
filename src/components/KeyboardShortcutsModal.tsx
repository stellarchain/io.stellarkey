"use client";

import { Button, Modal, ModalHeader } from "./ui";
import { IconKeyboard } from "./icons";

interface ShortcutItem {
  keys: string[];
  description: string;
  category: "navigation" | "actions" | "security";
}

const SHORTCUTS: ShortcutItem[] = [
  { keys: ["⌘", "K"], description: "Open Command Palette", category: "navigation" },
  { keys: ["⌘", "1"], description: "Navigate to Home", category: "navigation" },
  { keys: ["⌘", "2"], description: "Navigate to Activity", category: "navigation" },
  { keys: ["⌘", "3"], description: "Navigate to DEX Swap", category: "navigation" },
  { keys: ["⌘", "4"], description: "Navigate to Contacts", category: "navigation" },
  { keys: ["⌘", "5"], description: "Navigate to Settings", category: "navigation" },
  { keys: ["⌘", "S"], description: "Quick Send Funds", category: "actions" },
  { keys: ["⌘", "R"], description: "Quick Receive / Payment Request", category: "actions" },
  { keys: ["⌘", "W"], description: "Quick DEX Asset Swap", category: "actions" },
  { keys: ["⌘", "B"], description: "Batch Multi-Recipient Send", category: "actions" },
  { keys: ["⌘", "H"], description: "Toggle Privacy Mode (Mask Balances)", category: "security" },
  { keys: ["⌘", "L"], description: "Lock Wallet Immediately", category: "security" },
  { keys: ["?"], description: "Show Keyboard Shortcuts", category: "navigation" },
];

export function KeyboardShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        title="Keyboard Shortcuts"
        subtitle="macOS & Web Pro Hotkeys"
        onClose={onClose}
      />
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-xs text-neutral-300">
          <IconKeyboard size={15} className="text-[#0A84FF] shrink-0" />
          <span>Press these keys anytime to instantly navigate and trigger actions.</span>
        </div>

        <div className="space-y-4">
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2 px-1">
              Navigation
            </h4>
            <div className="space-y-1.5 rounded-2xl bg-white/[0.02] border border-white/[0.06] p-2">
              {SHORTCUTS.filter((s) => s.category === "navigation").map((s, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-white/[0.04] transition-colors"
                >
                  <span className="text-[12.5px] text-neutral-200">{s.description}</span>
                  <div className="flex items-center gap-1">
                    {s.keys.map((k, ki) => (
                      <kbd
                        key={ki}
                        className="min-w-[22px] h-[22px] px-1.5 rounded-md bg-white/[0.08] border border-white/10 text-[11px] font-mono font-semibold text-white flex items-center justify-center shadow-xs"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2 px-1">
              Actions & Security
            </h4>
            <div className="space-y-1.5 rounded-2xl bg-white/[0.02] border border-white/[0.06] p-2">
              {SHORTCUTS.filter((s) => s.category !== "navigation").map((s, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-white/[0.04] transition-colors"
                >
                  <span className="text-[12.5px] text-neutral-200">{s.description}</span>
                  <div className="flex items-center gap-1">
                    {s.keys.map((k, ki) => (
                      <kbd
                        key={ki}
                        className="min-w-[22px] h-[22px] px-1.5 rounded-md bg-white/[0.08] border border-white/10 text-[11px] font-mono font-semibold text-white flex items-center justify-center shadow-xs"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <Button variant="ghost" className="w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
