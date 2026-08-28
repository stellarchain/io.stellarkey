"use client";

import { BRAND_NAME } from "./brand";

/**
 * Bespoke print document for the cold-storage paper wallet.
 *
 * The in-app "print" used to dump the modal's screen CSS through
 * window.print(); this instead renders a purpose-built A4-landscape
 * certificate — hairline double frame, press-style typography, chunked
 * (Trezor-style 4-char groups) key material — opened in a new window
 * that auto-triggers the print dialog, where "Save as PDF" yields the
 * designed document rather than a screenshot of the app.
 */

export interface PaperWalletDoc {
  accountLabel: string;
  publicKey: string;
  secretOrPhrase: string;
  kind: "mnemonic" | "secret";
  path?: string;
  networkLabel?: string;
  /** Data-URL QR images (generated client-side by the caller). */
  pubQrDataUrl: string;
  secQrDataUrl: string;
}

function chunk4(s: string): string {
  return (s.match(/.{1,4}/g) ?? [s]).join(" ");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildPaperWalletHtml(doc: PaperWalletDoc): string {
  const label = escapeHtml(doc.accountLabel);
  const date = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const fingerprint = `${doc.publicKey.slice(0, 4)}…${doc.publicKey.slice(-4)}`;

  const secretBlock =
    doc.kind === "mnemonic"
      ? `<div class="words">${doc.secretOrPhrase
          .split(" ")
          .map(
            (w, i) =>
              `<span class="word"><i>${String(i + 1).padStart(2, "0")}</i>${escapeHtml(w)}</span>`,
          )
          .join("")}</div>`
      : `<p class="mono">${chunk4(escapeHtml(doc.secretOrPhrase))}</p>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${BRAND_NAME} Paper Wallet — ${label}</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { background: #fff; }
  body { font-family: -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif; color: #101012; }
  .sheet { width: 297mm; height: 210mm; padding: 11mm; }
  .frame { position: relative; height: 100%; border: 0.55mm solid #101012; padding: 7mm 9mm 6mm; display: flex; flex-direction: column; }
  .frame::before { content: ""; position: absolute; inset: 1.7mm; border: 0.18mm solid #a3a3a8; pointer-events: none; }

  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 0.35mm solid #101012; padding-bottom: 4.5mm; }
  .brand { display: flex; align-items: center; gap: 4.5mm; }
  .mark { width: 13mm; height: 13mm; display: flex; align-items: center; justify-content: center; }
  .mark svg { width: 13mm; height: 13mm; }
  h1 { font-size: 6.2mm; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; }
  .sub { margin-top: 1.4mm; font-size: 2.8mm; font-weight: 600; letter-spacing: 0.34em; text-transform: uppercase; color: #6b6b70; }
  .meta { text-align: right; font-size: 2.8mm; line-height: 1.75; color: #55555a; }
  .chip { display: inline-block; background: #101012; color: #fff; padding: 1mm 3mm; border-radius: 1.2mm; font-size: 3mm; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }

  main { display: flex; gap: 7mm; margin-top: 6mm; align-items: stretch; flex: 1; }
  .panel { flex: 1; border: 0.25mm solid #b9b9be; border-radius: 2.5mm; padding: 4.5mm 5mm; text-align: center; display: flex; flex-direction: column; justify-content: center; }
  .panel.secret { border: 0.45mm dashed #c8281f; background: #fff8f6; }
  .ptitle { font-size: 3.1mm; font-weight: 800; letter-spacing: 0.24em; text-transform: uppercase; }
  .psub { margin-top: 0.9mm; font-size: 2.5mm; letter-spacing: 0.08em; color: #6b6b70; }
  .secret .ptitle, .secret .psub { color: #c8281f; }
  img.qr { display: block; width: 40mm; height: 40mm; margin: 3.5mm auto 0; }
  .mono { margin-top: 3.2mm; font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace; font-size: 2.9mm; font-weight: 600; letter-spacing: 0.05em; word-spacing: 0.4em; line-height: 1.85; overflow-wrap: break-word; }
  .words { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5mm; margin-top: 3.2mm; text-align: center; }
  .word { border: 0.2mm solid #d8d8dc; border-radius: 1.1mm; padding: 1.2mm 0; font-family: "SF Mono", ui-monospace, Menlo, monospace; font-size: 2.9mm; font-weight: 600; }
  .word i { font-style: normal; color: #9c9ca1; font-size: 2.2mm; margin-right: 0.9mm; }

  footer { margin-top: 5.5mm; border-top: 0.18mm solid #a3a3a8; padding-top: 3.2mm; display: flex; gap: 8mm; font-size: 2.45mm; line-height: 1.8; color: #55555a; }
  footer .col { flex: 1; }
  footer h4 { font-size: 2.5mm; font-weight: 800; letter-spacing: 0.22em; text-transform: uppercase; color: #101012; margin-bottom: 1mm; }
  .strip { margin-top: 4.5mm; background: #101012; color: #fff; text-align: center; font-size: 2.6mm; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; padding: 2mm 0; border-radius: 1.2mm; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="frame">
      <header>
        <div class="brand">
          <span class="mark">
            <svg viewBox="0 0 64 64" aria-label="${BRAND_NAME}" role="img"><g fill="none" stroke="#101012" transform="translate(1.486 9.343) scale(0.9535)"><path d="M20.17 13.832V6.227a11.83 11.83 0 0 1 23.66 0V13.832" stroke-width="2.4" stroke-linecap="butt" stroke-linejoin="round" fill="none"/><circle cx="32" cy="32" r="21.125" stroke-width="2.4" fill="none"/><path transform="translate(17.6 17.6) scale(1.2)" d="M12.003 1.716c-1.37 0-2.7.27-3.948.78A10.18 10.18 0 0 0 2.66 7.901a10.136 10.136 0 0 0-.797 3.954c0 .258.01.516.027.775a1.942 1.942 0 0 1-1.055 1.88L0 14.934v1.902l2.463-1.26.072-.032v.005l.77-.39.758-.385.066-.039 14.807-7.56 1.666-.847 3.392-1.732V2.694L17.792 5.86 3.744 13.025l-.104.055-.017-.115a8.286 8.286 0 0 1-.071-1.105c0-2.255.88-4.377 2.474-5.977a8.462 8.462 0 0 1 2.71-1.82 8.513 8.513 0 0 1 3.2-.654h.067a8.41 8.41 0 0 1 4.09 1.055l1.628-.83.126-.066a10.11 10.11 0 0 0-5.845-1.853zM24 7.143 5.047 16.808l-1.666.847L0 19.382v1.902l3.282-1.671 2.91-1.485 14.058-7.153.105-.055.016.115c.05.369.072.743.072 1.11 0 2.255-.88 4.383-2.475 5.978a8.461 8.461 0 0 1-2.71 1.82 8.305 8.305 0 0 1-3.2.654h-.06c-1.441 0-2.86-.369-4.102-1.061l-.066.033-1.683.857c.594.418 1.232.776 1.903 1.062a10.11 10.11 0 0 0 3.947.797 10.09 10.09 0 0 0 7.17-2.975 10.136 10.136 0 0 0 2.969-7.18c0-.259-.005-.523-.027-.781a1.942 1.942 0 0 1 1.055-1.88L24 9.044z" fill="#101012" stroke="none"/></g></svg>
          </span>
          <div>
            <h1>${BRAND_NAME} Certificate</h1>
            <p class="sub">Stellar ${escapeHtml(doc.networkLabel ?? "Network")} · Cold Storage</p>
          </div>
        </div>
        <div class="meta">
          <span class="chip">${label}</span><br/>
          Issued ${date}${doc.path ? `<br/><span style="font-family:ui-monospace,Menlo,monospace">${escapeHtml(doc.path)}</span>` : ""}
        </div>
      </header>

      <main>
        <div class="panel">
          <p class="ptitle">Public Address</p>
          <p class="psub">Shareable — receive funds</p>
          <img class="qr" src="${doc.pubQrDataUrl}" alt="Public address QR" />
          <p class="mono">${chunk4(escapeHtml(doc.publicKey))}</p>
        </div>
        <div class="panel secret">
          <p class="ptitle">${doc.kind === "mnemonic" ? "Recovery Phrase" : "Secret Key"}</p>
          <p class="psub">Do not share — withdrawal authority</p>
          <img class="qr" src="${doc.secQrDataUrl}" alt="Secret material QR" />
          ${secretBlock}
        </div>
      </main>

      <footer>
        <div class="col">
          <h4>Storage</h4>
          Keep this certificate offline in a secure, fireproof location. Never photograph, email or upload it.
        </div>
        <div class="col">
          <h4>Compatibility</h4>
          ${doc.kind === "mnemonic" ? "BIP-39 / SLIP-0010 — recoverable with Trezor &amp; Ledger hardware wallets." : "Stellar Ed25519 secret key — importable into any Stellar wallet."}
        </div>
        <div class="col">
          <h4>Verification</h4>
          Address fingerprint <span style="font-family:ui-monospace,Menlo,monospace">${fingerprint}</span> · Generated client-side, no network transmission.
        </div>
      </footer>

      <div class="strip">Anyone holding this certificate controls 100% of the funds on this account</div>
    </div>
  </div>
  <script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 250); });</script>
</body>
</html>`;
}

/** Opens the designed certificate in a new window and auto-triggers print. */
export function openPaperWalletPrint(doc: PaperWalletDoc): void {
  const html = buildPaperWalletHtml(doc);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const win = window.open(url, "_blank");
  if (!win) {
    // Popup blocked — fall back to navigating a hidden iframe print path is
    // overkill; surface a quiet failure via console and let the user retry.
    console.error("Popup blocked: allow popups to export the PDF certificate.");
  }
  // Revoke later — the document must finish loading first.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
