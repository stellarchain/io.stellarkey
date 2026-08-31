"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

export function ServiceWorkerRegistration() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [activationRequested, setActivationRequested] = useState(false);
  const reloadRequested = useRef(false);

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

    let registration: ServiceWorkerRegistration | null = null;
    let installing: ServiceWorker | null = null;

    const offerWaitingUpdate = () => {
      if (navigator.serviceWorker.controller && registration?.waiting) {
        setWaiting(registration.waiting);
      }
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
      if (!reloadRequested.current) return;
      reloadRequested.current = false;
      window.location.reload();
    };
    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        registration.addEventListener("updatefound", onUpdateFound);
        offerWaitingUpdate();
      } catch {
        // Service workers require HTTPS (or localhost), so LAN HTTP testing may reject this.
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      registration?.removeEventListener("updatefound", onUpdateFound);
      installing?.removeEventListener("statechange", onInstallingStateChange);
    };
  }, []);

  const activateUpdate = useCallback(() => {
    if (!waiting || activationRequested) return;
    reloadRequested.current = true;
    setActivationRequested(true);
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, [activationRequested, waiting]);

  if (!waiting) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 z-[120] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#1c1c1e]/95 px-4 py-3 text-white shadow-2xl backdrop-blur-xl"
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold">Update ready</span>
        <span className="block text-[12px] text-neutral-400">
          Reload when you are not signing or taking a payment.
        </span>
      </span>
      <button
        type="button"
        onClick={activateUpdate}
        disabled={activationRequested}
        className="min-h-11 shrink-0 rounded-xl bg-[#0A84FF] px-3 text-[13px] font-semibold disabled:opacity-60"
      >
        {activationRequested ? "Updating…" : "Update and reload"}
      </button>
    </div>
  );
}
