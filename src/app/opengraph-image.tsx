import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { BRAND_NAME } from "@/lib/brand";

export const alt = `${BRAND_NAME}: self-custodial Stellar wallet`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

const logoData = await readFile(path.join(process.cwd(), "public", "icon-512.png"), "base64");
const logoSource = `data:image/png;base64,${logoData}`;

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#08080a",
          color: "white",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            background: "radial-gradient(circle, rgba(10,132,255,0.22), rgba(8,8,10,0) 68%)",
            display: "flex",
            height: 760,
            position: "absolute",
            right: -180,
            top: -260,
            width: 760,
          }}
        />
        <div
          style={{
            alignItems: "flex-start",
            display: "flex",
            flexDirection: "column",
            padding: "72px 84px",
            width: "100%",
          }}
        >
          {/* ImageResponse supports data URLs for local static artwork. */}
          <img alt="" src={logoSource} style={{ height: 96, width: 96 }} />
          <div style={{ display: "flex", fontSize: 74, fontWeight: 750, letterSpacing: "-4px", marginTop: 38 }}>
            {BRAND_NAME}
          </div>
          <div style={{ color: "#d1d1d6", display: "flex", fontSize: 31, marginTop: 18 }}>
            Your keys. Your Stellar account.
          </div>
          <div style={{ color: "#8e8e93", display: "flex", fontSize: 21, marginTop: 80 }}>
            Self-custodial · backend-free · hardware-wallet ready
          </div>
        </div>
      </div>
    ),
    size,
  );
}
