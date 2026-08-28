import type { Metadata } from "next";
import { ContactAction } from "@/components/ContactAction";
import { LegalPage } from "@/components/LegalPage";
import { BRAND_NAME, PUBLIC_OPEN_GRAPH_IMAGE, PUBLIC_ROUTES } from "@/lib/brand";

const description = `${BRAND_NAME}'s plain-language privacy notice for local wallet data and direct third-party network requests.`;

const sections = [
  { id: "scope", label: "Scope and roles" },
  { id: "local-data", label: "Data stored on this device" },
  { id: "network", label: "Direct network requests" },
  { id: "public-ledger", label: "Public blockchain data" },
  { id: "tracking", label: "Cookies and tracking" },
  { id: "retention", label: "Retention and deletion" },
  { id: "controls", label: "Your controls" },
  { id: "contact", label: "Privacy questions" },
] as const;

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
      summary="StellarKey has no application accounts or cloud database, and no analytics, advertising, or telemetry. Wallet and merchant data remains under this browser profile unless you export it."
      highlights={[
        "StellarKey does not upload your vault, recovery phrase, private notes, or merchant database to an application backend.",
        "Your browser makes direct requests to Stellar and optional third-party services; those services can observe ordinary connection and request data.",
        "Clearing site data deletes local records but cannot erase transactions or other information already published to a public blockchain.",
      ]}
      sections={sections}
    >
      <section id="scope">
        <h2>Scope and roles</h2>
        <p>
          This notice explains the privacy behavior of the official static StellarKey application.
          It does not govern a fork, a modified deployment, your browser or device provider, a web
          host, a Stellar data service, an asset issuer, Trezor, a market-data provider, or another
          site reached through a link.
        </p>
        <p>
          Because the application has no account system or application backend, the StellarKey
          maintainers do not become a data controller or data processor for browser-local wallet and
          merchant records merely by publishing the software. A hosting provider may process ordinary
          web access logs under its own terms. If you contact support, the recipient processes the
          message and contact details needed to answer it. If a business records customer information
          in merchant mode, that business—not the wallet software—is responsible for its own privacy,
          retention, and lawful-processing duties.
        </p>
      </section>

      <section id="local-data">
        <h2>Data stored on this device</h2>
        <p>
          StellarKey uses browser storage only to make the requested local features work. Depending
          on what you use, the browser profile may contain:
        </p>
        <ul>
          <li>
            the password-wrapped wallet master key, encrypted recovery phrase or imported secret,
            public addresses, account labels, selected network, and security preferences;
          </li>
          <li>contacts, favorite assets, private transaction notes, and limited runtime state;</li>
          <li>
            an optional origin-bound passkey credential identifier, salt, and encrypted master-key
            wrapper—but not a reusable biometric image or the authenticator&apos;s private key;
          </li>
          <li>
            encrypted merchant records such as staff, shifts, orders, tenders, invoices, refunds,
            customers, loyalty activity, tax settings, and exports; and
          </li>
          <li>the static application shell cached for installation and offline launch.</li>
        </ul>
        <p>
          The wallet and small preferences use localStorage. Merchant operational records use
          encrypted IndexedDB. The service worker does not cache wallet records, merchant records,
          Stellar responses, balances, or prices.
        </p>
      </section>

      <section id="network">
        <h2>Direct network requests</h2>
        <p>
          The browser contacts the Horizon or RPC endpoint selected for the active network. It may
          also contact CoinGecko for market prices, issuer-controlled domains for asset metadata and
          logos, Friendbot on testnet, and Trezor Connect when you start a hardware-wallet action.
          Those services can receive ordinary request data such as your IP address, browser details,
          requested public account or asset, referring origin where the browser sends it, and timing.
          A sequence of account and asset requests can reveal which wallets or assets interest you,
          even though the underlying addresses are public. Their own privacy terms and retention
          practices apply.
        </p>
        <p>
          Testnet funding requests go directly to Friendbot. Hardware-wallet requests go to Trezor
          Connect only after you choose a Trezor action. The app does not proxy these connections, so
          StellarKey maintainers do not receive a private copy of the request through an application
          server.
        </p>
      </section>

      <section id="public-ledger">
        <h2>Public blockchain data</h2>
        <p>
          Stellar is a public network. Public addresses, balances, trustlines, offers, transaction
          operations, amounts, assets, issuers, memos, signatures, and timestamps may be visible to
          anyone and retained indefinitely by network participants and data providers. A private note
          stored by StellarKey remains local, but a memo included in a transaction is not private.
          StellarKey does not make blockchain data private and cannot delete or correct a confirmed
          ledger record.
        </p>
      </section>

      <section id="tracking">
        <h2>Cookies and tracking</h2>
        <p>
          StellarKey sets no advertising cookies and no non-essential cookies. It does not use a
          device fingerprint, advertising identifier, session-replay tool, analytics SDK, or product
          telemetry. This release therefore has no tracking-consent banner. A browser, installed
          extension, DNS provider, or hosting provider may still have independent logging or privacy
          behavior outside the application&apos;s control.
        </p>
      </section>

      <section id="retention">
        <h2>Retention and deletion</h2>
        <p>
          Local records remain until you remove them, reset StellarKey, clear this origin&apos;s browser
          storage, or delete the browser profile. The app has no remote retention period because it
          has no copy to expire. Resetting is intentionally broad and cannot be undone. Export and
          test an encrypted backup before clearing data; a merchant tax archive alone cannot restore
          wallet signing keys.
        </p>
        <p>
          Removing a local record does not delete a support email, hosting log, third-party service
          record, or public blockchain entry. Contact the relevant recipient or service for its
          access, correction, deletion, objection, or complaint process where applicable.
        </p>
      </section>

      <section id="controls">
        <h2>Your controls</h2>
        <ul>
          <li>Export an encrypted backup before moving devices, origins, or browser profiles.</li>
          <li>
            Use Settings to hide balances, choose network endpoints, remove the local passkey wrapper,
            export records, or reset local data.
          </li>
          <li>Use browser controls to inspect or clear this origin’s storage.</li>
          <li>
            Use privacy-preserving endpoints you trust and avoid associating the same public address
            with identities you do not want linked.
          </li>
          <li>Never send a recovery phrase, secret key, password, or decrypted backup to support.</li>
        </ul>
      </section>

      <section id="contact">
        <h2>Privacy questions</h2>
        <p>
          Use the protected contact action to open your email application. Include only the minimum
          information needed to explain the question. Do not include wallet secrets, customer data,
          or an unredacted backup.
        </p>
        <ContactAction channel="support">Email support</ContactAction>
      </section>
    </LegalPage>
  );
}
