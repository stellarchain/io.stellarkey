import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readText = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function pngSize(path) {
  const png = readFileSync(new URL(`../${path}`, import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

test("the visible wallet logo is also used for installable app icons", () => {
  const logo = readText("src/components/icons.tsx");
  const sourceIcon = readText("src/app/icon.svg");
  const manifest = JSON.parse(readText("public/manifest.json"));
  const layout = readText("src/app/layout.tsx");

  // This distinctive wallet-pocket path anchors every generated icon to LogoMark artwork.
  const walletPocket = "M7 25C7 22.7909 8.79086 21 11 21H23";
  assert.match(logo, new RegExp(walletPocket));
  assert.match(sourceIcon, new RegExp(walletPocket));

  assert.deepEqual(pngSize("src/app/apple-icon.png"), { width: 180, height: 180 });
  assert.deepEqual(pngSize("public/icon-192.png"), { width: 192, height: 192 });
  assert.deepEqual(pngSize("public/icon-512.png"), { width: 512, height: 512 });

  assert.deepEqual(
    manifest.icons.map(({ src, sizes, type }) => ({ src, sizes, type })),
    [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  );
  assert.doesNotMatch(layout, /apple:\s*"\/icon\.svg"/);
});
