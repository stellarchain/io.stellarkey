import type { Metadata } from "next";
import { ContactAction } from "@/components/ContactAction";
import { LegalPage } from "@/components/LegalPage";
import { BRAND_NAME, PUBLIC_OPEN_GRAPH_IMAGE, PUBLIC_ROUTES } from "@/lib/brand";

const description = `${BRAND_NAME}'s plain-language privacy notice for local wallet data and direct third-party network requests.`;

export const metadata: Metadata = {
  title: "Privacy",
  description,
  alternates: { canonical: PUBLIC_ROUTES.privacy },
  openGraph: {
    title: `${BRAND_NAME} Privacy`,
    description,
    url: PUBLIC_ROUTES.privacy,
    images: [PUBLIC_OPEN_GRAPH_IMAGE],
  },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      current="privacy"
      eyebrow="Privacy notice"
      title="Your data stays close"
      summary="StellarKey has no application accounts, analytics, advertising, telemetry, or cloud database. Wallet and merchant data remains under this browser profile unless you export it."
    >
      <section>
        <h2>Data stored on this device</h2>
        <p>
          Your encrypted vault, preferences, contacts, private transaction notes, and small runtime
          records use browser localStorage. Merchant operational records use encrypted IndexedDB.
          Passkey unlock stores an origin-bound encrypted wrapper; it does not replace your password
          or encrypted backup. Clearing site data or resetting the app can remove these records.
        </p>
      </section>

      <section>
        <h2>Direct network requests</h2>
        <p>
          The browser contacts the Horizon or RPC endpoint selected for the active network. It may
          also contact CoinGecko for market prices, issuer-controlled domains for asset metadata and
          logos, Friendbot on testnet, and Trezor Connect when you start a hardware-wallet action.
          Those services can receive ordinary request data such as your IP address, browser details,
          requested public account or asset, and timing. Their own privacy terms apply.
        </p>
      </section>

      <section>
        <h2>No tracking cookies</h2>
        <p>
          StellarKey sets no advertising cookies and no non-essential cookies. It does not use a
          consent banner because this release has no analytics or tracking stack. If that changes,
          the notice and consent model must be reviewed before deployment.
        </p>
      </section>

      <section>
        <h2>Your controls</h2>
        <ul>
          <li>Export an encrypted backup before moving devices, origins, or browser profiles.</li>
          <li>Use Settings to hide balances, change endpoints, remove a passkey, or reset local data.</li>
          <li>Use browser controls to inspect or clear this origin’s storage.</li>
          <li>Never send a recovery phrase, secret key, password, or decrypted backup to support.</li>
        </ul>
      </section>

      <section>
        <h2>Privacy questions</h2>
        <p>Use the protected contact action to open your email application.</p>
        <ContactAction channel="support">Email support</ContactAction>
      </section>
    </LegalPage>
  );
}
