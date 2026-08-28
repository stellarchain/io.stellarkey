/**
 * Promo annotation layer.
 *
 * Injected into the running app so captions, spotlights and the cursor
 * composite as real DOM in the app's own type and colour, rather than being
 * burned on flat by ffmpeg afterwards. Everything here is pointer-events:none
 * so it never intercepts a click the tour script is trying to make.
 *
 * Exposes window.__promo — see record.mjs for the tour that drives it.
 */
(() => {
  if (window.__promo) return;

  const ACCENT = "#0A84FF";
  const root = document.createElement("div");
  root.id = "promo-layer";
  document.body.appendChild(root);

  const css = document.createElement("style");
  css.textContent = `
  #promo-layer, #promo-layer * { pointer-events: none; }
  #promo-layer {
    position: fixed; inset: 0; z-index: 2147483600;
    font: 400 16px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  /* ---- chapter card ---------------------------------------------------- */
  #promo-card {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 18px;
    background: radial-gradient(120% 90% at 50% 40%, rgba(10,132,255,.14), transparent 62%), rgba(6,6,8,.92);
    backdrop-filter: blur(22px) saturate(140%);
    opacity: 0; transition: opacity .5s cubic-bezier(.32,.72,0,1);
  }
  #promo-card.on { opacity: 1; }
  #promo-card .eyebrow {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 12px; letter-spacing: .34em; text-transform: uppercase;
    color: ${ACCENT}; opacity: 0; transform: translateY(10px);
  }
  #promo-card h1 {
    margin: 0; font-size: 62px; line-height: 1.03; font-weight: 600; letter-spacing: -.028em;
    color: #fff; text-align: center; max-width: 17ch; text-wrap: balance;
  }
  #promo-card h1 span { display: inline-block; opacity: 0; transform: translateY(22px) rotate(1.2deg); }
  #promo-card p {
    margin: 0; font-size: 19px; color: #98989f; text-align: center; max-width: 46ch;
    opacity: 0; transform: translateY(12px);
  }
  #promo-card .rule {
    width: 0; height: 2px; border-radius: 2px;
    background: linear-gradient(90deg, transparent, ${ACCENT}, transparent);
  }

  /* ---- spotlight ------------------------------------------------------- */
  #promo-dim { position: absolute; inset: 0; opacity: 0; transition: opacity .42s ease; }
  #promo-dim.on { opacity: 1; }
  #promo-ring {
    position: absolute; border: 2px solid ${ACCENT}; border-radius: 18px;
    box-shadow: 0 0 0 1px rgba(10,132,255,.28), 0 12px 44px rgba(10,132,255,.34);
    opacity: 0; transition: opacity .34s ease,
      transform .58s cubic-bezier(.32,.72,0,1), left .58s cubic-bezier(.32,.72,0,1),
      top .58s cubic-bezier(.32,.72,0,1), width .58s cubic-bezier(.32,.72,0,1),
      height .58s cubic-bezier(.32,.72,0,1);
  }
  #promo-ring.on { opacity: 1; }

  /* ---- callout --------------------------------------------------------- */
  .promo-note {
    position: absolute; max-width: 330px;
    background: rgba(28,28,30,.94); backdrop-filter: blur(20px) saturate(160%);
    border: 1px solid rgba(255,255,255,.12); border-radius: 18px;
    padding: 13px 16px 14px; box-shadow: 0 20px 60px rgba(0,0,0,.62);
    opacity: 0; transform: translateY(10px) scale(.97);
    transition: opacity .34s ease, transform .44s cubic-bezier(.32,.72,0,1);
  }
  .promo-note.on { opacity: 1; transform: none; }
  .promo-note .k {
    display: flex; align-items: center; gap: 7px; margin-bottom: 5px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase; color: ${ACCENT};
  }
  .promo-note .k i { width: 5px; height: 5px; border-radius: 50%; background: ${ACCENT}; flex: none; }
  .promo-note b { display: block; font-size: 17px; font-weight: 600; color: #fff; letter-spacing: -.012em; }
  .promo-note span.body { display: block; margin-top: 4px; font-size: 13.5px; line-height: 1.45; color: #a1a1a6; }
  #promo-wires { position: absolute; inset: 0; overflow: visible; }
  #promo-wires path {
    fill: none; stroke: ${ACCENT}; stroke-width: 1.5; opacity: .55;
    stroke-dasharray: var(--len); stroke-dashoffset: var(--len);
    transition: stroke-dashoffset .5s cubic-bezier(.32,.72,0,1), opacity .3s ease;
  }
  #promo-wires path.on { stroke-dashoffset: 0; }

  /* ---- chapter ticker -------------------------------------------------- */
  #promo-ticker {
    position: absolute; right: 30px; bottom: 26px; display: flex; align-items: center; gap: 12px;
    padding: 7px 14px; border-radius: 999px;
    background: rgba(28,28,30,.82); backdrop-filter: blur(16px) saturate(150%);
    border: 1px solid rgba(255,255,255,.09);
    opacity: 0; transition: opacity .4s ease;
  }
  #promo-ticker.on { opacity: 1; }
  #promo-ticker .n {
    font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px;
    color: ${ACCENT}; letter-spacing: .1em;
  }
  #promo-ticker .t { font-size: 13px; color: #d8d8dc; letter-spacing: -.005em; }
  #promo-ticker .bar { width: 120px; height: 2px; border-radius: 2px; background: rgba(255,255,255,.14); overflow: hidden; }
  #promo-ticker .bar i { display: block; height: 100%; width: 0; background: ${ACCENT}; transition: width .6s linear; }

  /* ---- caption --------------------------------------------------------- */
  /* Page-level notes have nothing small to hang off, so they get a fixed lane
     at the bottom-left rather than a callout dropped over the screen. */
  #promo-caption {
    position: absolute; left: 30px; bottom: 26px; width: 396px; max-width: calc(100% - 60px);
    background: rgba(24,24,26,.92); backdrop-filter: blur(24px) saturate(160%);
    border: 1px solid rgba(255,255,255,.11); border-radius: 20px;
    padding: 15px 18px 17px; box-shadow: 0 26px 70px rgba(0,0,0,.66);
    opacity: 0; transform: translateY(16px); transition: opacity .38s ease, transform .5s cubic-bezier(.32,.72,0,1);
  }
  #promo-caption.on { opacity: 1; transform: none; }
  #promo-caption .k {
    display: flex; align-items: center; gap: 7px; margin-bottom: 6px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 10.5px; letter-spacing: .18em; text-transform: uppercase; color: ${ACCENT};
  }
  #promo-caption .k i { width: 5px; height: 5px; border-radius: 50%; background: ${ACCENT}; flex: none; }
  #promo-caption b { display: block; font-size: 20px; font-weight: 600; color: #fff; letter-spacing: -.016em; }
  #promo-caption span.body { display: block; margin-top: 5px; font-size: 14px; line-height: 1.5; color: #a1a1a6; }

  /* ---- cursor ---------------------------------------------------------- */
  #promo-cursor {
    position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px;
    border-radius: 50%; background: rgba(255,255,255,.92);
    box-shadow: 0 2px 12px rgba(0,0,0,.5), 0 0 0 6px rgba(255,255,255,.13);
    opacity: 0; transition: opacity .3s ease, left .62s cubic-bezier(.32,.72,0,1), top .62s cubic-bezier(.32,.72,0,1);
  }
  #promo-cursor.on { opacity: 1; }
  .promo-ripple {
    position: absolute; width: 20px; height: 20px; margin: -10px 0 0 -10px;
    border-radius: 50%; border: 2px solid ${ACCENT};
  }

  /* ---- phone pass ------------------------------------------------------ */
  /* The mobile capture is composited as a device screen later, so the page
     wears the screen edge itself and the caption drops to a full-width lane. */
  #promo-layer.phone #promo-caption {
    left: 14px; right: 14px; bottom: 14px; width: auto; border-radius: 22px; padding: 13px 16px 15px;
  }
  #promo-layer.phone #promo-caption b { font-size: 17px; }
  #promo-layer.phone #promo-caption span.body { font-size: 12.5px; }
  #promo-layer.phone #promo-ticker { display: none; }
  #promo-layer.phone #promo-card h1 { font-size: 34px; }
  #promo-layer.phone #promo-card p { font-size: 15px; padding: 0 22px; }
  #promo-layer.phone .promo-note { max-width: 260px; }

  /* ---- vignette + grain (kept very subtle) ----------------------------- */
  #promo-vig {
    position: absolute; inset: 0;
    box-shadow: inset 0 0 190px rgba(0,0,0,.5);
  }`;
  document.head.appendChild(css);

  root.innerHTML = `
    <div id="promo-vig"></div>
    <svg id="promo-wires"></svg>
    <div id="promo-dim"></div>
    <div id="promo-ring"></div>
    <div id="promo-cursor"></div>
    <div id="promo-caption"></div>
    <div id="promo-ticker"><span class="n">01</span><span class="t"></span><span class="bar"><i></i></span></div>
    <div id="promo-card">
      <div class="eyebrow"></div>
      <h1></h1>
      <div class="rule"></div>
      <p></p>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const card = $("#promo-card"), dim = $("#promo-dim"), ring = $("#promo-ring");
  const wires = $("#promo-wires"), ticker = $("#promo-ticker"), cursor = $("#promo-cursor");
  const caption = $("#promo-caption");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** A rounded-rect hole punched in the dim, so the target keeps full contrast. */
  function dimWithHole(box) {
    if (!box) { dim.style.background = "rgba(0,0,0,.62)"; return; }
    const { x, y, w, h, r } = box;
    const id = "promo-hole";
    dim.style.background = "rgba(0,0,0,.62)";
    dim.style.clipPath = `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x}px ${y}px, ${x}px ${y + h}px, ${x + w}px ${y + h}px, ${x + w}px ${y}px, ${x}px ${y}px)`;
    void id;
  }

  const api = {
    /** Full-screen chapter title with a staggered word reveal. */
    async chapter(eyebrow, title, sub) {
      const h1 = card.querySelector("h1");
      card.querySelector(".eyebrow").textContent = eyebrow;
      h1.innerHTML = title.split(" ").map((w) => `<span>${w}</span>`).join(" ");
      card.querySelector("p").textContent = sub || "";
      card.classList.add("on");
      const eb = card.querySelector(".eyebrow");
      eb.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
        { duration: 460, easing: "cubic-bezier(.32,.72,0,1)", fill: "forwards" });
      h1.querySelectorAll("span").forEach((s, i) => {
        s.animate([{ opacity: 0, transform: "translateY(22px) rotate(1.2deg)" }, { opacity: 1, transform: "none" }],
          { duration: 620, delay: 130 + i * 68, easing: "cubic-bezier(.32,.72,0,1)", fill: "forwards" });
      });
      const rule = card.querySelector(".rule");
      rule.animate([{ width: "0px" }, { width: "190px" }],
        { duration: 700, delay: 320, easing: "cubic-bezier(.32,.72,0,1)", fill: "forwards" });
      card.querySelector("p").animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }],
        { duration: 560, delay: 460, easing: "cubic-bezier(.32,.72,0,1)", fill: "forwards" });
      await sleep(60);
    },
    async chapterOut() {
      card.classList.remove("on");
      await sleep(520);
      card.querySelectorAll("*").forEach((n) => n.getAnimations().forEach((a) => a.cancel()));
    },

    /** The bottom-left lane, for anything without a small target to point at. */
    caption(kicker, title, body) {
      caption.innerHTML = `<div class="k"><i></i>${kicker}</div><b>${title}</b>${body ? `<span class="body">${body}</span>` : ""}`;
      caption.classList.add("on");
    },
    captionOut() { caption.classList.remove("on"); },

    /** Bottom-right section marker; `pct` drives the little progress bar. */
    tick(n, title, pct) {
      ticker.querySelector(".n").textContent = String(n).padStart(2, "0");
      ticker.querySelector(".t").textContent = title;
      ticker.classList.add("on");
      requestAnimationFrame(() => { ticker.querySelector(".bar i").style.width = `${Math.round(pct * 100)}%`; });
    },
    tickOff() { ticker.classList.remove("on"); },

    /**
     * Ring + dim around a rect. The driver resolves elements, because the
     * selectors it uses (:has-text, :text-is) are Playwright's, not CSS.
     */
    spotlight(b, pad = 8) {
      if (!b) return false;
      const box = { x: b.x - pad, y: b.y - pad, w: b.width + pad * 2, h: b.height + pad * 2 };
      const rad = 16;
      Object.assign(ring.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, borderRadius: `${rad}px` });
      dimWithHole({ ...box, r: rad });
      ring.classList.add("on"); dim.classList.add("on");
      return box;
    },
    spotOff() { ring.classList.remove("on"); dim.classList.remove("on"); },

    /**
     * A callout pinned beside a target, joined to it by a drawn line.
     * `side` picks which way it sits; the wire is a soft cubic, not an elbow.
     */
    note(b, kicker, title, body, side = "right") {
      if (!b) b = { x: innerWidth / 2, y: innerHeight / 2, width: 0, height: 0 };
      const n = document.createElement("div");
      n.className = "promo-note";
      n.innerHTML = `<div class="k"><i></i>${kicker}</div><b>${title}</b>${body ? `<span class="body">${body}</span>` : ""}`;
      root.appendChild(n);
      const nb = n.getBoundingClientRect();
      const GAP = 26;
      let left, top, ax, ay, bx, by;
      if (side === "right") { left = b.x + b.width + GAP; top = b.y + b.height / 2 - nb.height / 2; ax = b.x + b.width; ay = b.y + b.height / 2; bx = left; by = top + nb.height / 2; }
      else if (side === "left") { left = b.x - nb.width - GAP; top = b.y + b.height / 2 - nb.height / 2; ax = b.x; ay = b.y + b.height / 2; bx = left + nb.width; by = top + nb.height / 2; }
      else if (side === "below") { left = b.x + b.width / 2 - nb.width / 2; top = b.y + b.height + GAP; ax = b.x + b.width / 2; ay = b.y + b.height; bx = left + nb.width / 2; by = top; }
      else { left = b.x + b.width / 2 - nb.width / 2; top = b.y - nb.height - GAP; ax = b.x + b.width / 2; ay = b.y; bx = left + nb.width / 2; by = top + nb.height; }
      left = Math.max(16, Math.min(innerWidth - nb.width - 16, left));
      top = Math.max(16, Math.min(innerHeight - nb.height - 16, top));
      n.style.left = `${left}px`; n.style.top = `${top}px`;
      const mx = (ax + bx) / 2;
      const d = `M ${ax} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      wires.appendChild(path);
      const len = path.getTotalLength();
      path.style.setProperty("--len", len);
      requestAnimationFrame(() => { n.classList.add("on"); path.classList.add("on"); });
      return true;
    },
    clearNotes() {
      root.querySelectorAll(".promo-note").forEach((n) => {
        n.classList.remove("on");
        setTimeout(() => n.remove(), 380);
      });
      wires.querySelectorAll("path").forEach((p) => {
        p.style.opacity = "0";
        setTimeout(() => p.remove(), 380);
      });
    },

    /** Soft pointer that eases to a target and leaves a click ripple. */
    async point(b) {
      if (!b) return false;
      cursor.style.left = `${b.x + b.width / 2}px`;
      cursor.style.top = `${b.y + b.height / 2}px`;
      cursor.classList.add("on");
      return true;
    },
    click() {
      const x = parseFloat(cursor.style.left), y = parseFloat(cursor.style.top);
      const r = document.createElement("div");
      r.className = "promo-ripple";
      r.style.left = `${x}px`; r.style.top = `${y}px`;
      root.appendChild(r);
      r.animate([{ transform: "scale(.4)", opacity: .95 }, { transform: "scale(3.1)", opacity: 0 }],
        { duration: 620, easing: "cubic-bezier(.22,.9,.3,1)" }).onfinish = () => r.remove();
      cursor.animate([{ transform: "scale(1)" }, { transform: "scale(.72)" }, { transform: "scale(1)" }], { duration: 260 });
    },
    pointOff() { cursor.classList.remove("on"); },

    /** Switch the layer to phone proportions for the mobile pass. */
    phone(on) { root.classList.toggle("phone", !!on); },
  };

  window.__promo = api;
})();
