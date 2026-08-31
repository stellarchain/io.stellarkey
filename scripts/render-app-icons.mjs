/**
 * Regenerates every raster app icon from one piece of artwork.
 *
 * The mark is lifted verbatim out of src/app/icon.svg — the official Stellar
 * glyph must not be redrawn — and only its transform is recomputed, so the two
 * icon families differ in size alone:
 *
 *   any      the tile a launcher shows as-is. iOS and Android round the
 *            corners themselves, so the mark can fill most of it.
 *   maskable the tile a launcher may crop to any shape. Everything has to sit
 *            inside a circle of radius 40% of the tile, which is a much
 *            smaller box, so this family is deliberately the smaller mark.
 *
 * Run after changing the mark:  node scripts/render-app-icons.mjs
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const ICON_SVG = "src/app/icon.svg";
const FAVICON_ICO = "src/app/favicon.ico";
const BACKGROUND = "#000000";
const FOREGROUND = "#FFFFFF";
const FAVICON_FOREGROUND = "#000000";
const CANVAS = 64;

/** How much of the tile's width the mark spans, per family. */
const ANY_COVERAGE = 0.78;
/** Maskable art must fit a circle of this radius, as a fraction of the tile. */
const SAFE_RADIUS = 0.4;

/** The mark itself, without whatever transform the current file wraps it in. */
function readArtwork() {
  const svg = readFileSync(ICON_SVG, "utf8");
  const open = svg.indexOf('<g fill="none" stroke="currentColor"');
  if (open === -1) throw new Error(`${ICON_SVG} no longer contains the mark`);
  // matched by depth: the mark sits inside a sizing wrapper, so reaching for
  // the last </g> swallows the wrapper's close too and leaves the rebuilt file
  // unparseable — which a browser silently tolerates in HTML but not as an icon
  let depth = 0;
  for (const tag of svg.slice(open).matchAll(/<(\/?)g[\s>]/g)) {
    depth += tag[1] ? -1 : 1;
    if (depth === 0) return svg.slice(open, open + tag.index + tag[0].length);
  }
  throw new Error(`${ICON_SVG} has an unbalanced mark group`);
}

const artwork = readArtwork();
const page = (body) => `<body style="margin:0;background:${BACKGROUND}">${body}</body>`;
const svg = (size, transform) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${CANVAS} ${CANVAS}">` +
  `<rect width="${CANVAS}" height="${CANVAS}" fill="${BACKGROUND}"/>` +
  `<g transform="${transform}" color="${FOREGROUND}">${artwork}</g>` +
  `</svg>`;
const faviconSvg = (size, transform) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${CANVAS} ${CANVAS}">` +
  `<g transform="${transform}" color="${FAVICON_FOREGROUND}">${artwork}</g>` +
  `</svg>`;

function singleImageIco(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = size === 256 ? 0 : size;
  header[7] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, png]);
}

const browser = await chromium.launch();
const probe = await browser.newPage({ viewport: { width: CANVAS, height: CANVAS } });
await probe.setContent(page(svg(CANVAS, "translate(0 0)")));

// Measure the mark rather than assuming: the stroke sits outside the path box,
// so a geometry-only bbox would place it slightly wrong.
const box = await probe.evaluate(() => {
  const g = document.querySelector("svg > g");
  const { x, y, width, height } = g.getBBox({ stroke: true });
  return { x, y, width, height };
});
await probe.close();

/** Centre the mark on the tile and scale it to span `coverage` of the width. */
function transformFor(coverage) {
  const scale = (coverage * CANVAS) / Math.max(box.width, box.height);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const half = CANVAS / 2;
  return `translate(${(half - cx * scale).toFixed(4)} ${(half - cy * scale).toFixed(4)}) scale(${scale.toFixed(6)})`;
}

// The largest mark whose corners still land inside the maskable safe circle.
const halfDiagonal = Math.hypot(box.width, box.height) / 2;
const maskableCoverage =
  ((SAFE_RADIUS * CANVAS) / halfDiagonal) * (Math.max(box.width, box.height) / CANVAS);

const ANY = transformFor(ANY_COVERAGE);
const MASKABLE = transformFor(maskableCoverage);

const TARGETS = [
  ["public/icon-192.png", 192, ANY],
  ["public/icon-512.png", 512, ANY],
  ["public/apple-touch-icon.png", 180, ANY],
  ["src/app/apple-icon.png", 180, ANY],
  ["src/app/apple-icon1.png", 152, ANY],
  ["src/app/apple-icon2.png", 167, ANY],
  ["public/icon-maskable-192.png", 192, MASKABLE],
  ["public/icon-maskable-512.png", 512, MASKABLE],
  ["public/icon-maskable-1024.png", 1024, MASKABLE],
];

for (const [out, size, transform] of TARGETS) {
  const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(page(svg(size, transform)));
  await p.waitForTimeout(60);
  await p.screenshot({ path: out, omitBackground: false });
  await p.close();
  console.log(`${out.padEnd(34)} ${String(size).padStart(4)}px  ${transform === ANY ? "any" : "maskable"}`);
}

const faviconSize = 32;
const faviconPage = await browser.newPage({
  viewport: { width: faviconSize, height: faviconSize },
  deviceScaleFactor: 1,
});
await faviconPage.setContent(
  `<body style="margin:0;background:transparent">${faviconSvg(faviconSize, ANY)}</body>`,
);
const faviconPng = await faviconPage.screenshot({ omitBackground: true });
await faviconPage.close();
writeFileSync(FAVICON_ICO, singleImageIco(faviconPng, faviconSize));
await browser.close();

// The favicon shares the "any" sizing so the mark never drifts, but stays a
// transparent black glyph instead of inheriting the launcher's black tile.
writeFileSync(ICON_SVG,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <g transform="${ANY}" color="${FAVICON_FOREGROUND}">${artwork}</g>
</svg>
`);
console.log(`\nmark bbox ${box.width.toFixed(2)}x${box.height.toFixed(2)} · any ${(ANY_COVERAGE * 100).toFixed(0)}% · maskable ${(maskableCoverage * 100).toFixed(0)}%`);
