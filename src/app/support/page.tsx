import type { Metadata } from "next";
import { ContactAction } from "@/components/ContactAction";
import { LegalPage } from "@/components/LegalPage";
import { BRAND_NAME, PUBLIC_OPEN_GRAPH_IMAGE, PUBLIC_ROUTES } from "@/lib/brand";

const description = `Safe support boundaries and help channels for ${BRAND_NAME}.`;

export const metadata: Metadata = {
  title: "Support",
  description,
  alternates: { canonical: PUBLIC_ROUTES.support },
  openGraph: {
    title: `${BRAND_NAME} Support`,
    description,
    url: PUBLIC_ROUTES.support,
    images: [PUBLIC_OPEN_GRAPH_IMAGE],
  },
};

export default function SupportPage() {
  return (
    <LegalPage
      current="support"
      eyebrow="Help and recovery boundaries"
      title="Support without custody"
      summary="StellarKey can help explain the software, but no operator holds your keys, vault password, passkey, transactions, or browser-local merchant records."
    >
      <section>
        <h2>Before contacting support</h2>
        <ul>
          <li>Open About and copy the full release commit.</li>
          <li>Record your browser, operating system, selected Stellar network, and safe reproduction steps.</li>
          <li>Try the latest supported release and use a fresh testnet wallet when reproducing a defect.</li>
          <li>For a security concern, use the private process on the Security page instead.</li>
        </ul>
      </section>

      <section>
        <h2>Never send secrets</h2>
        <p>
          Support never needs a recovery phrase, private key, wallet password, passkey output,
          decrypted backup, customer record, or remote access to your device. Redact addresses and
          transaction details unless they are essential and already public.
        </p>
      </section>

      <section>
        <h2>What support cannot do</h2>
        <p>
          Because StellarKey is self-custodial and backend-free, support cannot recover lost keys,
          unlock a vault, restore data that was not backed up, reverse a Stellar transaction, freeze
          an asset, or resolve an issuer or merchant dispute.
        </p>
      </section>

      <section>
        <h2>Contact support</h2>
        <p>
          The contact address is assembled only after you activate the button, keeping it out of the
          static page markup and reducing automated harvesting.
        </p>
        <ContactAction channel="support">Email support</ContactAction>
      </section>
    </LegalPage>
  );
}
