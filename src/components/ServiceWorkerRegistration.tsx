"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function ServiceWorkerRegistration() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [activationRequested, setActivationRequested] = useState(false);
  const reloadRequested = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

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
