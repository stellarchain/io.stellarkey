import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { ContactAction } from "@/components/ContactAction";
import {
  APPLICATION_VERSION,
  BUILD_COMMIT,
  PUBLIC_OPEN_GRAPH_IMAGE,
  PUBLIC_ROUTES,
} from "@/lib/brand";
import {
  DocAlert,
  DocCheck,
  DocCycle,
  DocFile,
  DocFingerprint,
  DocGlobe,
  DocLock,
  DocShield,
} from "@/components/marketing/DocIcons";

const description =
  "How to get help, what is safe to send, and what nobody can do for you once a key is lost.";

const highlights = [
  "No legitimate support request requires your recovery phrase, private key, password, passkey output, decrypted backup, or remote device access.",
  "Support can troubleshoot the interface and public ledger behavior, but cannot recover a wallet, reverse a transaction, or restore local data that was never backed up.",
  "Use a public GitHub issue for sanitized product defects and the private Security channel for suspected vulnerabilities.",
] as const;

const sections = [
  { id: "support-start", label: "Start safely" },
  { id: "support-self-service", label: "Checks you can make" },
  { id: "support-safe-details", label: "Safe diagnostic details" },
  { id: "support-never-send", label: "Never send secrets" },
  { id: "support-boundaries", label: "Support boundaries" },
  { id: "support-channels", label: "Choose the right channel" },
  { id: "support-expectations", label: "Response expectations" },
  { id: "support-contact", label: "Contact support" },
] as const;

export const metadata: Metadata = {
  title: "Support without custody",
  description,
  alternates: { canonical: PUBLIC_ROUTES.support },
  openGraph: {
    type: "article",
    url: PUBLIC_ROUTES.support,
    title: "Support without custody",
    description,
    images: [PUBLIC_OPEN_GRAPH_IMAGE],
  },
};

export default function SupportPage() {
  return (
    <LegalPage
      current="support"
      eyebrow="help // and its boundaries"
      title="Support without custody"
      summary="StellarKey can help explain the software, but no operator holds your keys, vault password, passkey, transactions, or browser-local merchant records."
      highlights={highlights}
      sections={sections}
    >
        <section id="support-start"><h2><DocShield />Start safely</h2><p>Lock the wallet before sharing a screen or screenshot. Do not install remote-access software, run code from an unsolicited message, import a recovery phrase into a support form, or move funds to an address presented as “verification.” StellarKey maintainers will not contact you first to repair, upgrade, synchronize, or validate a wallet.</p><p>For an unexpected payment or balance, first confirm the selected network and public account address. Then compare the transaction hash and operations with a Stellar explorer you trust. A public ledger entry is authoritative even when a local interface is delayed.</p></section>

        <section id="support-self-service"><h2><DocAlert />Checks you can make</h2><ul className="prose-list"><li>Confirm that the site origin is exactly stellarkey.io and is using HTTPS.</li><li>Open About and compare the full release commit with the published source release.</li><li>Check the active account, mainnet or testnet selection, and configured Horizon or RPC endpoint.</li><li>Reload once, then retry a read-only action before repeating anything that could sign or submit.</li><li>Check the transaction hash on the authoritative network before sending a second payment.</li><li>Use a fresh, unfunded testnet wallet to reproduce a defect whenever possible.</li></ul></section>

        <section id="support-safe-details"><h2><DocLock />Safe diagnostic details</h2><p>The following is normally safe to include after checking it contains no customer data:</p><ul className="prose-list"><li>StellarKey release {APPLICATION_VERSION} and commit {BUILD_COMMIT};</li><li>device model, operating-system version, browser name and version, and install mode;</li><li>mainnet or testnet, the affected route, expected result, and exact sequence of actions;</li><li>a public account address or transaction hash only when it is essential and already public;</li><li>a redacted screenshot or copied error message with all secrets and personal records removed; and</li><li>whether the issue also occurs with a fresh testnet wallet in the latest supported release.</li></ul></section>

        <section id="support-never-send"><h2><DocCheck />Never send secrets</h2><p>Support never needs a recovery phrase, private key, wallet password, passkey output, encrypted or decrypted backup, raw signed transaction, one-time code, customer or merchant archive, complete browser-storage export, or remote access to your device. Do not paste secrets into a public issue, email, screenshot, form, chat, or AI assistant. If you believe a secret was exposed, move assets to a newly generated recovery path from a clean device; a password change cannot revoke a leaked Stellar signing key.</p></section>

        <section id="support-boundaries"><h2><DocFingerprint />Support boundaries</h2><p>Support can</p><ul className="prose-list"><li>explain documented wallet, backup, network, asset, and merchant behavior;</li><li>help distinguish an interface problem from confirmed public ledger state;</li><li>triage a sanitized, reproducible software defect; and</li><li>direct a security report into the private disclosure process.</li></ul><p>Support cannot</p><p>Because StellarKey is self-custodial and backend-free, support cannot recover lost keys, unlock a vault, restore data that was not backed up, reverse a Stellar transaction, freeze an asset, issue a refund, alter a ledger record, monitor a suspended app, access local merchant data, or resolve an issuer, hardware-wallet, merchant, customer, or counterparty dispute. Support also cannot provide financial, tax, legal, accounting, or regulatory advice.</p></section>

        <section id="support-channels"><h2><DocGlobe />Choose the right channel</h2><ul className="prose-list"><li>Public software defects and feature requests: search existing reports, then open a sanitized GitHub issue with safe reproduction steps.</li><li>Suspected vulnerability: do not open a public issue. Follow the private process on the Security page.</li><li>Asset, redemption, or issuer dispute: contact the asset issuer through a verified official channel. StellarKey does not represent the issuer.</li><li>General product question: use the protected support action below.</li></ul></section>

        <section id="support-expectations"><h2><DocCycle />Response expectations</h2><p>StellarKey is free software and general product support has no guaranteed response time, service level, fix deadline, or individual recovery service. Clear, minimal, reproducible reports are easier to investigate. A reply, workaround, planned change, or issue label is not a warranty that a defect will be fixed or that a transaction or local record can be recovered.</p></section>

        <section id="support-contact"><h2><DocFile />Contact support</h2><p>The contact address is assembled only after you activate the button, keeping it out of the static page markup and reducing basic automated harvesting. Your email provider and the recipient will process the message, so include only what is necessary.</p><p><ContactAction channel="support">Email support</ContactAction></p></section>
    </LegalPage>
  );
}
