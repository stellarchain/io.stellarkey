"use client";

import { useCallback, useSyncExternalStore } from "react";

export const LIVE_SECOND_MS = 1_000;
export const LIVE_MINUTE_MS = 60_000;

export function clockSnapshot(now: number, cadenceMs: number): number {
  if (!Number.isFinite(cadenceMs) || cadenceMs <= 0) {
    throw new Error("Live clock cadence must be a positive finite number.");
  }
  return Math.floor(now / cadenceMs) * cadenceMs;
}

export function useLiveNow(cadenceMs = LIVE_MINUTE_MS): number {
  const subscribe = useCallback(
    (notify: () => void) => {
      const interval = window.setInterval(notify, cadenceMs);
      const onVisible = () => {
        if (document.visibilityState === "visible") notify();
      };
      window.addEventListener("focus", notify);
      window.addEventListener("pageshow", notify);
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        window.clearInterval(interval);
        window.removeEventListener("focus", notify);
        window.removeEventListener("pageshow", notify);
        document.removeEventListener("visibilitychange", onVisible);
      };
    },
    [cadenceMs],
  );
  const getSnapshot = useCallback(
    () => clockSnapshot(Date.now(), cadenceMs),
    [cadenceMs],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
