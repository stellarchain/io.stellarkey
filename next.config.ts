import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "export",
  experimental: {
    sri: { algorithm: "sha256" },
  },
  // Next 16 blocks dev chunks requested through a LAN hostname unless it is
  // explicitly trusted. Allow this private /24 so phone/tablet testing keeps
  // working when DHCP assigns the development machine a new final octet.
  allowedDevOrigins: ["192.168.0.*"],
  turbopack: {
    root: projectRoot,
  },
  poweredByHeader: false,
};

export default nextConfig;
