export const BRAND_NAME = "StellarKey";
export const BRAND_ORIGIN = "https://stellarkey.io";
export const BRAND_DESCRIPTION =
  "A self-custodial Stellar wallet. Keys are generated and encrypted in your browser and never leave your device.";
export const COPYRIGHT_OWNER = BRAND_NAME;
export const COPYRIGHT_YEAR = 2026;

export const PUBLIC_ROUTES = Object.freeze({
  home: "/",
  about: "/about/",
  privacy: "/privacy/",
  terms: "/terms/",
  security: "/security/",
} as const);

const CONTACT_CODEPOINTS = Object.freeze({
  support: Object.freeze([
    115, 117, 112, 112, 111, 114, 116, 64, 115, 116, 101, 108, 108, 97, 114, 107, 101,
    121, 46, 105, 111,
  ]),
  security: Object.freeze([
    115, 101, 99, 117, 114, 105, 116, 121, 64, 115, 116, 101, 108, 108, 97, 114, 107,
    101, 121, 46, 105, 111,
  ]),
} as const);

export type ContactChannel = keyof typeof CONTACT_CODEPOINTS;

export function decodeContactAddress(channel: ContactChannel): string {
  return String.fromCharCode(...CONTACT_CODEPOINTS[channel]);
}
