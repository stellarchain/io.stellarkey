"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type WakeLockState = "inactive" | "unsupported" | "requesting" | "active" | "released" | "error";

interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: EventListener): void;
  removeEventListener(type: "release", listener: EventListener): void;
}

interface WakeLockDocumentLike {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: EventListener): void;
  removeEventListener(type: "visibilitychange", listener: EventListener): void;
}

interface WakeLockNavigatorLike {
  wakeLock?: {
    request(type: "screen"): Promise<WakeLockSentinelLike>;
  };
}

export interface WakeLockController {
  start(): void;
  stop(): void;
  retry(): void;
  state(): WakeLockState;
}

export interface WakeLockControllerOptions {
  document: WakeLockDocumentLike;
  navigator: WakeLockNavigatorLike;
  onStateChange?: (state: WakeLockState) => void;
  /** Runs only when a previously hidden page becomes visible again. */
  onForeground?: () => void;
}

/**
 * Owns one Screen Wake Lock without assuming the browser can keep JavaScript
 * alive in the background. Visibility changes invalidate in-flight requests,
 * release held locks, and give the caller one catch-up signal on return.
 */
export function createWakeLockController(options: WakeLockControllerOptions): WakeLockController {
  let currentState: WakeLockState = "inactive";
  let sentinel: WakeLockSentinelLike | null = null;
  let started = false;
  let requestGeneration = 0;
  let requesting = false;

  const publish = (state: WakeLockState) => {
    if (state === currentState) return;
    currentState = state;
    options.onStateChange?.(state);
  };

  const onSentinelRelease: EventListener = () => {
    sentinel?.removeEventListener("release", onSentinelRelease);
    sentinel = null;
    requesting = false;
    publish(started && options.document.visibilityState === "visible" ? "released" : "inactive");
  };

  const release = async () => {
    requestGeneration += 1;
    requesting = false;
    const held = sentinel;
    sentinel = null;
    held?.removeEventListener("release", onSentinelRelease);
    publish("inactive");
    if (held && !held.released) {
      try {
        await held.release();
      } catch {
        // The state is already truthful: this controller no longer owns the
        // sentinel even if the browser rejected a redundant release request.
      }
    }
  };

  const acquire = async () => {
    if (!started || options.document.visibilityState !== "visible") {
      await release();
      return;
    }
    if (!options.navigator.wakeLock) {
      publish("unsupported");
      return;
    }
    if ((sentinel && !sentinel.released) || requesting) return;

    requesting = true;
    const generation = ++requestGeneration;
    publish("requesting");
    try {
      const next = await options.navigator.wakeLock.request("screen");
      if (
        !started ||
        options.document.visibilityState !== "visible" ||
        generation !== requestGeneration
      ) {
        if (!next.released) await next.release().catch(() => {});
        return;
      }
      sentinel = next;
      requesting = false;
      sentinel.addEventListener("release", onSentinelRelease);
      publish("active");
    } catch {
      if (generation !== requestGeneration || !started) return;
      requesting = false;
      publish("error");
    }
  };

  const onVisibilityChange: EventListener = () => {
    if (options.document.visibilityState === "visible") {
      options.onForeground?.();
      void acquire();
    } else {
      void release();
    }
  };

  return {
    start() {
      if (started) return;
      started = true;
      options.document.addEventListener("visibilitychange", onVisibilityChange);
      void acquire();
    },
    stop() {
      if (!started) return;
      started = false;
      options.document.removeEventListener("visibilitychange", onVisibilityChange);
      void release();
    },
    retry() {
      void acquire();
    },
    state() {
      return currentState;
    },
  };
}

export function useWakeLock(
  enabled: boolean,
  onForeground?: () => void,
): { state: WakeLockState; retry: () => void } {
  const [state, setState] = useState<WakeLockState>("inactive");
  const foregroundRef = useRef(onForeground);
  const controllerRef = useRef<WakeLockController | null>(null);

  useEffect(() => {
    foregroundRef.current = onForeground;
  }, [onForeground]);

  useEffect(() => {
    if (!enabled) return;
    let acceptingState = true;
    const controller = createWakeLockController({
      document,
      navigator: navigator as WakeLockNavigatorLike,
      onStateChange: (next) => {
        if (acceptingState) setState(next);
      },
      onForeground: () => foregroundRef.current?.(),
    });
    controllerRef.current = controller;
    controller.start();
    return () => {
      acceptingState = false;
      controllerRef.current = null;
      controller.stop();
    };
  }, [enabled]);

  const retry = useCallback(() => controllerRef.current?.retry(), []);
  return { state: enabled ? state : "inactive", retry };
}
