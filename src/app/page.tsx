import { ToastProvider } from "@/components/Toast";
import { WalletProvider } from "@/hooks/useWallet";
import { WalletApp } from "@/components/WalletApp";

export default function Home() {
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
