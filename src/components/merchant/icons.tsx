import { STELLAR_MARK_PATH } from "@/components/icons";

interface IconProps {
  size?: number;
  className?: string;
}

function base(size = 16) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function IconStorefront(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M3 8.5 4.7 4a2 2 0 0 1 1.9-1.3h10.8a2 2 0 0 1 1.9 1.3L21 8.5" />
      <path d="M3 8.5h18" />
      <path d="M4.8 8.5V19a2 2 0 0 0 2 2h10.4a2 2 0 0 0 2-2V8.5" />
      <path d="M9.6 21v-4.2a2.4 2.4 0 0 1 4.8 0V21" />
    </svg>
  );
}

/**
 * Merchant identity mark: the official Stellar symbol on the receipt — the
 * proof of every sale — with the container stroked at 1 to sit level with the
 * glyph's native line, completing the brand family alongside the lock
 * (LogoMark) and the shield (IconShieldStellar).
 */
export function IconReceiptStellar(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path
        d="M5 20.5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v15.5L16.7 21.4 14.4 20.5 12 21.4 9.6 20.5 7.3 21.4Z"
        strokeWidth="1"
      />
      <path
        transform="translate(7.44 6.63) scale(0.38)"
        d={STELLAR_MARK_PATH}
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

export function IconReceipt(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M5 20.5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v15.5L16.7 21.4 14.4 20.5 12 21.4 9.6 20.5 7.3 21.4Z" />
      <path d="M8.5 8h7" />
      <path d="M8.5 11.5h7" />
      <path d="M8.5 15h4" />
    </svg>
  );
}

export function IconTag(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.8 12V4.8a2 2 0 0 1 2-2H12a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8Z" />
      <circle cx="7.6" cy="7.6" r="1.4" />
    </svg>
  );
}

export function IconBars(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M3.5 3v15.5a2 2 0 0 0 2 2H21" />
      <path d="M8 17.5V13" />
      <path d="M12.5 17.5V8" />
      <path d="M17 17.5v-6.5" />
    </svg>
  );
}

export function IconCart(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M2.5 3h2.2l2.4 11.3a1.8 1.8 0 0 0 1.77 1.4h8.36a1.8 1.8 0 0 0 1.77-1.42L20.8 7H5.42" />
      <circle cx="9" cy="20" r="1.3" />
      <circle cx="17.5" cy="20" r="1.3" />
    </svg>
  );
}

export function IconPercent(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M18.5 5.5 5.5 18.5" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </svg>
  );
}

export function IconBackspace(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M20 4.5H9.6a2 2 0 0 0-1.42.59l-5.6 5.6a1.85 1.85 0 0 0 0 2.62l5.6 5.6a2 2 0 0 0 1.42.59H20a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2Z" />
      <path d="m17 9.5-5 5" />
      <path d="m12 9.5 5 5" />
    </svg>
  );
}

export function IconQr(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <path d="M14 14h.01" />
      <path d="M17.6 14h.01" />
      <path d="M14 17.6h.01" />
      <path d="M21.2 17.6h.01" />
      <path d="M17.6 21h.01" />
    </svg>
  );
}

export function IconClock(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6.5 12 12 15.8 14.2" />
    </svg>
  );
}

export function IconRefund(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export function IconPrinter(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M6.5 9.5V3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6" />
      <path d="M6.5 17.5H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1.5" />
      <rect x="6.5" y="14" width="11" height="7.5" rx="1.5" />
      <path d="M18 12h.01" />
    </svg>
  );
}

export function IconCheckCircle(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <circle cx="12" cy="12" r="10" />
      <path d="m8.5 12.2 2.4 2.4 4.6-5.2" />
    </svg>
  );
}

export function IconXCircle(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

export function IconInfo(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16.5v-5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export function IconTerminal(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="m8 9.5 2.5 2.5L8 14.5" />
      <path d="M13 14.5h3.5" />
    </svg>
  );
}
