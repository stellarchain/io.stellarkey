import type { Metadata } from "next";
import { BRAND_DESCRIPTION, BRAND_NAME, PUBLIC_ROUTES } from "@/lib/brand";
import { ToastProvider } from "@/components/Toast";
import { WalletProvider } from "@/hooks/useWallet";
import { WalletApp } from "@/components/WalletApp";

export const metadata: Metadata = {
  title: { absolute: `${BRAND_NAME} — Self-custodial Stellar wallet` },
  description: BRAND_DESCRIPTION,
  alternates: { canonical: PUBLIC_ROUTES.app },
  // the wallet is the private surface: it should never appear in a search result
  robots: { index: false, follow: false },
};

export default function Wallet() {
  return (
    <div id="app-content" className="min-h-full">
      <ToastProvider>
        <WalletProvider>
          <WalletApp />
        </WalletProvider>
      </ToastProvider>
    </div>
  );
}
