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

const description = `${BRAND_NAME} security model, supported disclosure scope, and responsible disclosure process.`;

const sections = [
  { id: "principles", label: "Security principles" },
  { id: "threat-model", label: "Threat model and limits" },
  { id: "vault", label: "Vault and local data" },
  { id: "signing", label: "Signing and transaction safety" },
  { id: "passkeys", label: "Passkeys and hardware wallets" },
  { id: "web-security", label: "Web and release security" },
  { id: "maintenance", label: "Ongoing security maintenance" },
  { id: "disclosure", label: "Responsible disclosure" },
  { id: "supported-release", label: "Supported release" },
  { id: "report", label: "Report securely" },
] as const;

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
      highlights={[
        "Wallet secrets and merchant records are encrypted locally; StellarKey has no server-side key store or recovery operator.",
        "Every signature still depends on a trustworthy device, browser, origin, build, and review by the person authorizing it.",
        "Security maintenance is ongoing and the source is public, but no software—including StellarKey—can guarantee absolute security.",
      ]}
      sections={sections}
    >
      <section id="principles">
        <h2>Security principles</h2>
        <ul>
          <li><strong>Minimize custody:</strong> do not build an application backend that can receive keys.</li>
          <li><strong>Encrypt by default:</strong> keep sensitive local records encrypted at rest.</li>
          <li><strong>Make authority visible:</strong> show the full transaction before signing.</li>
          <li><strong>Fail closed:</strong> reject malformed storage, unsupported signing paths, unsafe callbacks, and network mismatches.</li>
          <li><strong>Keep recovery independent:</strong> a password and tested backup remain available when optional passkey unlock is used.</li>
          <li><strong>Make releases inspectable:</strong> publish source identity, checksums, dependency inventory, and disclosure instructions.</li>
        </ul>
      </section>

      <section id="threat-model">
        <h2>Threat model and limits</h2>
        <p>
          The local encryption model is designed to reduce exposure when someone reads a locked
          browser profile, exported encrypted backup, or encrypted merchant database without the
          unlock material. Transaction review, endpoint validation, and strict parsing are designed
          to reduce mistakes and unsafe data crossing a trust boundary. Browser security headers are
          designed to reduce injection, framing, and unnecessary device access.
        </p>
        <p>
          These controls cannot protect an already-unlocked wallet on a compromised device; a
          malicious browser, extension, operating system, keyboard, clipboard, screen recorder, DNS
          response, hosting origin, dependency, or release artifact; phishing on a lookalike origin;
          a weak or exposed password; a compromised recovery backup; coerced device verification; or
          an unsafe transaction the user approves. They also cannot control Stellar consensus,
          Horizon or RPC operators, asset issuers, market-data services, Trezor infrastructure, or
          counterparties.
        </p>
        <p>
          No design review, automated test suite, encryption algorithm, hardware wallet, passkey, or
          open-source process removes every vulnerability. StellarKey cannot guarantee absolute
          security. Use a dedicated, maintained device where practical, keep recovery material
          offline, verify the exact origin and release, and test new workflows with small amounts.
        </p>
      </section>

      <section id="vault">
        <h2>Vault and local data</h2>
        <p>
          A new wallet uses a random 256-bit master key. The browser derives a wrapping key from the
          wallet password using PBKDF2-HMAC-SHA-256 with a unique random salt and 600,000 iterations,
          then protects the master key with authenticated AES-GCM encryption. Recovery phrases,
          imported signing keys, and private notes are encrypted with the master key. Merchant data
          uses a separate random encryption key wrapped by that master key and is committed
          transactionally in IndexedDB.
        </p>
        <p>
          AES-GCM detects an incorrect key or modified ciphertext; it does not make a weak password
          strong or protect plaintext after a successful unlock. Signing secrets are opened only for
          the scoped action that needs them, and in-memory byte buffers are cleared where the platform
          allows. JavaScript and browser memory management cannot guarantee that every temporary copy
          is immediately or forensically erased.
        </p>
        <p>
          Locking removes the active vault and merchant keys from application state. Auto-lock reduces
          an unattended session window but is not a substitute for locking the device. Full backups
          use the encrypted version 2 envelope; legacy plaintext wallet imports are rejected. A
          backup is useful only if it is stored safely and has been tested.
        </p>
      </section>

      <section id="signing">
        <h2>Signing and transaction safety</h2>
        <p>
          StellarKey validates addresses, network identity, amounts, assets, issuers, and supported
          operations before constructing a transaction. The review surface shows the complete
          operation list, source, destination, asset identity, amount, memo, fee, and network before
          a software or hardware signer is invoked. Processing controls prevent accidental duplicate
          submission while a request is active.
        </p>
        <p>
          After broadcast, the app exposes the transaction hash and tracks a pending transaction to a
          confirmed success or failure where possible. Merchant crypto charges additionally match the
          destination, network, asset, amount, memo, and confirmation state reported by Horizon.
          Temporary endpoint failure remains possible, so an interface status is not a substitute for
          checking the authoritative ledger before releasing high-value goods or treating a payment
          as final.
        </p>
      </section>

      <section id="passkeys">
        <h2>Passkeys and hardware wallets</h2>
        <h3>Passkey unlock</h3>
        <p>
          On a compatible HTTPS origin, WebAuthn PRF derives an origin-bound secret after the platform
          authenticator requires user verification. StellarKey uses that result to unwrap the
          existing local vault master key. It does not receive a biometric template, export the
          authenticator&apos;s private key, replace Stellar signing authority, or turn the wallet into a
          passkey smart account. The local passkey wrapper is not included in backups, so retain the
          wallet password and recovery material.
        </p>
        <h3>Trezor</h3>
        <p>
          When Trezor is selected, StellarKey sends the supported transaction description through the
          official Trezor Connect flow and asks the device to sign. Confirm the address and every
          transaction detail on the hardware display; a compromised browser can still try to present
          an unsafe request. StellarKey never asks for the Trezor recovery phrase. Trezor Connect and
          its services are an optional, separately licensed external dependency.
        </p>
      </section>

      <section id="web-security">
        <h2>Web and release security</h2>
        <p>
          Production must be served over HTTPS. The generated host policy applies a build-specific
          Content Security Policy, blocks framing and MIME sniffing, restricts browser permissions,
          separates the origin, and permits cross-origin popups needed by Trezor. The app has no
          dynamic API routes, server sessions, analytics script, advertising script, or cloud
          database. Its service worker caches only the versioned static application shell.
        </p>
        <p>
          Every production build exposes the full source commit and a machine-readable release
          manifest. Published releases are expected to include artifact checksums and a CycloneDX
          software bill of materials. Compare those records with the
          {" "}<a href={SOURCE_REPOSITORY_URL}>public source</a>. A matching identifier improves
          traceability but cannot alone prove that the host, build environment, or device is safe.
        </p>
      </section>

      <section id="maintenance">
        <h2>Ongoing security maintenance</h2>
        <p>
          Security is treated as an ongoing engineering process, not a one-time claim. Maintainers
          review security-sensitive changes and dependencies as part of release work; run type,
          unit, integration, browser, accessibility, static-export, dependency-audit, and bundle
          checks; keep unsafe or incomplete flows disabled; and investigate credible vulnerability
          reports. Release checks cover desktop Chromium plus iPhone and iPad WebKit profiles, while
          physical Trezor and installed-device behavior remain manual release checks.
        </p>
        <p>
          The process is informed by secure-development and verification practices such as NIST&apos;s
          {" "}<a href="https://csrc.nist.gov/pubs/sp/800/218/final">Secure Software Development
          Framework</a> and OWASP&apos;s
          {" "}<a href="https://owasp.org/www-project-application-security-verification-standard/">
          Application Security Verification Standard</a>. This is a statement of direction—not a
          claim of NIST or OWASP certification,
          formal compliance, independent audit, penetration-test coverage, or freedom from defects.
          Public source enables independent inspection, but publication alone is not an audit.
        </p>
      </section>

      <section id="disclosure">
        <h2>Responsible disclosure</h2>
        <p>
          Report a reproducible issue privately before publishing details. Include the affected route,
          release or commit, browser and operating-system version, expected behavior, observed
          behavior, and the smallest safe reproduction. We will acknowledge and triage credible
          reports, but cannot promise a reward or response deadline unless a separate program says so.
        </p>
        <p>
          Good-faith testing must use accounts and data you own or are explicitly authorized to use,
          avoid privacy violations and disruption, stop if sensitive data is encountered, and allow a
          reasonable opportunity to investigate before disclosure. This policy does not authorize
          testing Stellar infrastructure, hosting providers, Trezor services, asset issuers, or any
          other third party. The machine-readable disclosure contact is published at
          {" "}<a href="/.well-known/security.txt">/.well-known/security.txt</a> in the format defined
          for security.txt.
        </p>
      </section>

      <section id="supported-release">
        <h2>Supported release</h2>
        <p>
          Security fixes target the latest published build, currently {BRAND_NAME} release
          {" "}{APPLICATION_VERSION}, commit {BUILD_COMMIT}. Confirm an issue against that release
          when practical and name any older affected release in your report.
        </p>
        <p>
          Older builds should be treated as unsupported unless a release notice explicitly says
          otherwise. A support label does not guarantee that an undiscovered vulnerability is absent
          or that a fix will be available on a particular schedule.
        </p>
      </section>

      <section id="report">
        <h2>Report securely</h2>
        <p>
          Never include a recovery phrase, secret key, wallet password, passkey output, decrypted or
          encrypted wallet backup, merchant archive, customer record, or real unredacted transaction
          data in a report. Use a fresh testnet wallet and redact public addresses when they are not
          essential to the reproduction.
        </p>
        <p>
          The button below constructs the dedicated security contact only after you activate it, which
          keeps the complete address out of static page markup and deters basic harvesting.
        </p>
        <ContactAction channel="security">Email the security team</ContactAction>
      </section>
    </LegalPage>
  );
}
