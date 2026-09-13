export interface TrezorAddressOptions {
  full?: boolean;
  head?: number;
  tail?: number;
}

/**
 * Format a Stellar address like a hardware wallet: four-character verification
 * groups with a centered ellipsis in compact contexts. The underlying value is
 * never changed by this helper; this is presentation only.
 */
export function formatTrezorAddress(
  value: string,
  { full = false, head = 8, tail = 8 }: TrezorAddressOptions = {},
): string {
  if (!value) return "";
  if (/\s/.test(value)) return value;

  const chunk = (part: string) => part.match(/.{1,4}/g) ?? [part];
  if (full || value.length <= head + tail + 4) return chunk(value).join(" ");

  return [...chunk(value.slice(0, head)), "…", ...chunk(value.slice(-tail))].join(" ");
}
