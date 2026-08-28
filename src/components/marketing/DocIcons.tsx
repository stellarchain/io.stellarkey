/*
 * The line icons used across the trust-centre documents. One stroke weight,
 * one grid, currentColor throughout, so a heading, a highlight and a callout
 * can each colour the same mark differently without a second copy of it.
 */
function Ico({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function DocCompass() {
  return <Ico><circle cx="12" cy="12" r="8.4" /><path d="m14.9 9.1-1.6 4.2-4.2 1.6 1.6-4.2Z" /></Ico>;
}

export function DocCheck() {
  return <Ico><circle cx="12" cy="12" r="8.4" /><path d="M8.4 12.2 10.9 14.7 15.8 9.6" /></Ico>;
}

export function DocShield() {
  return <Ico><path d="M12 3 5 6v5.5c0 4.2 2.9 7.6 7 9.5 4.1-1.9 7-5.3 7-9.5V6Z" /><path d="M9.2 12.2 11.2 14.2 15 10.4" /></Ico>;
}

export function DocAlert() {
  return <Ico><path d="M12 4.4 21 19.6H3Z" /><path d="M12 10v4M12 17h.01" /></Ico>;
}

export function DocLock() {
  return <Ico><rect x="4" y="10.5" width="16" height="10.5" rx="2.4" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></Ico>;
}

export function DocFingerprint() {
  return <Ico><path d="M12 4a6 6 0 0 0-6 6v2M12 4a6 6 0 0 1 6 6v3.5M9 11a3 3 0 0 1 6 0v4M12 11v6M6 15v1.5a4 4 0 0 0 .8 2.4M18 16v1.5" /></Ico>;
}

export function DocGlobe() {
  return <Ico><circle cx="12" cy="12" r="8.4" /><path d="M3.6 12h16.8M12 3.6c4.2 4.6 4.2 11.8 0 16.8-4.2-5-4.2-12.2 0-16.8Z" /></Ico>;
}

export function DocCycle() {
  return <Ico><path d="M20 11a8 8 0 0 0-13.6-4.6L4 8.6" /><path d="M4 4.6v4h4" /><path d="M4 13a8 8 0 0 0 13.6 4.6L20 15.4" /><path d="M20 19.4v-4h-4" /></Ico>;
}

export function DocEyeOff() {
  return <Ico><path d="M3 3l18 18M10.6 6.3A9.6 9.6 0 0 1 12 6.2c5 0 9 5.8 9 5.8a17 17 0 0 1-2.8 3.4M6.3 8.2A17 17 0 0 0 3 12s4 5.8 9 5.8a8.9 8.9 0 0 0 3.5-.7" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Ico>;
}

export function DocFile() {
  return <Ico><path d="M14 3H7.4A1.4 1.4 0 0 0 6 4.4v15.2A1.4 1.4 0 0 0 7.4 21h9.2a1.4 1.4 0 0 0 1.4-1.4V7Z" /><path d="M14 3v4h4M9 12h6M9 16h4" /></Ico>;
}

export function DocScales() {
  return <Ico><path d="M12 4v16M7 20h10M12 7 5 9.5M12 7l7 2.5" /><path d="M2.6 14.4 5 9.5l2.4 4.9a2.6 2.6 0 0 1-4.8 0ZM16.6 14.4 19 9.5l2.4 4.9a2.6 2.6 0 0 1-4.8 0Z" /></Ico>;
}

export function DocChip() {
  return <Ico><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5" /></Ico>;
}

export function DocKey() {
  return <Ico><circle cx="8.5" cy="12" r="4" /><path d="M12.5 12H21M18 12v3M21 12v2.4" /></Ico>;
}

export function DocClock() {
  return <Ico><circle cx="12" cy="12" r="8.4" /><path d="M12 7.4V12l3 1.8" /></Ico>;
}

export function DocExport() {
  return <Ico><rect x="8" y="9" width="8" height="12" rx="2" /><path d="M12 9V4M9.6 6.4 12 4l2.4 2.4" /></Ico>;
}

export function DocBook() {
  return <Ico><path d="M4 5.2A1.2 1.2 0 0 1 5.2 4H10a3 3 0 0 1 3 3v13a2.4 2.4 0 0 0-2.4-2.4H5.2A1.2 1.2 0 0 1 4 16.4Z" /><path d="M20 5.2A1.2 1.2 0 0 0 18.8 4H14a3 3 0 0 0-3 3v13a2.4 2.4 0 0 1 2.4-2.4h5.4A1.2 1.2 0 0 0 20 16.4Z" /></Ico>;
}
