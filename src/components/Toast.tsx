"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
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
    setToasts((prev) => [...prev.slice(-2), { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[80] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="menu fade-up pointer-events-auto flex w-full items-center gap-3 !rounded-full !py-3 pl-4 pr-5"
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
              style={{
                background:
                  t.kind === "success"
                    ? "rgba(69,214,200,0.12)"
                    : t.kind === "error"
                      ? "rgba(255,63,0,0.12)"
                      : "rgba(253,218,36,0.14)",
                color:
                  t.kind === "success"
                    ? "#45d6c8"
                    : t.kind === "error"
                      ? "#ff3f00"
                      : "#fdda24",
              }}
            >
              {t.kind === "success" ? (
                <IconCheck size={13} />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 8v5M12 16.5h.01" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              )}
            </span>
            <p className="truncate text-[13px] font-medium text-ink">{t.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
