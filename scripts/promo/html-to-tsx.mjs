/**
 * Converts the artifact markup into JSX. The artifact inlines every image as a
 * data URI, which is right for a single self-contained file and wrong for a
 * built site: here they become real files under /marketing so the browser can
 * cache them and the HTML stays small.
 */
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Intrinsic size of a simple lossy WebP, read from the VP8 frame header. The
 * screenshots are all plain VP8, so this stays a header read rather than a
 * dependency; anything else throws instead of guessing.
 */
function webpSize(file) {
  const b = readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("not a WebP: " + file);
  }
  if (b.toString("ascii", 12, 16) !== "VP8 ") throw new Error("unsupported WebP variant: " + file);
  // 4-byte chunk size, 3-byte frame tag, then the 0x9d 0x01 0x2a start code
  const p = 20 + 3;
  if (b[p] !== 0x9d || b[p + 1] !== 0x01 || b[p + 2] !== 0x2a) {
    throw new Error("bad VP8 start code: " + file);
  }
  return { width: b.readUInt16LE(p + 3) & 0x3fff, height: b.readUInt16LE(p + 5) & 0x3fff };
}

const SP = process.argv[2];
let html = readFileSync(SP + "/v2-body.html", "utf8");

// assets: {{name}} placeholders become public paths, not base64
html = html.replace(/\{\{QR\}\}/g, "__QR__");
html = html.replace(/\{\{MARK\}\}/g, "__MARK__");
html = html.replace(/src="\{\{([a-z0-9-]+)\}\}"/gi, (m, n) => `src="/marketing/${n}.webp"`);

// strip the parts the component owns
html = html.replace(/<header>[\s\S]*?<\/header>\s*/, "");
html = html.replace(/<footer>[\s\S]*?<\/footer>\s*/, "");
html = html.replace(/^\s*<main id="top">/, "").replace(/<\/main>\s*$/, "");

const jsx = html
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/\bclass=/g, "className=")
  .replace(/\bfor=/g, "htmlFor=")
  .replace(/\bstroke-width=/g, "strokeWidth=")
  .replace(/\bstroke-linecap=/g, "strokeLinecap=")
  .replace(/\bstroke-linejoin=/g, "strokeLinejoin=")
  .replace(/\bfill-rule=/g, "fillRule=")
  .replace(/\bclip-rule=/g, "clipRule=")
  .replace(/\bshape-rendering=/g, "shapeRendering=")
  .replace(/\bstop-color=/g, "stopColor=")
  .replace(/\bgradientUnits=/g, "gradientUnits=")
  .replace(/\baria-hidden="true"/g, 'aria-hidden={true}')
  .replace(/<(br|hr|img|input|source)([^>]*?)\/?>/g, (m, tag, attrs) => `<${tag}${attrs.replace(/\s*\/$/, "")} />`)
  // inline styles must become objects
  .replace(/style="([^"]*)"/g, (m, decls) => {
    const obj = decls.split(";").filter(Boolean).map((d) => {
      const idx = d.indexOf(":");
      const k = d.slice(0, idx).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const v = d.slice(idx + 1).trim();
      return `${k}: "${v}"`;
    }).join(", ");
    return `style={{ ${obj} }}`;
  })
  .replace(/&nbsp;/g, " ")
  // straight apostrophes are unescaped entities to JSX, and typographic ones
  // read better in body copy anyway
  .replace(/([A-Za-z])'([A-Za-z])/g, "$1’$2")
  // a bare // text child parses as a comment to the JSX linter
  .replace(/>\/\/</g, '>{"//"}<')
  // the primary call to action opens the wallet; it is not an in-page jump
  .replace(/href="#(start|top)">Open the app</g, 'href="/app">Open the app<')
  // a screenshot with no intrinsic size reflows the section when it lands, and
  // there are twenty of them below the fold
  .replace(/<img src="\/marketing\/([a-z0-9-]+)\.webp"([^>]*?)\/>/g, (m, name, rest) => {
    const { width, height } = webpSize(`public/marketing/${name}.webp`);
    return `<img src="/marketing/${name}.webp"${rest} width={${width}} height={${height}} loading="lazy" decoding="async" />`;
  });

writeFileSync("/tmp/promo/landing.jsx", jsx);
const bad = [...jsx.matchAll(/\bclass=|\bstyle="/g)].length;
console.log(`converted · ${(jsx.length / 1024).toFixed(0)} KB · leftover html attrs: ${bad}`);
console.log("placeholders:", (jsx.match(/__(QR|MARK)__/g) || []).length);
