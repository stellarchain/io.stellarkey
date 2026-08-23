import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wallet — Stellar",
  description:
    "A self-custodial Stellar wallet. Keys are generated and encrypted in your browser and never leave your device.",
  manifest: "/manifest.json",
  applicationName: "Wallet",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Wallet",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
