"use client";

import { useEffect, useRef } from "react";

export const WALLET_ACCOUNT_POLL_MS = 15_000;
export const WALLET_STREAM_SAFETY_POLL_MS = 60_000;
export const WALLET_BACKGROUND_POLL_MS = 120_000;
export const WALLET_MARKET_POLL_MS = 60_000;

export type HorizonStreamState = "connecting" | "open" | "degraded";

export function horizonStreamPollInterval(state: HorizonStreamState): number {
  return state === "open" ? WALLET_STREAM_SAFETY_POLL_MS : WALLET_ACCOUNT_POLL_MS;
}

/** Stable sub-15-second offset so background portfolios do not burst with the active account. */
export function walletBackgroundStaggerMs(identity: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return 1_000 + ((hash >>> 0) % 4_000);
}

export interface LatestRequest {
  signal: AbortSignal;
  isCurrent: () => boolean;
}

export interface LatestRequestLane {
  begin: () => LatestRequest;
  cancel: () => void;
}

interface VisibleRefreshDocument {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

interface VisibleRefreshTimers {
  setInterval(callback: () => void, delay: number): number;
  clearInterval(id: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number): void;
}

export function createVisibleWalletRefreshScheduler({
  refresh,
  intervalMs,
  initialDelayMs = 0,
  documentTarget = document,
  timerTarget = window,
}: {
  refresh: () => Promise<void>;
  intervalMs: number;
  initialDelayMs?: number;
  documentTarget?: VisibleRefreshDocument;
  timerTarget?: VisibleRefreshTimers;
}): () => void {
  const runVisible = () => {
    if (documentTarget.visibilityState !== "hidden") void refresh();
  };
  let initialTimer: number | null = null;
  if (initialDelayMs > 0) {
    initialTimer = timerTarget.setTimeout(() => {
      initialTimer = null;
      runVisible();
    }, initialDelayMs);
  } else {
    runVisible();
  }
  const interval = timerTarget.setInterval(runVisible, intervalMs);
  const onVisible = () => {
    if (documentTarget.visibilityState === "visible") void refresh();
  };
  documentTarget.addEventListener("visibilitychange", onVisible);
  return () => {
    if (initialTimer !== null) timerTarget.clearTimeout(initialTimer);
    timerTarget.clearInterval(interval);
    documentTarget.removeEventListener("visibilitychange", onVisible);
  };
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
  initialDelayMs = 0,
): void {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    return createVisibleWalletRefreshScheduler({
      refresh: () => refreshRef.current(),
      intervalMs,
      initialDelayMs,
    });
  }, [enabled, initialDelayMs, intervalMs, refreshKey]);
}
