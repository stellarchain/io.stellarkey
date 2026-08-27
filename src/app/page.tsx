import { ToastProvider } from "@/components/Toast";
import { WalletProvider } from "@/hooks/useWallet";
import { MerchantProvider } from "@/hooks/useMerchant";
import { WalletApp } from "@/components/WalletApp";

export default function Home() {
  return (
    <ToastProvider>
      {/* MerchantProvider reads the wallet, so it lives inside WalletProvider. */}
      <WalletProvider>
        <MerchantProvider>
          <WalletApp />
        </MerchantProvider>
      </WalletProvider>
    </ToastProvider>
  );
}
