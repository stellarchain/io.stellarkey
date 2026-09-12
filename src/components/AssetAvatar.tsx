'use client';

import { IconStellar } from './icons';
import { PrivateShieldNotch } from './PrivateShieldNotch';

export function AssetAvatar({
  code,
  isNative,
  logoUrl = null,
  background = '#5E5CE6',
  size = 36,
  privatePayment = false,
}: {
  code: string;
  isNative: boolean;
  logoUrl?: string | null;
  background?: string;
  size?: number;
  privatePayment?: boolean;
}) {
  const iconSize = Math.round(size * 0.56);
  const fontSize = Math.max(10, Math.round(size * 0.3));
  const privateGround = size > 40 ? 21 : 17;
  const privateShield = size > 40 ? 17 : 13;

  return (
    <span className="relative inline-flex shrink-0">
      {isNative ? (
        <span
          aria-hidden="true"
          className="flex items-center justify-center rounded-full border border-white/[0.12] text-[var(--color-oncolor)] shadow-inner"
          style={{ width: size, height: size, background: '#000000' }}
        >
          <IconStellar size={iconSize} />
        </span>
      ) : logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          referrerPolicy="no-referrer"
          alt=""
          width={size}
          height={size}
          className="rounded-full object-cover shadow-inner"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          aria-hidden="true"
          className="mono flex items-center justify-center rounded-full font-bold text-[var(--color-oncolor)] shadow-inner"
          style={{ width: size, height: size, background, fontSize }}
        >
          {code.slice(0, 3)}
        </span>
      )}
      {privatePayment ? (
        <PrivateShieldNotch
          ground={privateGround}
          shield={privateShield}
          label="Private asset"
        />
      ) : null}
    </span>
  );
}
