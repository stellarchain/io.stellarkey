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

export function LogoMark({ size = 34 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className="shrink-0">
      <defs>
        <linearGradient id="logo-bg-grad" x1="32" y1="0" x2="32" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1c1c1e" />
          <stop offset="100%" stopColor="#000000" />
        </linearGradient>
        <linearGradient id="logo-card-top-grad" x1="0" y1="12" x2="64" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0A84FF" />
          <stop offset="100%" stopColor="#5E5CE6" />
        </linearGradient>
        <linearGradient id="logo-card-mid-grad" x1="0" y1="18" x2="64" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#64D2FF" />
          <stop offset="100%" stopColor="#30D158" />
        </linearGradient>
        <linearGradient id="logo-pouch-grad" x1="32" y1="26" x2="32" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2c2c2e" />
          <stop offset="100%" stopColor="#121214" />
        </linearGradient>
      </defs>

      {/* iOS App Icon Squircle Background */}
      <rect width="64" height="64" rx="14.5" fill="url(#logo-bg-grad)" />
      <rect x="0.5" y="0.5" width="63" height="63" rx="14" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />

      {/* Back Card Layer */}
      <rect x="14" y="10" width="36" height="24" rx="4.5" fill="url(#logo-card-top-grad)" opacity="0.95" />
      <rect x="14.5" y="10.5" width="35" height="23" rx="4" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />

      {/* Middle Card Layer */}
      <rect x="10" y="16" width="44" height="24" rx="5" fill="url(#logo-card-mid-grad)" opacity="0.95" />
      <rect x="10.5" y="16.5" width="43" height="23" rx="4.5" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />

      {/* Front Wallet Pocket */}
      <path d="M7 25C7 22.7909 8.79086 21 11 21H23C24.5 21 26 22.5 27 24C28 25.5 29.5 26.5 32 26.5C34.5 26.5 36 25.5 37 24C38 22.5 39.5 21 41 21H53C55.2091 21 57 22.7909 57 25V49C57 52.3137 54.3137 55 51 55H13C9.68629 55 7 52.3137 7 49V25Z" fill="url(#logo-pouch-grad)" />
      <path d="M7.5 25C7.5 23.067 9.067 21.5 11 21.5H23C24.3 21.5 25.6 22.8 26.5 24.3C27.6 25.9 29.3 27 32 27C34.7 27 36.4 25.9 37.5 24.3C38.4 22.8 39.7 21.5 41 21.5H53C54.933 21.5 56.5 23.067 56.5 25V49C56.5 52.0376 54.0376 54.5 51 54.5H13C9.96243 54.5 7.5 52.0376 7.5 49V25Z" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />

      {/* Subtle Specular Lighting Edge */}
      <path d="M11 22H23C24.5 22 26 23.5 27 25" stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeLinecap="round" />
      <path d="M41 22H53" stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeLinecap="round" />

      {/* Stellar Logo Emblem (Crisp, High-Contrast White) */}
      <g transform="translate(32, 40) rotate(-22)">
        <path d="M -8.2 -3.4 A 8.8 8.8 0 0 1 8.2 -3.4" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M -8.2 3.4 A 8.8 8.8 0 0 0 8.2 3.4" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
        <line x1="-12" y1="-3.4" x2="12" y2="-3.4" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
        <line x1="-12" y1="3.4" x2="12" y2="3.4" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export function IconSend(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

export function IconReceive(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M3 15v4c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function IconArrowDownLeft(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <line x1="17" y1="7" x2="7" y2="17" />
      <polyline points="17 17 7 17 7 7" />
    </svg>
  );
}

export function IconArrowUpRight(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

export function IconCopy(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

export function IconGear(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconLock(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function IconExternal(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export function IconChevronDown(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconRefresh(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

export function IconTrash(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

export function IconEye(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconEyeOff(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

export function IconShield(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

export function IconSwap(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="m16 3 4 4-4 4" />
      <path d="M20 7H4" />
      <path d="m8 21-4-4 4-4" />
      <path d="M4 17h16" />
    </svg>
  );
}

export function IconUserPlus(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  );
}

export function IconKey(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  );
}

export function IconDownload(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function IconAlert(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export function IconWallet(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

export function IconHome(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

export function IconList(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

export function IconSearch(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function IconShare(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

export function IconQrScan(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <rect x="7" y="7" width="10" height="10" rx="1" strokeDasharray="2 2" />
    </svg>
  );
}

export function IconCamera(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

export function IconFingerprint(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
      <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
      <path d="M2 16h.01" />
      <path d="M21.8 16c.2-2 .131-5.354 0-6" />
      <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
      <path d="M8.65 22c.21-.66.45-1.32.57-2" />
      <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
    </svg>
  );
}

export function IconSliders(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

export function IconClose(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function IconBook(p: IconProps) {
  return (
    <svg {...base(p.size)} className={p.className}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
      <path d="M6 6h10" />
      <path d="M6 10h10" />
    </svg>
  );
}
