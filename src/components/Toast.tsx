"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { triggerHaptic } from "@/lib/haptics";
import { IconCheck } from "./icons";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId.current++;
    triggerHaptic(kind === "success" ? "success" : kind === "error" ? "error" : "light");
    setToasts((prev) => [...prev.slice(-2), { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* iOS Dynamic Island style floating pill toast */}
      <div className="pointer-events-none fixed top-5 left-1/2 z-[80] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="fade-up pointer-events-auto flex items-center gap-2.5 rounded-full border border-white/15 bg-neutral-900/90 py-2.5 pl-3.5 pr-5 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.9)] backdrop-blur-2xl transition-all"
          >
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
              style={{
                background:
                  t.kind === "success"
                    ? "rgba(48,209,88,0.2)"
                    : t.kind === "error"
                      ? "rgba(255,69,58,0.2)"
                      : "rgba(10,132,255,0.2)",
                color:
                  t.kind === "success"
                    ? "#30D158"
                    : t.kind === "error"
                      ? "#FF453A"
                      : "#0A84FF",
              }}
            >
              {t.kind === "success" ? (
                <IconCheck size={11} />
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M12 8v5M12 16.5h.01" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              )}
            </span>
            <p className="truncate text-[13px] font-semibold text-white tracking-tight">{t.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
