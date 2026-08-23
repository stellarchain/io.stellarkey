"use client";

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
<title>Stellar Paper Wallet — ${label}</title>
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
  .mark { width: 11.5mm; height: 11.5mm; border: 0.5mm solid #101012; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  .mark svg { width: 6.5mm; height: 6.5mm; }
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
            <svg viewBox="0 0 24 24" fill="none" stroke="#101012" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>
          </span>
          <div>
            <h1>Wallet Certificate</h1>
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
