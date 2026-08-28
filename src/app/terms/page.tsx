import type { Metadata } from "next";
import { ContactAction } from "@/components/ContactAction";
import { LegalPage } from "@/components/LegalPage";
import { BRAND_NAME, PUBLIC_ROUTES } from "@/lib/brand";

const description = `Terms for using ${BRAND_NAME} self-custodial wallet and local-first merchant software.`;

export const metadata: Metadata = {
  title: "Terms",
  description,
  alternates: { canonical: PUBLIC_ROUTES.terms },
  openGraph: { title: `${BRAND_NAME} Terms`, description, url: PUBLIC_ROUTES.terms },
};

export default function TermsPage() {
  return (
    <LegalPage
      current="terms"
      eyebrow="Terms of use"
      title="You remain in control"
      summary="These terms describe the responsibility that comes with self-custody. Review them before creating, importing, funding, or using a wallet for merchant activity."
    >
      <section>
        <h2>Self-custody</h2>
        <p>
          StellarKey does not hold, recover, freeze, reverse, or transfer funds for you. You control
          the signing authority. Keep your recovery phrase, secret keys, wallet password, encrypted
          backups, and hardware-wallet recovery material secure and available. Losing every recovery
          path can make the wallet permanently inaccessible.
        </p>
      </section>

      <section>
        <h2>Review before signing</h2>
        <p>
          Stellar transactions can be irreversible. Before signing, verify the network, destination,
          amount, memo, fee, operation list, and full asset issuer. A familiar asset code does not
          prove that an issued asset is authentic. Hardware-wallet users should also verify the
          details and address shown on the device.
        </p>
      </section>

      <section>
        <h2>Third-party services</h2>
        <p>
          Horizon, RPC, market-data providers, issuer domains, wallet hardware, browsers, and the
          Stellar network are independent services. Their availability and output are not controlled
          by StellarKey. Quotes, prices, fees, balances, and transaction status can change or be
          delayed; the signed transaction and authoritative ledger remain the source of truth.
        </p>
      </section>

      <section>
        <h2>Merchant records</h2>
        <p>
          Merchant records are local operational tools, not hosted accounting, tax, banking, or
          compliance services. You are responsible for record retention, reconciliation, lawful
          receipts, tax treatment, staff access, refunds, and exports required in your jurisdiction.
          Closing or suspending the app pauses foreground payment monitoring.
        </p>
      </section>

      <section>
        <h2>Acceptable use and warranty</h2>
        <p>
          Do not use StellarKey to violate law, interfere with the software or network, deceive other
          people, or access funds or records without authority. The software is provided on an
          “as-is” and “as-available” basis to the extent permitted by applicable law. Test new releases
          and unfamiliar flows with small amounts before relying on them.
        </p>
      </section>

      <section>
        <h2>Questions</h2>
        <p>
          These engineering terms do not replace jurisdiction-specific legal review. Use the protected
          contact action for product questions.
        </p>
        <ContactAction channel="support">Email support</ContactAction>
      </section>
    </LegalPage>
  );
}
