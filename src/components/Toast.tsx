"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { triggerHaptic } from "@/lib/haptics";
import { TOAST_EXIT_DURATION_MS } from "@/lib/motion";
import { IconCheck } from "./icons";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  leaving: boolean;
  expiresAt: number;
}

interface ToastOptions {
  /** The caller already played outcome feedback; do not add a second haptic or sound. */
  silent?: boolean;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const TOAST_DURATION_MS = 4200;
const TOAST_SWIPE_DISMISS_PX = 24;

/** Every toast rests for the same beat; the surface contract is a fixed 4.2 s. */
export function toastDurationMs(): number {
  return TOAST_DURATION_MS;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  // Leaving toasts stay in the list for the exit animation, then unmount.
  const dismiss = useCallback((id: number) => {
    const expiresAt = performance.now() + TOAST_EXIT_DURATION_MS;
    setToasts((prev) => prev.map((t) => (
      t.id === id && !t.leaving ? { ...t, leaving: true, expiresAt } : t
    )));
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = "info", options?: ToastOptions) => {
    const id = nextId.current++;
    if (!options?.silent) {
      triggerHaptic(kind === "success" ? "success" : kind === "error" ? "error" : "light");
    }
    const expiresAt = performance.now() + toastDurationMs();
    setToasts((prev) => [...prev.slice(-2), { id, message, kind, leaving: false, expiresAt }]);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="false" aria-relevant="additions" className="app-safe-toast pointer-events-none fixed top-[4.5rem] left-1/2 z-[80] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4 md:top-auto md:bottom-6">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} onRemove={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss, onRemove }: {
  toast: Toast;
  onDismiss: (id: number) => void;
  onRemove: (id: number) => void;
}) {
  const pressRef = useRef<{ id: number; y: number } | null>(null);
  const { id, leaving, expiresAt } = toast;

  useEffect(() => {
    // Absolute deadlines survive rerenders; unmount also cancels evicted banners.
    const timer = window.setTimeout(
      () => leaving ? onRemove(id) : onDismiss(id),
      Math.max(0, Math.ceil(expiresAt - performance.now())),
    );
    return () => window.clearTimeout(timer);
  }, [id, leaving, expiresAt, onDismiss, onRemove]);

  return (
    <div
      onPointerDown={(event) => {
        pressRef.current = { id: event.pointerId, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const press = pressRef.current;
        pressRef.current = null;
        if (!press || press.id !== event.pointerId || toast.leaving) return;
        // A tap or an upward swipe both dismiss; a downward drag is left alone.
        if (press.y - event.clientY > TOAST_SWIPE_DISMISS_PX || Math.abs(event.clientY - press.y) < 6) onDismiss(toast.id);
      }}
      onPointerCancel={() => { pressRef.current = null; }}
      className={`${toast.leaving ? "toast-leave" : "toast-enter"} pointer-events-auto flex min-w-0 max-w-full cursor-default touch-pan-x select-none items-center gap-2.5 rounded-2xl border border-white/15 bg-neutral-900/95 py-2.5 pl-3.5 pr-5 shadow-[0_20px_50px_-10px_var(--shadow-strong)] backdrop-blur-2xl`}
    >
      <span
        aria-hidden="true"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        style={{
          background:
            toast.kind === "success"
              ? "rgba(48,209,88,0.2)"
              : toast.kind === "error"
                ? "rgba(255,69,58,0.2)"
                : "rgba(10,132,255,0.2)",
          color:
            toast.kind === "success"
              ? "#30D158"
              : toast.kind === "error"
                ? "#FF453A"
                : "#0A84FF",
        }}
      >
        {toast.kind === "success" ? (
          <IconCheck size={11} />
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M12 8v5M12 16.5h.01" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        )}
      </span>
      <p className="min-w-0 break-words text-[13px] font-semibold text-white tracking-tight">{toast.message}</p>
    </div>
  );
}
