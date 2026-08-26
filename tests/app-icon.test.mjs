import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

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

test("Next serves install metadata and an Apple icon through native app routes", async () => {
  const logo = readText("src/components/icons.tsx");
  const sourceIcon = readText("src/app/icon.svg");
  const layout = readText("src/app/layout.tsx");
  const nativeManifestUrl = new URL("../src/app/manifest.ts", import.meta.url);

  assert.equal(existsSync(nativeManifestUrl), true, "manifest must use Next's metadata route");
  assert.equal(
    existsSync(new URL("../public/manifest.json", import.meta.url)),
    false,
    "a public manifest must not shadow Next's metadata route",
  );
  const { default: createManifest } = await import("../src/app/manifest.ts");
  const manifest = createManifest();

  // This distinctive wallet-pocket path anchors every generated icon to LogoMark artwork.
  const walletPocket = "M7 25C7 22.7909 8.79086 21 11 21H23";
  assert.match(logo, new RegExp(walletPocket));
  assert.match(sourceIcon, new RegExp(walletPocket));

  assert.deepEqual(pngInfo("src/app/apple-icon.png"), {
    width: 180,
    height: 180,
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

  assert.deepEqual(
    manifest.icons.map(({ src, sizes, type, purpose }) => ({ src, sizes, type, purpose })),
    [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  );
  assert.equal(manifest.id, "/");
  assert.equal(manifest.scope, "/");
  assert.doesNotMatch(layout, /manifest:\s*"\/manifest\.json"/);
  assert.doesNotMatch(layout, /icons:\s*\{/);
});
