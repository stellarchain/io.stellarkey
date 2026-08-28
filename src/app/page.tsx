import type { Metadata } from "next";
import { BRAND_NAME, PUBLIC_OPEN_GRAPH_IMAGE, PUBLIC_ROUTES } from "@/lib/brand";
import { LandingBody } from "@/components/marketing/LandingBody";
import { LandingClient } from "@/components/marketing/LandingClient";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingChrome";
import "@/components/marketing/marketing.css";
import "@/components/marketing/landing.css";

const title = `${BRAND_NAME} — a Stellar wallet with a card machine in it`;
const description =
  "A self-custody Stellar wallet and a point of sale in one app. The vault is encrypted in " +
  "your browser, every signature is shown to you first, and nothing about the shop leaves " +
  "the device it runs on.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: PUBLIC_ROUTES.home },
  openGraph: { type: "website", url: PUBLIC_ROUTES.home, title, description, images: [PUBLIC_OPEN_GRAPH_IMAGE] },
  twitter: { card: "summary_large_image", title, description, images: [PUBLIC_OPEN_GRAPH_IMAGE.url] },
};

export default function Home() {
  return (
    <div className="mk">
      <MarketingHeader />
      <main id="app-content">
        <div id="top" />
        <LandingBody />
      </main>
      <MarketingFooter />
      <LandingClient />
    </div>
  );
}
