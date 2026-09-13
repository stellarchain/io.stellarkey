import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { BRAND_NAME } from "@/lib/brand";

export const alt =
  `${BRAND_NAME}: a self-custodial Stellar wallet, a point of sale, and private payments in one app`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

const logoData = await readFile(path.join(process.cwd(), "public", "icon-512.png"), "base64");
const logoSource = `data:image/png;base64,${logoData}`;

/*
 * The landing page's own look: pure black, one gold accent, hairline sheet
 * edges, and the three-act framing over the headline that never changes.
 */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#000000",
          color: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "space-between",
          overflow: "hidden",
          padding: "64px 84px 56px",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.10)",
            display: "flex",
            height: 630,
            left: 42,
            position: "absolute",
            top: 0,
            width: 1,
          }}
        />
        <div
          style={{
            background: "rgba(255,255,255,0.10)",
            display: "flex",
            height: 630,
            position: "absolute",
            right: 42,
            top: 0,
            width: 1,
          }}
        />
        <div style={{ alignItems: "center", display: "flex", gap: 26 }}>
          {/* ImageResponse supports data URLs for local static artwork. */}
          <img alt="" src={logoSource} style={{ height: 84, width: 84 }} />
          <div style={{ display: "flex", fontSize: 44, fontWeight: 700, letterSpacing: "-1px" }}>
            {BRAND_NAME}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              color: "#FDDA24",
              display: "flex",
              fontSize: 22,
              letterSpacing: "4px",
              textTransform: "uppercase",
            }}
          >
            a stellar wallet // a card machine // a quiet mode
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 82,
              fontWeight: 600,
              letterSpacing: "-3px",
              lineHeight: 1.05,
              marginTop: 22,
            }}
          >
            Your keys never leave this device.
          </div>
        </div>
        <div style={{ color: "#8C8C8C", display: "flex", fontSize: 24 }}>
          Self-custody wallet · point of sale · private payments in testnet preview
        </div>
      </div>
    ),
    size,
  );
}
