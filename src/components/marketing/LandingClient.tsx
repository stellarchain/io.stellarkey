"use client";

import { useEffect } from "react";

/** What a demo script is handed to drive its own playback. */
type DemoApi = {
  wait(ms: number, fn: () => void): void;
  show(step: number): void;
};

type DemoSpec = {
  /** Caption under the progress track, one per step. */
  labels: string[];
  run(demo: HTMLElement, api: DemoApi): void;
  /** The finished state, for readers who asked for reduced motion. */
  rest(demo: HTMLElement): void;
};

/**
 * Behaviour for the landing page's scroll reveal and two demos. It renders
 * nothing. Binding by data attribute rather than id keeps it independent of
 * the markup it drives, and everything it starts is torn down on unmount.
 */
export function LandingClient() {
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    const disposeDemos: Array<() => void> = [];

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ── scroll reveal ─────────────────────────────────────── */
    const rv = document.querySelectorAll(".rv");
    if (!("IntersectionObserver" in window) || reduce) rv.forEach((el) => el.classList.add("in"));
    else {
      const io = new IntersectionObserver((es) => {
        for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      }, { rootMargin: "0px 0px -10% 0px", threshold: 0.05 });
      observers.push(io);
      rv.forEach((el) => io.observe(el));
    }

    /* ── the demos ─────────────────────────────────────────────
       Three of them: signing a payment in the hero, taking one at the
       counter in act two, and a private payment in act three. So the driver
       is written once and bound per node rather than reaching for ids. Each
       plays once when it is scrolled to. */
    const SCRIPTS: Record<string, DemoSpec> = {
      sign: {
        labels: ["vault locked", "before you sign", "signed on this device", "on the public ledger"],
        run(d, api) {
          const pins = Array.from(d.querySelectorAll("[data-pin] i"));
          pins.forEach((el) => el.classList.remove("on"));
          api.show(0);
          pins.forEach((el, n) => api.wait(320 + n * 130, () => el.classList.add("on")));
          api.wait(320 + pins.length * 130 + 420, () => {
            api.show(1);
            api.wait(2500, () => { api.show(2); api.wait(1900, () => api.show(3)); });
          });
        },
        rest(d) { d.querySelectorAll("[data-pin] i").forEach((el) => el.classList.add("on")); },
      },
      sale: {
        labels: ["ringing up", "waiting for the customer", "settled on the ledger", "filed against the order"],
        run(d, api) {
          const amt = d.querySelector<HTMLElement>("[data-amt]");
          if (!amt) return;
          const keys = Array.from(d.querySelectorAll<HTMLElement>("[data-keys] span"));
          keys.forEach((key) => key.classList.remove("hit"));
          amt.textContent = "0.00";
          api.show(0);
          let acc = "";
          ["4", "8", "0"].forEach((n, i) => api.wait(360 + i * 300, () => {
            acc += n;
            amt.textContent = (parseInt(acc, 10) / 100).toFixed(2);
            const k = keys.find((el) => el.textContent === n);
            if (k) { k.classList.add("hit"); api.wait(210, () => k.classList.remove("hit")); }
            if (i === 2) api.wait(620, () => {
              api.show(1);
              api.wait(2600, () => { api.show(2); api.wait(2100, () => api.show(3)); });
            });
          }));
        },
        rest(d) {
          const amount = d.querySelector("[data-amt]");
          if (amount) amount.textContent = "4.80";
          d.querySelectorAll("[data-keys] span").forEach((key) => key.classList.remove("hit"));
        },
      },
      quiet: {
        labels: ["adding funds", "proving on this device", "the private send", "what the ledger sees"],
        run(d, api) {
          const pins = Array.from(d.querySelectorAll("[data-prove] i"));
          pins.forEach((el) => el.classList.remove("on"));
          api.show(0);
          api.wait(2400, () => {
            api.show(1);
            pins.forEach((el, n) => api.wait(420 + n * 260, () => el.classList.add("on")));
            api.wait(420 + pins.length * 260 + 520, () => {
              api.show(2);
              api.wait(2700, () => api.show(3));
            });
          });
        },
        rest(d) { d.querySelectorAll("[data-prove] i").forEach((el) => el.classList.add("on")); },
      },
    };

    for (const d of Array.from(document.querySelectorAll<HTMLElement>("[data-demo]"))) {
      const spec = d.dataset.demo ? SCRIPTS[d.dataset.demo] : undefined;
      const trackEl = d.querySelector("[data-track]");
      const dot = d.querySelector<HTMLElement>("[data-dot]");
      const label = d.querySelector<HTMLElement>("[data-label]");
      if (!spec || !trackEl || !dot || !label) continue;

      const steps = Array.from(d.querySelectorAll<HTMLElement>(".step"));
      const bars = Array.from(trackEl.children);
      const timers = new Set<number>();
      const clearTimers = () => {
        timers.forEach((timer) => window.clearTimeout(timer));
        timers.clear();
      };
      const api: DemoApi = {
        wait(ms, fn) {
          const timer = window.setTimeout(() => {
            timers.delete(timer);
            fn();
          }, ms);
          timers.add(timer);
        },
        show(i) {
          steps.forEach((s, n) => s.classList.toggle("on", n === i));
          bars.forEach((b, n) => b.classList.toggle("fill", n <= i));
          label.textContent = spec.labels[i];
          dot.className = "dot" + (i === 0 ? "" : i === steps.length - 1 ? " done" : " live");
          // Loop: after the last step has had its moment, start over.
          if (i === steps.length - 1) api.wait(3600, () => spec.run(d, api));
        },
      };
      let automatic: IntersectionObserver | null = null;
      const play = () => {
        automatic?.disconnect();
        clearTimers();
        if (reduce) {
          api.show(steps.length - 1);
          spec.rest(d);
          return;
        }
        spec.run(d, api);
      };
      const replay = d.querySelector<HTMLElement>("[data-replay]");
      replay?.addEventListener("click", play);
      disposeDemos.push(() => {
        replay?.removeEventListener("click", play);
        automatic?.disconnect();
        clearTimers();
      });

      if (reduce) { api.show(steps.length - 1); spec.rest(d); }
      else if ("IntersectionObserver" in window) {
        automatic = new IntersectionObserver((es) => {
          for (const e of es) if (e.isIntersecting) play();
        }, { threshold: 0.4 });
        observers.push(automatic); automatic.observe(d);
      } else play();
    }

    return () => {
      disposeDemos.forEach((dispose) => dispose());
      observers.forEach((o) => o.disconnect());
    };
  }, []);

  return null;
}
