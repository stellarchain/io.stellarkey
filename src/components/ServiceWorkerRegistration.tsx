"use client";

import { useEffect, useRef, useState } from "react";
import { APPLICATION_VERSION, BUILD_COMMIT, BUILD_IS_DIRTY } from "@/lib/brand";

const SHELL_CACHE_PREFIX = "stellarkey-shell-";
const DEV_SW_RELOAD_KEY = "stellarkey.dev-shell-reload.v1";

function isStellarKeyWorker(worker: ServiceWorker | null): boolean {
  if (!worker) return false;
  try {
    const url = new URL(worker.scriptURL);
    return url.origin === window.location.origin && url.pathname === "/sw.js";
  } catch {
    return false;
  }
}

function isStellarKeyRegistration(registration: ServiceWorkerRegistration): boolean {
  return [registration.active, registration.waiting, registration.installing].some(
    (worker) => isStellarKeyWorker(worker),
  );
}

function workerMatchesPage(worker: ServiceWorker, signal: AbortSignal): Promise<boolean> {
  // A dirty checkout cannot identify its exact contents by commit alone.
  if (BUILD_IS_DIRTY || !/^[0-9a-f]{40}$/.test(BUILD_COMMIT) || signal.aborted) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (matches: boolean) => {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      channel.port1.close();
      channel.port2.close();
      resolve(matches);
    };
    const abort = () => finish(false);
    // Older workers do not understand GET_RELEASE. Keep their explicit update action.
    const timeout = window.setTimeout(() => finish(false), 2_000);
    signal.addEventListener("abort", abort, { once: true });
    channel.port1.onmessage = ({ data }) => finish(
      data?.commit === BUILD_COMMIT &&
      data?.version === APPLICATION_VERSION &&
      data?.sourceTree === "clean",
    );
    try {
      worker.postMessage({ type: "GET_RELEASE" }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

export function ServiceWorkerRegistration() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [activationRequested, setActivationRequested] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const reloadRequested = useRef(false);
  const activateUpdateRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      let cancelled = false;

      const removeStaleShell = async () => {
        const controlledByStellarKey = isStellarKeyWorker(navigator.serviceWorker.controller);
        const registrations = await navigator.serviceWorker.getRegistrations();
        const registrationsToRemove = registrations.filter(isStellarKeyRegistration);

        await Promise.all(
          registrationsToRemove.map((registration) => registration.unregister()),
        );

        if ("caches" in window) {
          const names = await window.caches.keys();
          await Promise.all(
            names
              .filter((name) => name.startsWith(SHELL_CACHE_PREFIX))
              .map((name) => window.caches.delete(name)),
          );
        }

        if (cancelled) return;
        if (controlledByStellarKey) {
          const alreadyReloaded = window.sessionStorage.getItem(DEV_SW_RELOAD_KEY) === "1";
          if (!alreadyReloaded) {
            window.sessionStorage.setItem(DEV_SW_RELOAD_KEY, "1");
            window.location.reload();
          }
          return;
        }

        window.sessionStorage.removeItem(DEV_SW_RELOAD_KEY);
      };

      void removeStaleShell().catch(() => {
        // Local preview cleanup is best-effort; normal rendering must remain available.
      });

      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;
    let installing: ServiceWorker | null = null;
    let observedWorker: ServiceWorker | null = null;
    let pageController = navigator.serviceWorker.controller;
    let identityRequest: AbortController | null = null;
    let activationTimeout: number | undefined;
    let activationDeadline = 0;
    let reloading = false;

    const reload = () => {
      if (reloading) return;
      reloading = true;
      reloadRequested.current = false;
      window.clearTimeout(activationTimeout);
      window.location.reload();
    };

    const offerWaitingUpdate = () => {
      if (cancelled) return;
      identityRequest?.abort();
      const controller = navigator.serviceWorker.controller;
      const candidate = registration?.waiting ?? (controller !== pageController ? controller : null);
      const worker = candidate?.state === "redundant" ? null : candidate;
      if (worker !== observedWorker) {
        observedWorker?.removeEventListener("statechange", offerWaitingUpdate);
        observedWorker = worker;
        observedWorker?.addEventListener("statechange", offerWaitingUpdate);
      }
      if (!worker) {
        setWaiting(null);
        return;
      }
      const request = new AbortController();
      identityRequest = request;
      void workerMatchesPage(worker, request.signal).then((matches) => {
        if (cancelled || request.signal.aborted) return;
        // A fresh document may already be this release even while its offline
        // worker waits for older tabs to close. Do not interrupt those tabs.
        setWaiting(matches ? null : worker);
      });
    };
    const onInstallingStateChange = () => {
      if (installing?.state === "installed") offerWaitingUpdate();
    };
    const onUpdateFound = () => {
      installing?.removeEventListener("statechange", onInstallingStateChange);
      installing = registration?.installing ?? null;
      installing?.addEventListener("statechange", onInstallingStateChange);
    };
    const onControllerChange = () => {
      if (reloadRequested.current) {
        // Background tabs can suspend timers; consent must still expire on time.
        if (Date.now() >= activationDeadline) {
          activationFailed();
          return;
        }
        reload();
        return;
      }
      if (!pageController) pageController = navigator.serviceWorker.controller;
      offerWaitingUpdate();
    };
    const activationFailed = () => {
      window.clearTimeout(activationTimeout);
      reloadRequested.current = false;
      setActivationRequested(false);
      setUpdateError("The update could not finish. Check your connection and try again.");
      offerWaitingUpdate();
    };
    activateUpdateRef.current = () => {
      if (cancelled || reloading || reloadRequested.current) return;
      const worker = registration?.waiting ?? observedWorker;
      if (!worker || worker.state === "redundant") {
        offerWaitingUpdate();
        return;
      }
      setUpdateError(null);
      setActivationRequested(true);
      if (worker.state === "activated") {
        reload();
        return;
      }
      reloadRequested.current = true;
      activationDeadline = Date.now() + 15_000;
      activationTimeout = window.setTimeout(activationFailed, 15_000);
      try {
        worker.postMessage({ type: "SKIP_WAITING" });
      } catch {
        activationFailed();
      }
    };
    const register = async () => {
      try {
        const registered = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        if (cancelled) return;
        registration = registered;
        registration.addEventListener("updatefound", onUpdateFound);
        onUpdateFound();
        offerWaitingUpdate();
      } catch {
        // Service workers require HTTPS (or localhost), so LAN HTTP testing may reject this.
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    window.addEventListener("pageshow", offerWaitingUpdate);
    window.addEventListener("focus", offerWaitingUpdate);
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      cancelled = true;
      identityRequest?.abort();
      window.clearTimeout(activationTimeout);
      reloadRequested.current = false;
      activateUpdateRef.current = () => {};
      window.removeEventListener("load", register);
      window.removeEventListener("pageshow", offerWaitingUpdate);
      window.removeEventListener("focus", offerWaitingUpdate);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      registration?.removeEventListener("updatefound", onUpdateFound);
      installing?.removeEventListener("statechange", onInstallingStateChange);
      observedWorker?.removeEventListener("statechange", offerWaitingUpdate);
    };
  }, []);

  if (!waiting) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fade-up fixed inset-x-3 z-[120] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[var(--color-elevated)] px-4 py-3 text-white shadow-2xl backdrop-blur-xl"
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold">Update ready</span>
        <span className="block text-[12px] text-neutral-400">
          {updateError ?? "Reload when you are not signing or taking a payment."}
        </span>
      </span>
      <button
        type="button"
        onClick={() => activateUpdateRef.current()}
        disabled={activationRequested}
        className="min-h-11 shrink-0 rounded-xl bg-[#0A84FF] px-3 text-[13px] font-semibold disabled:opacity-60"
      >
        {activationRequested ? "Updating…" : "Update and reload"}
      </button>
    </div>
  );
}
