import type { Metadata } from "next";
import { ContactAction } from "@/components/ContactAction";
import { LegalPage } from "@/components/LegalPage";
import { BRAND_NAME, PUBLIC_OPEN_GRAPH_IMAGE, PUBLIC_ROUTES } from "@/lib/brand";

const description = `${BRAND_NAME} security model, supported disclosure scope, and responsible disclosure process.`;

export const metadata: Metadata = {
  title: "Security",
  description,
  alternates: { canonical: PUBLIC_ROUTES.security },
  openGraph: {
    title: `${BRAND_NAME} Security`,
    description,
    url: PUBLIC_ROUTES.security,
    images: [PUBLIC_OPEN_GRAPH_IMAGE],
  },
};

export default function SecurityPage() {
  return (
    <LegalPage
      current="security"
      eyebrow="Security and disclosure"
      title="Protect the recovery path"
      summary="StellarKey reduces custody risk by keeping keys local, but browser origins, extensions, devices, dependencies, and the services you connect remain part of the trust boundary."
    >
      <section>
        <h2>Security model</h2>
        <ul>
          <li>Vault secrets are encrypted locally and opened only for a scoped signing or export action.</li>
          <li>Every transaction receives a review before local or hardware signing.</li>
          <li>The production app must run over HTTPS with the generated Content Security Policy.</li>
          <li>Passkeys bind to the exact web origin and do not replace password or backup recovery.</li>
          <li>Public Horizon, RPC, issuer, pricing, and hardware services remain external dependencies.</li>
        </ul>
      </section>

      <section>
        <h2>Responsible disclosure</h2>
        <p>
          Report a reproducible issue privately before publishing details. Include the affected route,
          release or commit, browser and operating-system version, expected behavior, observed
          behavior, and the smallest safe reproduction. We will acknowledge and triage credible
          reports, but cannot promise a reward or response deadline unless a separate program says so.
        </p>
      </section>

      <section>
        <h2>Never include secrets</h2>
        <p>
          Never include a recovery phrase, secret key, wallet password, passkey output, decrypted or
          encrypted wallet backup, merchant archive, customer record, or real unredacted transaction
          data in a report. Use a fresh testnet wallet and redact public addresses when they are not
          essential to the reproduction.
        </p>
      </section>

      <section>
        <h2>Report securely</h2>
        <p>
          The button below constructs the dedicated security contact only after you activate it, which
          keeps the complete address out of static page markup and deters basic harvesting.
        </p>
        <ContactAction channel="security">Email the security team</ContactAction>
      </section>
    </LegalPage>
  );
}
