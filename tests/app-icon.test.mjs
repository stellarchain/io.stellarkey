import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { inflateSync } from "node:zlib";

const readText = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function pngInfo(path) {
  const png = readFileSync(new URL(`../${path}`, import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    colorType: png[25],
  };
}

const decodedPngs = new Map();

function decodePng(path) {
  if (decodedPngs.has(path)) return decodedPngs.get(path);
  const png = readFileSync(new URL(`../${path}`, import.meta.url));
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const bitDepth = png[24];
  const colorType = png[25];
  assert.equal(bitDepth, 8, `${path} must use 8-bit channels`);
  assert.equal(colorType, 2, `${path} must be full-bleed RGB without transparent corners`);

  const idat = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  const bytesPerPixel = 3;
  const rowBytes = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idat));
  const rows = Array.from({ length: height }, () => Buffer.alloc(rowBytes));
  let offset = 0;
  const paeth = (a, b, c) => {
    const estimate = a + b - c;
    const distanceA = Math.abs(estimate - a);
    const distanceB = Math.abs(estimate - b);
    const distanceC = Math.abs(estimate - c);
    return distanceA <= distanceB && distanceA <= distanceC ? a : distanceB <= distanceC ? b : c;
  };

  for (let row = 0; row < height; row += 1) {
    const filter = raw[offset];
    offset += 1;
    for (let column = 0; column < rowBytes; column += 1) {
      const encoded = raw[offset + column];
      const left = column >= bytesPerPixel ? rows[row][column - bytesPerPixel] : 0;
      const above = row > 0 ? rows[row - 1][column] : 0;
      const upperLeft = row > 0 && column >= bytesPerPixel
        ? rows[row - 1][column - bytesPerPixel]
        : 0;
      const predictor = filter === 0
        ? 0
        : filter === 1
          ? left
          : filter === 2
            ? above
            : filter === 3
              ? Math.floor((left + above) / 2)
              : paeth(left, above, upperLeft);
      assert.ok(filter >= 0 && filter <= 4, `${path} uses unsupported PNG filter ${filter}`);
      rows[row][column] = (encoded + predictor) & 0xff;
    }
    offset += rowBytes;
  }

  const decoded = { width, height, rows, bytesPerPixel };
  decodedPngs.set(path, decoded);
  return decoded;
}

function pngPixel(path, x, y) {
  const { width, height, rows, bytesPerPixel } = decodePng(path);
  assert.ok(x >= 0 && x < width && y >= 0 && y < height);
  const pixel = x * bytesPerPixel;
  return [...rows[y].subarray(pixel, pixel + bytesPerPixel)];
}

function assertMaskableSafeZone(path) {
  const { width, height, rows, bytesPerPixel } = decodePng(path);
  assert.equal(width, height, `${path} must be square`);
  const background = [0, 0, 0];
  const radius = width * 0.4;
  let logoPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = x * bytesPerPixel;
      const isBackground = background.every((channel, index) => rows[y][offset + index] === channel);
      if (isBackground) continue;
      logoPixels += 1;
      const distance = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2);
      assert.ok(
        distance <= radius,
        `${path} has logo artwork outside the standard 40% maskable safe-zone radius`,
      );
    }
  }

  assert.ok(logoPixels > 0, `${path} must contain visible logo artwork`);
}

test("Next serves static install metadata and an Apple icon through native app routes", () => {
  const logo = readText("src/components/icons.tsx");
  const sourceIcon = readText("src/app/icon.svg");
  const publicLogoUrl = new URL("../public/stellarkey-logo.svg", import.meta.url);
  const paperWallet = readText("src/lib/paperwallet.ts");
  const layout = readText("src/app/layout.tsx");
  const nativeManifestUrl = new URL("../src/app/manifest.webmanifest", import.meta.url);

  assert.equal(existsSync(nativeManifestUrl), true, "manifest must be a static metadata file");
  assert.equal(existsSync(new URL("../src/app/manifest.ts", import.meta.url)), false);
  assert.equal(
    existsSync(new URL("../public/manifest.json", import.meta.url)),
    false,
    "a public manifest must not shadow Next's metadata route",
  );
  const manifest = JSON.parse(readFileSync(nativeManifestUrl, "utf8"));

  // The official Stellar glyph and the shackle over it anchor every generated
  // icon to LogoMark artwork. The glyph must appear unmodified: it is used
  // under Stellar's mark, so a redrawn or simplified copy is a defect.
  const stellarGlyph = "M12.003 1.716c-1.37 0-2.7.27-3.948.78";
  const shackle = "V6.227a11.83 11.83 0 0 1 23.66 0";
  assert.equal(existsSync(publicLogoUrl), true, "the supplied logo must remain available as public master artwork");
  const publicLogo = readFileSync(publicLogoUrl, "utf8");
  assert.match(publicLogo, /viewBox="0 0 64 64"/);
  assert.match(sourceIcon, /<rect width="64" height="64" fill="#000000"\/>/);
  // Served standalone, so it is parsed as XML rather than forgiving HTML: an
  // unbalanced group makes the favicon fail to load with no console error.
  assert.equal(
    (sourceIcon.match(/<g[\s>]/g) ?? []).length,
    (sourceIcon.match(/<\/g>/g) ?? []).length,
    "icon.svg has unbalanced <g> elements and will not parse",
  );
  assert.equal((sourceIcon.match(/<svg[\s>]/g) ?? []).length, 1);
  assert.match(sourceIcon, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  for (const [name, art] of [
    ["LogoMark", logo],
    ["icon.svg", sourceIcon],
    ["stellarkey-logo.svg", publicLogo],
    ["paper wallet", paperWallet],
  ]) {
    assert.match(art, new RegExp(stellarGlyph.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${name} must carry the official Stellar glyph`);
    assert.match(art, new RegExp(shackle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${name} must carry the lock shackle`);
  }

  assert.deepEqual(pngInfo("src/app/apple-icon.png"), {
    width: 180,
    height: 180,
    colorType: 2,
  });
  assert.deepEqual(pngInfo("src/app/apple-icon1.png"), {
    width: 152,
    height: 152,
    colorType: 2,
  });
  assert.deepEqual(pngInfo("src/app/apple-icon2.png"), {
    width: 167,
    height: 167,
    colorType: 2,
  });
  assert.deepEqual(pngInfo("public/icon-192.png"), {
    width: 192,
    height: 192,
    colorType: 2,
  });
  assert.deepEqual(pngInfo("public/icon-512.png"), {
    width: 512,
    height: 512,
    colorType: 2,
  });
  assert.deepEqual(pngInfo("public/icon-maskable-512.png"), {
    width: 512,
    height: 512,
    colorType: 2,
  });
  assert.deepEqual(pngInfo("public/icon-maskable-192.png"), {
    width: 192,
    height: 192,
    colorType: 2,
  });
  assert.deepEqual(pngInfo("public/icon-maskable-1024.png"), {
    width: 1024,
    height: 1024,
    colorType: 2,
  });

  for (const path of [
    "src/app/apple-icon.png",
    "src/app/apple-icon1.png",
    "src/app/apple-icon2.png",
    "public/apple-touch-icon.png",
    "public/icon-192.png",
    "public/icon-512.png",
    "public/icon-maskable-192.png",
    "public/icon-maskable-512.png",
    "public/icon-maskable-1024.png",
  ]) {
    const { width, height } = pngInfo(path);
    for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
      assert.deepEqual(pngPixel(path, x, y), [0, 0, 0], `${path} must be full-bleed StellarKey black`);
    }
  }

  // iOS resolves the home-screen icon from the manifest when a page is added
  // as a web app, and drops an icon whose URL carries a query string: the app
  // then lands on the Home Screen under a generated letter tile.
  for (const { src } of manifest.icons) {
    assert.doesNotMatch(src, /\?/, `${src} must not carry a query string`);
  }

  for (const path of [
    "public/icon-maskable-192.png",
    "public/icon-maskable-512.png",
    "public/icon-maskable-1024.png",
  ]) {
    assertMaskableSafeZone(path);
  }

  assert.deepEqual(
    manifest.icons.map(({ src, sizes, type, purpose }) => ({ src, sizes, type, purpose })),
    [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-1024.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  );
  assert.equal(manifest.id, "/app");
  assert.equal(manifest.start_url, "/app");
  // scope stays at the origin so the trust-centre pages open inside the app
  assert.equal(manifest.scope, "/");
  assert.doesNotMatch(layout, /manifest:\s*"\/manifest\.json"/);
  // iOS drops an apple-touch-icon whose URL carries a query string, and Next
  // fingerprints its generated icon routes that way, so the links must be
  // declared against the plain paths instead.
  assert.match(layout, /icons:\s*\{/);
  assert.match(layout, /url:\s*"\/apple-touch-icon\.png",\s*sizes:\s*"180x180"/);
  for (const url of ["/icon.svg", "/apple-touch-icon.png", "/apple-icon1.png", "/apple-icon2.png"]) {
    assert.ok(layout.includes(`url: "${url}"`), `${url} must be linked at its plain path`);
  }
  assert.doesNotMatch(layout, /url:\s*"[^"]*\?[^"]*"/, "icon links must not carry a query string");
});
