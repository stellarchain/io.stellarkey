"use client";

import { useEffect, useRef } from "react";

export const WALLET_ACCOUNT_POLL_MS = 15_000;
export const WALLET_MARKET_POLL_MS = 60_000;

export interface LatestRequest {
  signal: AbortSignal;
  isCurrent: () => boolean;
}

export interface LatestRequestLane {
  begin: () => LatestRequest;
  cancel: () => void;
}

/**
 * Owns one refresh lane. Starting newer work actively aborts the superseded
 * request and gives state publishers a cheap stale-result guard.
 */
export function createLatestRequestLane(): LatestRequestLane {
  let current: AbortController | null = null;
  let generation = 0;
  return {
    begin() {
      current?.abort(new Error("Wallet refresh was superseded."));
      const controller = new AbortController();
      current = controller;
      const requestGeneration = ++generation;
      return {
        signal: controller.signal,
        isCurrent: () =>
          generation === requestGeneration &&
          current === controller &&
          !controller.signal.aborted,
      };
    },
    cancel() {
      generation += 1;
      current?.abort(new Error("Wallet refresh was cancelled."));
      current = null;
    },
  };
}

/** Poll only while the document is visible and refresh immediately on resume. */
export function useVisibleWalletRefresh(
  refresh: () => Promise<void>,
  enabled: boolean,
  intervalMs: number,
  refreshKey: string,
): void {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    void refreshRef.current();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void refreshRef.current();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, intervalMs, refreshKey]);
}
