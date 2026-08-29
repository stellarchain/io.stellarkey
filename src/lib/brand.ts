export const BRAND_NAME = "StellarKey";
export const BRAND_ORIGIN = "https://stellarkey.io";
export const SOURCE_REPOSITORY_URL = "https://github.com/stellarchain/io.stellarkey";
export const APPLICATION_VERSION = "1.1.0";
export const BUILD_COMMIT = process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "development";
export const BUILD_IS_DIRTY = process.env.NEXT_PUBLIC_BUILD_DIRTY === "true";
export const SOURCE_COMMIT_URL = `${SOURCE_REPOSITORY_URL}/commit/${BUILD_COMMIT}`;
export const SOURCE_RELEASE_URL =
  `${SOURCE_REPOSITORY_URL}/releases/tag/v${APPLICATION_VERSION}`;
export const BRAND_DESCRIPTION =
  "A self-custodial Stellar wallet. Keys are generated and encrypted in your browser and never leave your device.";
export const COPYRIGHT_OWNER = BRAND_NAME;
export const COPYRIGHT_YEAR = 2026;
export const PUBLIC_OPEN_GRAPH_IMAGE = Object.freeze({
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: `${BRAND_NAME}: self-custodial Stellar wallet`,
});

export const PUBLIC_ROUTES = Object.freeze({
  /** The public landing page. The wallet itself lives at `app`. */
  home: "/",
  app: "/app",
  about: "/about",
  privacy: "/privacy",
  terms: "/terms",
  security: "/security",
  support: "/support",
  changelog: "/changelog",
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
