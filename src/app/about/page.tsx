import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import {
  APPLICATION_VERSION,
  BUILD_COMMIT,
  BUILD_IS_DIRTY,
  PUBLIC_OPEN_GRAPH_IMAGE,
  PUBLIC_ROUTES,
  SOURCE_COMMIT_URL,
  SOURCE_RELEASE_URL,
  SOURCE_REPOSITORY_URL,
} from "@/lib/brand";
import {
  DocAlert,
  DocCheck,
  DocCycle,
  DocFingerprint,
  DocGlobe,
  DocLock,
  DocShield,
} from "@/components/marketing/DocIcons";

const description =
  "How StellarKey keeps Stellar keys and records under your control without an application backend.";

const highlights = [
  "StellarKey cannot take custody of your funds or recover a lost signing key.",
  "The production app is static: wallet operations happen in your browser and network requests go directly to the services you choose.",
  "The source, release commit, and build identity are public so each deployment can be inspected.",
] as const;

const sections = [
  { id: "about-what-it-is", label: "What StellarKey is" },
  { id: "about-wallet-action", label: "How a wallet action works" },
  { id: "about-local-data", label: "Where data lives" },
  { id: "about-signing", label: "Signing and unlock choices" },
  { id: "about-merchant", label: "Merchant mode" },
  { id: "about-open-source", label: "Open source and releases" },
  { id: "about-independence", label: "Independence" },
] as const;

export const metadata: Metadata = {
  title: "About StellarKey",
  description,
  alternates: { canonical: PUBLIC_ROUTES.about },
  openGraph: {
    type: "article",
    url: PUBLIC_ROUTES.about,
    title: "About StellarKey",
    description,
    images: [PUBLIC_OPEN_GRAPH_IMAGE],
  },
};

export default function AboutPage() {
  return (
    <LegalPage
      current="about"
      eyebrow="independent // self-custodial software"
      title="About StellarKey"
      summary="A self-custodial Stellar wallet. Keys are generated and encrypted in your browser and never leave your device."
      highlights={highlights}
      sections={sections}
    >
        <section id="about-what-it-is"><h2><DocShield />What StellarKey is</h2><p>StellarKey is free, open-source, self-custodial software for using the Stellar network. It is a wallet interface and local merchant tool, not a bank, exchange, custodian, money transmitter, asset issuer, accountant, or recovery service. The application does not open a hosted StellarKey account or take possession of assets.</p><p>A software wallet creates and encrypts its recovery material in this browser. A supported hardware wallet keeps its signing authority on that device. A watch-only account contains a public address but no signing secret. In every case, you decide which transaction to authorize and remain responsible for protecting every available recovery path.</p></section>

        <section id="about-wallet-action"><h2><DocAlert />How a wallet action works</h2><p>A typical payment or swap follows the same local-first sequence:</p><ol className="prose-list"><li>The browser unlocks the encrypted vault locally or connects to the selected signer.</li><li>StellarKey reads public account and network state from the selected Horizon or RPC endpoint and constructs an unsigned transaction in the browser.</li><li>You review the network, operations, addresses, assets, amounts, fees, and memo.</li><li>The software key signs locally, or Trezor is asked to display and sign the transaction. Watch-only accounts cannot sign.</li><li>The signed transaction is sent directly to the selected Stellar service. StellarKey then checks the network for confirmation and presents the transaction hash and final status.</li></ol><p>A displayed estimate, quote, balance, or pending state is not a ledger guarantee. The accepted transaction and the authoritative Stellar ledger are the final record.</p></section>

        <section id="about-local-data"><h2><DocLock />Where data lives</h2><p>The production release is a backend-free static web application. The encrypted wallet vault, contacts, private notes, optional passkey wrapper, encrypted merchant records, and local settings stay inside this browser profile. They are not synchronized between devices. Clearing site data, removing the browser profile, changing origin, or losing the device can remove access unless you have a working recovery phrase or encrypted backup.</p><p>Public balances and activity come directly from the Stellar network through the Horizon or RPC endpoint selected in Settings. Optional features may also contact issuer-controlled asset domains, market-data services, Friendbot on testnet, and Trezor Connect. The Privacy page explains what those direct requests reveal.</p></section>

        <section id="about-signing"><h2><DocCheck />Signing and unlock choices</h2><ul className="prose-list"><li>Software wallet: the secret is encrypted at rest and opened only for a scoped signing, derivation, or export action while the vault is unlocked.</li><li>Trezor: supported Stellar transactions are reviewed and signed on the connected device. StellarKey does not receive the device recovery phrase or private key.</li><li>Watch-only: the app can display public account data but cannot authorize transactions for that account.</li><li>Passkey unlock: on compatible secure origins, WebAuthn PRF can unwrap the same local vault key after device verification. This is a convenience unlock, not a Stellar smart account, portable backup, or replacement for the wallet password and recovery material.</li></ul></section>

        <section id="about-merchant"><h2><DocFingerprint />Merchant mode</h2><p>Merchant mode turns one unlocked wallet and browser into a single-device point of sale. Staff, shifts, orders, invoices, customer records, cash and external-card tenders, refunds, and reports remain encrypted locally. Crypto charges are matched against Horizon while the app is active; foreground monitoring pauses when the browser or operating system suspends the app and reconciles after it becomes active again.</p><p>Merchant mode is an operational aid, not cloud accounting, guaranteed payment monitoring, tax filing, card processing, or a durable off-device archive. Export records regularly and reconcile them against the ledger and your other payment providers.</p></section>

        <section id="about-open-source"><h2><DocGlobe />Open source and releases</h2><p>StellarKey’s original source is free software licensed under AGPL-3.0-or-later. You can inspect the <a href={SOURCE_REPOSITORY_URL}>source repository</a>, review the public <a href={PUBLIC_ROUTES.changelog}>changelog</a>, study how sensitive flows are implemented, and exercise the rights granted by that license. Bundled dependencies keep their own licenses; in particular, Trezor Connect is a separately licensed component and is not relicensed under the AGPL.</p><p>You are reading the trust center for StellarKey release {APPLICATION_VERSION}. The release identifier also appears in Security and the wallet sidebar so reports can name the affected build.</p><p className="doc-stamp">Full build commit</p>
        <code className="commit">{BUILD_COMMIT}</code><p>Compare this full 40-character SHA with the <a href={SOURCE_COMMIT_URL}>published source commit</a> and its <a href={SOURCE_RELEASE_URL}>corresponding GitHub release</a>. The same identity is available as machine-readable JSON at <a href="/release.json">/release.json</a>.{BUILD_IS_DIRTY ? " This local build carries tracked changes beyond that commit, so it is not source-verifiable." : " A clean manifest ties this build to that exact tracked source revision."}</p><p>A commit label is useful provenance, but it is not by itself proof that a device, host, dependency, or build environment is uncompromised. For a release decision, also verify the published artifact checksums and software bill of materials, or reproduce the static build from the named source.</p></section>

        <section id="about-independence"><h2><DocCycle />Independence</h2><p>StellarKey is independent software, not affiliated with, sponsored or endorsed by the Stellar Development Foundation. “Stellar” is a trademark of the Stellar Development Foundation. References to Stellar describe the network on which this software operates.</p></section>
    </LegalPage>
  );
}
