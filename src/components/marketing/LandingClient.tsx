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
 * Behaviour for the landing page: scroll reveal, the two demos, and the fee
 * calculator. It renders nothing. Binding by data attribute rather than id
 * keeps it independent of the markup it drives, and everything it starts is
 * torn down on unmount so a client navigation cannot leave timers running.
 */
export function LandingClient() {
  useEffect(() => {
    const timers: number[] = [];
    const observers: IntersectionObserver[] = [];
    const track = (id: number) => { timers.push(id); return id; };

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
       Two of them: signing a payment in the hero, and taking one at the
       counter in act two. So the driver is written once and bound per node
       rather than reaching for ids. Each plays once when it is scrolled to. */
    const SCRIPTS: Record<string, DemoSpec> = {
      sign: {
        labels: ["vault locked", "before you sign", "signed on this device", "on the public ledger"],
        run(d, api) {
          const pins = Array.from(d.querySelectorAll("[data-pin] i"));
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
        labels: ["ringing up", "waiting for the customer", "settled off the ledger", "filed against the order"],
        run(d, api) {
          const amt = d.querySelector<HTMLElement>("[data-amt]");
          if (!amt) return;
          const keys = Array.from(d.querySelectorAll<HTMLElement>("[data-keys] span"));
          amt.textContent = "0.00";
          api.show(0);
          let acc = "";
          ["4", "8", "0"].forEach((n, i) => api.wait(360 + i * 300, () => {
            acc += n;
            amt.textContent = (parseInt(acc, 10) / 100).toFixed(2);
            const k = keys.find((el) => el.textContent === n);
            if (k) { k.classList.add("hit"); track(window.setTimeout(() => k.classList.remove("hit"), 210)); }
            if (i === 2) api.wait(620, () => {
              api.show(1);
              api.wait(2600, () => { api.show(2); api.wait(2100, () => api.show(3)); });
            });
          }));
        },
        rest(d) { const a = d.querySelector("[data-amt]"); if (a) a.textContent = "4.80"; },
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
      const api: DemoApi = {
        wait(ms, fn) { track(window.setTimeout(fn, ms)); },
        show(i) {
          steps.forEach((s, n) => s.classList.toggle("on", n === i));
          bars.forEach((b, n) => b.classList.toggle("fill", n <= i));
          label.textContent = spec.labels[i];
          dot.className = "dot" + (i === 0 ? "" : i === steps.length - 1 ? " done" : " live");
        },
      };
      const play = () => spec.run(d, api);
      d.querySelector("[data-replay]")?.addEventListener("click", play);

      if (reduce) { api.show(steps.length - 1); spec.rest(d); }
      else if ("IntersectionObserver" in window) {
        const once = new IntersectionObserver((es) => {
          for (const e of es) if (e.isIntersecting) { play(); once.disconnect(); }
        }, { threshold: 0.4 });
        observers.push(once); once.observe(d);
      } else play();
    }

    /* ── what the fee actually costs you ───────────────────── */
    const iSales = document.getElementById("i-sales") as HTMLInputElement | null;
    const iTicket = document.getElementById("i-ticket") as HTMLInputElement | null;
    const oSales = document.getElementById("o-sales");
    const oTicket = document.getElementById("o-ticket");
    const oRows = document.getElementById("o-rows");
    const oTurn = document.getElementById("o-turnover");
    const oVerdict = document.getElementById("o-verdict");

    if (iSales && iTicket && oSales && oTicket && oRows && oTurn && oVerdict) {
      // published in-person rates; Stellar's fee is the live base fee at the
      // current XLM rate, so it is a real number rather than a rounded claim
      const XLM_EUR = 0.153631, FEE_XLM = 0.00001;
      const FEE = XLM_EUR * FEE_XLM;
      const CARDS: Array<[string, number, number]> = [
        ["Square", 0.0175, 0], ["Zettle", 0.0175, 0],
        ["SumUp", 0.0169, 0], ["Stripe Terminal", 0.014, 0.20],
      ];
      const eur = (n: number, d = 2) =>
        "€ " + n.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
      const rate = (p: number, f: number) =>
        (p * 100).toFixed(2).replace(/\.?0+$/, "") + " %" + (f ? " + " + eur(f) : "");

      const draw = () => {
        const perDay = +iSales.value, ticket = +iTicket.value;
        const year = perDay * 365, turnover = year * ticket;
        oSales.textContent = String(perDay);
        oTicket.textContent = eur(ticket);
        oTurn.textContent = `${year.toLocaleString("en-GB")} sales a year · ${eur(turnover, 0)} through the till`;
        oRows.innerHTML = CARDS.map(([n, p, f]) =>
          `<tr><td>${n}</td><td>${rate(p, f)}</td><td>${eur((ticket * p + f) * year, 0)}</td></tr>`).join("") +
          `<tr class="us"><td>StellarKey</td><td>0.00001 XLM</td><td>${eur(FEE * year, 2)}</td></tr>`;
        // Compare against the commonest in-person rate, not the dearest. Taking
        // the worst line flatters the number and is the sort of claim that gets
        // a page distrusted. Square at 1.75 % is the honest reference.
        const REF = CARDS[0];
        const theirs = (ticket * REF[1] + REF[2]) * year;
        const ours = FEE * year;
        oVerdict.innerHTML = `At ${REF[0]}'s rate that is <b>${eur(theirs, 0)}</b> a year in fees. ` +
          `Here it is <b>${eur(ours, 2)}</b>. You keep the difference.`;
      };
      iSales.addEventListener("input", draw);
      iTicket.addEventListener("input", draw);
      draw();
    }

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      observers.forEach((o) => o.disconnect());
    };
  }, []);

  return null;
}
