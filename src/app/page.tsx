import { ToastProvider } from "@/components/Toast";
import { WalletProvider } from "@/hooks/useWallet";
import { WalletApp } from "@/components/WalletApp";

export default function Home() {
  return (
    <ToastProvider>
      <WalletProvider>
        <WalletApp />
      </WalletProvider>
    </ToastProvider>
  );
}
