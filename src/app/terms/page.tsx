import type { Metadata } from "next";
import { ContactAction } from "@/components/ContactAction";
import { LegalPage } from "@/components/LegalPage";
import {
  BRAND_NAME,
  PUBLIC_OPEN_GRAPH_IMAGE,
  PUBLIC_ROUTES,
  SOURCE_REPOSITORY_URL,
} from "@/lib/brand";

const description = `Terms for using ${BRAND_NAME} self-custodial wallet and local-first merchant software.`;

const sections = [
  { id: "agreement", label: "Agreement and scope" },
  { id: "free-software", label: "Free and open-source software" },
  { id: "self-custody", label: "Self-custody and recovery" },
  { id: "transactions", label: "Transactions and assets" },
  { id: "third-parties", label: "Third-party services" },
  { id: "merchant", label: "Merchant records" },
  { id: "advice", label: "No professional advice" },
  { id: "acceptable-use", label: "Acceptable use" },
  { id: "warranties", label: "Disclaimer of warranties" },
  { id: "liability", label: "Limitation of liability" },
  { id: "changes", label: "Changes and contact" },
] as const;

export const metadata: Metadata = {
  title: "Terms",
  description,
  alternates: { canonical: PUBLIC_ROUTES.terms },
  openGraph: {
    title: `${BRAND_NAME} Terms`,
    description,
    url: PUBLIC_ROUTES.terms,
    images: [PUBLIC_OPEN_GRAPH_IMAGE],
  },
};

export default function TermsPage() {
  return (
    <LegalPage
      current="terms"
      eyebrow="Terms of use"
      title="You remain in control"
      summary="These terms describe the responsibility that comes with self-custody. Review them before creating, importing, funding, or using a wallet for merchant activity."
      highlights={[
        "StellarKey is free software supplied without a paid custody, recovery, uptime, or transaction-guarantee service.",
        "You alone control your signing authority and must verify every network, address, asset issuer, amount, memo, fee, and operation before signing.",
        "The software is provided “as is”; warranties and liability are limited only as far as applicable law allows, and non-excludable rights remain intact.",
      ]}
      sections={sections}
    >
      <section id="agreement">
        <h2>Agreement and scope</h2>
        <p>
          These Terms of Use apply when you use the official StellarKey application. By creating,
          importing, connecting, funding, unlocking, or operating a wallet or merchant workspace, you
          confirm that you have read these terms and have legal capacity to accept them. If you do not
          agree, do not use the application.
        </p>
        <p>
          These terms govern use of the application interface. They do not govern the Stellar
          protocol, an asset issuer, a market-data service, Trezor, a browser, a hosting provider, or
          a modified third-party deployment. They also do not replace the open-source license that
          grants rights in the source code.
        </p>
      </section>

      <section id="free-software">
        <h2>Free and open-source software</h2>
        <p>
          StellarKey&apos;s original source is free software licensed under
          {" "}<a href="https://www.gnu.org/licenses/agpl-3.0.html">AGPL-3.0-or-later</a>. The
          complete license is included with the <a href={SOURCE_REPOSITORY_URL}>source repository</a>.
          It gives you rights to run, study, share, and modify the covered source subject to its
          conditions, including corresponding-source obligations for modified versions offered over
          a network. Those license rights are not withdrawn or narrowed by these Terms of Use.
        </p>
        <p>
          Third-party components and materials retain their own licenses and notices. Trezor Connect
          is a separately licensed optional dependency and is not relicensed under StellarKey&apos;s AGPL.
          Anyone redistributing a build is responsible for reviewing and satisfying every applicable
          third-party license and distribution condition.
        </p>
      </section>

      <section id="self-custody">
        <h2>Self-custody and recovery</h2>
        <p>
          StellarKey does not hold, recover, freeze, reverse, or transfer funds for you. You control
          the signing authority. Keep your recovery phrase, secret keys, wallet password, encrypted
          backups, and hardware-wallet recovery material secure and available. Losing every recovery
          path can make the wallet permanently inaccessible.
        </p>
        <p>
          You are responsible for securing the device, browser profile, operating system, extensions,
          password, passkey-enabled platform account, hardware wallet, and every backup. Confirm that
          a backup can be restored before relying on it. Support will never ask for a recovery phrase,
          private key, password, passkey output, or remote access to your device.
        </p>
      </section>

      <section id="transactions">
        <h2>Transactions and assets</h2>
        <p>
          Stellar transactions can be irreversible. Before signing, verify the network, destination,
          amount, memo, fee, operation list, and full asset issuer. A familiar asset code does not
          prove that an issued asset is authentic. Hardware-wallet users should also verify the
          details and address shown on the device.
        </p>
        <p>
          You are responsible for account reserves, trustlines, authorization flags, clawback risk,
          liquidity, slippage, issuer redemption terms, contract behavior, and any tax or regulatory
          consequences. Testnet assets have no intended real-world value. Mainnet assets, including
          assets with familiar names, can lose value or become unavailable. No quote, price, logo,
          directory entry, or interface label is an endorsement or guarantee.
        </p>
      </section>

      <section id="third-parties">
        <h2>Third-party services</h2>
        <p>
          Horizon, RPC, market-data providers, issuer domains, wallet hardware, browsers, and the
          Stellar network are independent services. Their availability and output are not controlled
          by StellarKey. Quotes, prices, fees, balances, and transaction status can change or be
          delayed; the signed transaction and authoritative ledger remain the source of truth.
        </p>
        <p>
          You choose whether to rely on those services and are responsible for their terms, privacy
          notices, fees, availability, accuracy, and security. StellarKey is not responsible for an
          issuer&apos;s conduct, a network fork or outage, a failed endpoint, a malicious asset, a browser
          or extension compromise, hardware failure, DNS or hosting compromise, or another party&apos;s
          act or omission except where applicable law makes such responsibility non-excludable.
        </p>
      </section>

      <section id="merchant">
        <h2>Merchant records</h2>
        <p>
          Merchant records are local operational tools, not hosted accounting, tax, banking, or
          compliance services. You are responsible for record retention, reconciliation, lawful
          receipts, tax treatment, staff access, refunds, and exports required in your jurisdiction.
          Closing or suspending the app pauses foreground payment monitoring.
        </p>
        <p>
          A displayed “paid” state is based on the matching and confirmation rules implemented by the
          release. Reconcile every material sale against the authoritative ledger or external tender
          provider. You must maintain appropriate backups and alternative records for your legal,
          accounting, customer-service, and business-continuity needs.
        </p>
      </section>

      <section id="advice">
        <h2>No professional advice</h2>
        <p>
          StellarKey provides software and general technical information, not financial, investment,
          legal, tax, accounting, regulatory, cybersecurity, or other professional advice. Prices,
          rates, reserve estimates, risk labels, reports, and tax exports may be incomplete, delayed,
          or unsuitable for your circumstances. Obtain qualified advice where you need it and make
          your own decisions.
        </p>
      </section>

      <section id="acceptable-use">
        <h2>Acceptable use</h2>
        <p>
          Do not use StellarKey to violate law, interfere with the software or network, deceive other
          people, bypass access controls, distribute malware, infringe rights, or access funds or
          records without authority. You are responsible for determining whether your use, assets,
          counterparties, records, disclosures, and transactions are lawful where you operate.
        </p>
        <p>
          This acceptable-use rule applies to the official application and any services operated by
          its maintainers. It does not add a restriction to the rights granted in AGPL-covered source
          code; copyright and license compliance remain governed by the AGPL and applicable law.
        </p>
      </section>

      <section id="warranties">
        <h2>Disclaimer of warranties</h2>
        <p>
          <strong>
            To the extent permitted by applicable law, the software is provided “as is” and “as
            available,” without warranties of any kind.
          </strong>{" "}
          The copyright holders, contributors, and maintainers do not promise that StellarKey will be
          secure, uninterrupted, error-free, compatible with every device, fit for a particular
          purpose, accurate, complete, or available at any particular time. They do not guarantee
          transaction acceptance, confirmation time, asset value, recovery, data retention, endpoint
          output, or merchant results.
        </p>
        <p>
          StellarKey takes security seriously and uses ongoing review, testing, dependency checks,
          release verification, and responsible disclosure. Those practices reduce risk; they do not
          create a warranty, service-level commitment, fiduciary duty, or guarantee of absolute
          security. Test a new release and unfamiliar flow with small amounts before relying on it.
        </p>
      </section>

      <section id="liability">
        <h2>Limitation of liability</h2>
        <p>
          To the extent permitted by applicable law, the copyright holders, contributors,
          maintainers, and distributors are not liable for indirect, incidental, special,
          consequential, exemplary, or punitive loss arising from use of or inability to use the
          software. This includes loss of assets, keys, data, records, revenue, profit, business,
          opportunity, goodwill, or anticipated savings; an inaccurate display or report; a failed or
          irreversible transaction; unauthorized access; or the conduct of a network or third party,
          even if the possibility of loss was known.
        </p>
        <p>
          <strong>Non-excludable rights remain intact.</strong> Nothing in these terms excludes or
          limits liability for fraud or fraudulent misrepresentation, death or personal injury caused
          by negligence, wilful misconduct, or any warranty, remedy, statutory consumer right, or
          other liability that cannot lawfully be excluded or limited. If a disclaimer or limitation
          is invalid where you live, it applies only to the maximum fair and lawful extent there.
        </p>
      </section>

      <section id="changes">
        <h2>Changes and contact</h2>
        <p>
          A future release may update these terms when the software, risk model, or law changes. The
          effective date and legal-text version identify the text bundled with this release. Updates
          do not retroactively remove source-code rights already granted under the AGPL. Material
          changes should be presented before continued use of the affected official application.
        </p>
        <p>
          The law that applies and the rights available to you can depend on your location and how you
          use the software. These jurisdiction-neutral terms do not replace review by qualified legal
          counsel for a production operator. Use the protected contact action for product or terms
          questions.
        </p>
        <ContactAction channel="support">Email support</ContactAction>
      </section>
    </LegalPage>
  );
}
