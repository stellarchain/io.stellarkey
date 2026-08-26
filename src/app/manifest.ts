import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Wallet — Stellar",
    short_name: "Wallet",
    description: "A self-custodial Stellar wallet. Keys stay encrypted on your device.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["finance"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Send Payment",
        short_name: "Send",
        url: "/?action=send",
        description: "Open a new payment",
      },
      {
        name: "Receive Funds",
        short_name: "Receive",
        url: "/?action=receive",
        description: "Show your address QR",
      },
      {
        name: "Swap Assets",
        short_name: "Swap",
        url: "/?action=swap",
        description: "DEX swap between assets",
      },
    ],
  };
}
