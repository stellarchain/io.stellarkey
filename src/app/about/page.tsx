import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import {
  APPLICATION_VERSION,
  BRAND_DESCRIPTION,
  BRAND_NAME,
  BUILD_COMMIT,
  BUILD_IS_DIRTY,
  PUBLIC_OPEN_GRAPH_IMAGE,
  PUBLIC_ROUTES,
  SOURCE_COMMIT_URL,
  SOURCE_RELEASE_URL,
  SOURCE_REPOSITORY_URL,
} from "@/lib/brand";

const description = `How ${BRAND_NAME} keeps Stellar keys and records under your control without an application backend.`;

const sections = [
  { id: "what-it-is", label: "What StellarKey is" },
  { id: "wallet-action", label: "How a wallet action works" },
  { id: "local-data", label: "Where data lives" },
  { id: "signing", label: "Signing and unlock choices" },
  { id: "merchant", label: "Merchant mode" },
  { id: "open-source", label: "Open source and releases" },
  { id: "independence", label: "Independence" },
] as const;

export const metadata: Metadata = {
  title: "About",
  description,
  alternates: { canonical: PUBLIC_ROUTES.about },
  openGraph: {
    title: `About ${BRAND_NAME}`,
    description,
    url: PUBLIC_ROUTES.about,
    images: [PUBLIC_OPEN_GRAPH_IMAGE],
  },
};

export default function AboutPage() {
  return (
    <LegalPage
      current="about"
      eyebrow="Independent, self-custodial software"
      title={`About ${BRAND_NAME}`}
      summary={BRAND_DESCRIPTION}
      highlights={[
        "StellarKey cannot take custody of your funds or recover a lost signing key.",
        "The production app is static: wallet operations happen in your browser and network requests go directly to the services you choose.",
        "The source, release commit, and build identity are public so each deployment can be inspected.",
      ]}
      sections={sections}
    >
      <section id="what-it-is">
        <h2>What StellarKey is</h2>
        <p>
          StellarKey is free, open-source, self-custodial software for using the Stellar network. It
          is a wallet interface and local merchant tool—not a bank, exchange, custodian, money
          transmitter, asset issuer, accountant, or recovery service. The application does not open a
          hosted StellarKey account or take possession of assets.
        </p>
        <p>
          A software wallet creates and encrypts its recovery material in this browser. A supported
          hardware wallet keeps its signing authority on that device. A watch-only account contains
          a public address but no signing secret. In every case, you decide which transaction to
          authorize and remain responsible for protecting every available recovery path.
        </p>
      </section>

      <section id="wallet-action">
        <h2>How a wallet action works</h2>
        <p>A typical payment or swap follows the same local-first sequence:</p>
        <ol>
          <li>The browser unlocks the encrypted vault locally or connects to the selected signer.</li>
          <li>
            StellarKey reads public account and network state from the selected Horizon or RPC
            endpoint and constructs an unsigned transaction in the browser.
          </li>
          <li>You review the network, operations, addresses, assets, amounts, fees, and memo.</li>
          <li>
            The software key signs locally, or Trezor is asked to display and sign the transaction.
            Watch-only accounts cannot sign.
          </li>
          <li>
            The signed transaction is sent directly to the selected Stellar service. StellarKey then
            checks the network for confirmation and presents the transaction hash and final status.
          </li>
        </ol>
        <p>
          A displayed estimate, quote, balance, or pending state is not a ledger guarantee. The
          accepted transaction and the authoritative Stellar ledger are the final record.
        </p>
      </section>

      <section id="local-data">
        <h2>Where data lives</h2>
        <p>
          The production release is a backend-free static web application. The encrypted wallet
          vault, settings, contacts, private notes, optional passkey wrapper, and merchant records
          stay inside this browser profile. They are not synchronized between devices. Clearing site
          data, removing the browser profile, changing origin, or losing the device can remove access
          unless you have a working recovery phrase or encrypted backup.
        </p>
        <p>
          Public balances and activity come directly from the Stellar network through the Horizon or
          RPC endpoint selected in Settings. Optional features may also contact issuer-controlled
          asset domains, market-data services, Friendbot on testnet, and Trezor Connect. The Privacy
          page explains what those direct requests reveal.
        </p>
      </section>

      <section id="signing">
        <h2>Signing and unlock choices</h2>
        <ul>
          <li>
            <strong>Software wallet:</strong> the secret is encrypted at rest and opened only for a
            scoped signing, derivation, or export action while the vault is unlocked.
          </li>
          <li>
            <strong>Trezor:</strong> supported Stellar transactions are reviewed and signed on the
            connected device. StellarKey does not receive the device recovery phrase or private key.
          </li>
          <li>
            <strong>Watch-only:</strong> the app can display public account data but cannot authorize
            transactions for that account.
          </li>
          <li>
            <strong>Passkey unlock:</strong> on compatible secure origins, WebAuthn PRF can unwrap the
            same local vault key after device verification. This is a convenience unlock—not a
            Stellar smart account, portable backup, or replacement for the wallet password and
            recovery material.
          </li>
        </ul>
      </section>

      <section id="merchant">
        <h2>Merchant mode</h2>
        <p>
          Merchant mode turns one unlocked wallet and browser into a single-device point of sale.
          Staff, shifts, orders, invoices, customer records, cash and external-card tenders, refunds,
          and reports remain encrypted locally. Crypto charges are matched against Horizon while the
          app is active; foreground monitoring pauses when the browser or operating system suspends
          the app and reconciles after it becomes active again.
        </p>
        <p>
          Merchant mode is an operational aid, not cloud accounting, guaranteed payment monitoring,
          tax filing, card processing, or a durable off-device archive. Export records regularly and
          reconcile them against the ledger and your other payment providers.
        </p>
      </section>

      <section id="open-source">
        <h2>Open source and releases</h2>
        <p>
          StellarKey&apos;s original source is free software licensed under AGPL-3.0-or-later. You can
          inspect the <a href={SOURCE_REPOSITORY_URL}>source repository</a>, study how sensitive flows
          are implemented, and exercise the rights granted by that license. Bundled dependencies keep
          their own licenses; in particular, Trezor Connect is a separately licensed component and is
          not relicensed under the AGPL.
        </p>
        <p>
          You are reading the trust center for {BRAND_NAME} release {APPLICATION_VERSION}. The
          release identifier also appears in Security and the wallet sidebar so reports can name the
          affected build.
        </p>
        <p className="mt-4 text-[12px] font-semibold uppercase tracking-wider text-neutral-500">
          Full build commit
        </p>
        <code className="mt-2 block break-all rounded-xl bg-white/[0.06] px-4 py-3 text-[12px] text-neutral-200">
          {BUILD_COMMIT}
        </code>
        <p className="mt-3">
          Compare this full 40-character SHA with the {" "}
          <a href={SOURCE_COMMIT_URL}>published source commit</a> and its {" "}
          <a href={SOURCE_RELEASE_URL}>corresponding GitHub release</a>. The same identity is
          available as machine-readable JSON at {" "}
          <a href="/release.json">/release.json</a>.
          {BUILD_IS_DIRTY
            ? " This local build contains tracked changes beyond that commit and is not source-verifiable."
            : " A clean manifest links this build to that exact tracked source revision."}
        </p>
        <p>
          A commit label is useful provenance, but it is not by itself proof that a device, host,
          dependency, or build environment is uncompromised. For a release decision, also verify the
          published artifact checksums and software bill of materials, or reproduce the static build
          from the named source.
        </p>
      </section>

      <section id="independence">
        <h2>Independence</h2>
        <p>
          StellarKey is independent software, not affiliated with, sponsored or endorsed by the
          Stellar Development Foundation. “Stellar” is a trademark of the Stellar Development
          Foundation. References to Stellar describe the network on which this software operates.
        </p>
      </section>
    </LegalPage>
  );
}
