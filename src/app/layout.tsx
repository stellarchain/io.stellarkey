import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { BRAND_DESCRIPTION, BRAND_NAME, BRAND_ORIGIN } from "@/lib/brand";
import "./globals.css";

const defaultTitle = `${BRAND_NAME} — Self-custodial Stellar wallet`;
const applicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: BRAND_NAME,
  url: BRAND_ORIGIN,
  description: BRAND_DESCRIPTION,
  "applicationCategory": "FinanceApplication",
  operatingSystem: "Any modern browser",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};
const serializedApplicationJsonLd = JSON.stringify(applicationJsonLd).replace(/</g, "\\u003c");

export const metadata: Metadata = {
  metadataBase: new URL(BRAND_ORIGIN),
  title: {
    default: defaultTitle,
    template: `%s — ${BRAND_NAME}`,
  },
  description: BRAND_DESCRIPTION,
  applicationName: BRAND_NAME,
  alternates: { canonical: "/" },
  category: "finance",
  creator: BRAND_NAME,
  publisher: BRAND_NAME,
  openGraph: {
    type: "website",
    url: "/",
    siteName: BRAND_NAME,
    title: defaultTitle,
    description: BRAND_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: defaultTitle,
    description: BRAND_DESCRIPTION,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: BRAND_NAME,
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a className="skip-link" href="#app-content">Skip to content</a>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializedApplicationJsonLd }}
        />
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
