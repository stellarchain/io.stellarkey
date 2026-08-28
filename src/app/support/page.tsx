import type { Metadata } from "next";
import { ContactAction } from "@/components/ContactAction";
import { LegalPage } from "@/components/LegalPage";
import {
  APPLICATION_VERSION,
  BRAND_NAME,
  BUILD_COMMIT,
  PUBLIC_OPEN_GRAPH_IMAGE,
  PUBLIC_ROUTES,
  SOURCE_REPOSITORY_URL,
} from "@/lib/brand";

const description = `Safe support boundaries and help channels for ${BRAND_NAME}.`;

const sections = [
  { id: "start", label: "Start safely" },
  { id: "self-service", label: "Checks you can make" },
  { id: "safe-details", label: "Safe diagnostic details" },
  { id: "never-send", label: "Never send secrets" },
  { id: "boundaries", label: "Support boundaries" },
  { id: "channels", label: "Choose the right channel" },
  { id: "expectations", label: "Response expectations" },
  { id: "contact", label: "Contact support" },
] as const;

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
      highlights={[
        "No legitimate support request requires your recovery phrase, private key, password, passkey output, decrypted backup, or remote device access.",
        "Support can troubleshoot the interface and public ledger behavior, but cannot recover a wallet, reverse a transaction, or restore local data that was never backed up.",
        "Use a public GitHub issue for sanitized product defects and the private Security channel for suspected vulnerabilities.",
      ]}
      sections={sections}
    >
      <section id="start">
        <h2>Start safely</h2>
        <p>
          Lock the wallet before sharing a screen or screenshot. Do not install remote-access
          software, run code from an unsolicited message, import a recovery phrase into a support
          form, or move funds to an address presented as “verification.” StellarKey maintainers will
          not contact you first to repair, upgrade, synchronize, or validate a wallet.
        </p>
        <p>
          For an unexpected payment or balance, first confirm the selected network and public account
          address. Then compare the transaction hash and operations with a Stellar explorer you trust.
          A public ledger entry is authoritative even when a local interface is delayed.
        </p>
      </section>

      <section id="self-service">
        <h2>Checks you can make</h2>
        <ul>
          <li>Confirm that the site origin is exactly stellarkey.io and is using HTTPS.</li>
          <li>Open About and compare the full release commit with the published source release.</li>
          <li>Check the active account, mainnet or testnet selection, and configured Horizon or RPC endpoint.</li>
          <li>Reload once, then retry a read-only action before repeating anything that could sign or submit.</li>
          <li>Check the transaction hash on the authoritative network before sending a second payment.</li>
          <li>Use a fresh, unfunded testnet wallet to reproduce a defect whenever possible.</li>
        </ul>
      </section>

      <section id="safe-details">
        <h2>Safe diagnostic details</h2>
        <p>The following is normally safe to include after checking it contains no customer data:</p>
        <ul>
          <li>
            StellarKey release {APPLICATION_VERSION} and commit <code>{BUILD_COMMIT}</code>;
          </li>
          <li>device model, operating-system version, browser name and version, and install mode;</li>
          <li>mainnet or testnet, the affected route, expected result, and exact sequence of actions;</li>
          <li>a public account address or transaction hash only when it is essential and already public;</li>
          <li>a redacted screenshot or copied error message with all secrets and personal records removed; and</li>
          <li>whether the issue also occurs with a fresh testnet wallet in the latest supported release.</li>
        </ul>
      </section>

      <section id="never-send">
        <h2>Never send secrets</h2>
        <p>
          Support never needs a recovery phrase, private key, wallet password, passkey output,
          encrypted or decrypted backup, raw signed transaction, one-time code, customer or merchant
          archive, complete browser-storage export, or remote access to your device. Do not paste
          secrets into a public issue, email, screenshot, form, chat, or AI assistant. If you believe a
          secret was exposed, move assets to a newly generated recovery path from a clean device; a
          password change cannot revoke a leaked Stellar signing key.
        </p>
      </section>

      <section id="boundaries">
        <h2>Support boundaries</h2>
        <h3>Support can</h3>
        <ul>
          <li>explain documented wallet, backup, network, asset, and merchant behavior;</li>
          <li>help distinguish an interface problem from confirmed public ledger state;</li>
          <li>triage a sanitized, reproducible software defect; and</li>
          <li>direct a security report into the private disclosure process.</li>
        </ul>
        <h3>Support cannot</h3>
        <p>
          Because StellarKey is self-custodial and backend-free, support cannot recover lost keys,
          unlock a vault, restore data that was not backed up, reverse a Stellar transaction, freeze
          an asset, issue a refund, alter a ledger record, monitor a suspended app, access local
          merchant data, or resolve an issuer, hardware-wallet, merchant, customer, or counterparty
          dispute. Support also cannot provide financial, tax, legal, accounting, or regulatory advice.
        </p>
      </section>

      <section id="channels">
        <h2>Choose the right channel</h2>
        <ul>
          <li>
            <strong>Public software defects and feature requests:</strong> search existing reports,
            then open a sanitized <a href={`${SOURCE_REPOSITORY_URL}/issues`}>GitHub issue</a> with
            safe reproduction steps.
          </li>
          <li>
            <strong>Suspected vulnerability:</strong> do not open a public issue. Follow the private
            process on the <a href={PUBLIC_ROUTES.security}>Security page</a>.
          </li>
          <li>
            <strong>Asset, redemption, or issuer dispute:</strong> contact the asset issuer through a
            verified official channel. StellarKey does not represent the issuer.
          </li>
          <li>
            <strong>General product question:</strong> use the protected support action below.
          </li>
        </ul>
      </section>

      <section id="expectations">
        <h2>Response expectations</h2>
        <p>
          StellarKey is free software and general product support has no guaranteed response time,
          service level, fix deadline, or individual recovery service. Clear, minimal, reproducible
          reports are easier to investigate. A reply, workaround, planned change, or issue label is
          not a warranty that a defect will be fixed or that a transaction or local record can be
          recovered.
        </p>
      </section>

      <section id="contact">
        <h2>Contact support</h2>
        <p>
          The contact address is assembled only after you activate the button, keeping it out of the
          static page markup and reducing basic automated harvesting. Your email provider and the
          recipient will process the message, so include only what is necessary.
        </p>
        <ContactAction channel="support">Email support</ContactAction>
      </section>
    </LegalPage>
  );
}
