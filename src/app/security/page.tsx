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
  DocBook,
  DocCheck,
  DocChip,
  DocClock,
  DocCycle,
  DocExport,
  DocFile,
  DocFingerprint,
  DocGlobe,
  DocKey,
  DocLock,
  DocScales,
  DocShield,
} from "@/components/marketing/DocIcons";

const description =
  "The threat model, the cryptography, the browser hardening, and how to report a vulnerability.";

const highlights = [
  "Wallet secrets and merchant records are encrypted locally; StellarKey has no server-side key store or recovery operator.",
  "Every signature still depends on a trustworthy device, browser, origin, build, and review by the person authorizing it.",
  "Security maintenance is ongoing and the source is public, but no software (including StellarKey) can guarantee absolute security.",
] as const;

const sections = [
  { id: "security-principles", label: "Security principles" },
  { id: "security-threat-model", label: "Threat model and limits" },
  { id: "security-vault", label: "Vault and local data" },
  { id: "security-signing", label: "Signing and transaction safety" },
  { id: "security-private-balance", label: "Private Payments status" },
  { id: "security-passkeys", label: "Passkeys and hardware wallets" },
  { id: "security-web-security", label: "Web and release security" },
  { id: "security-maintenance", label: "Ongoing security maintenance" },
  { id: "security-disclosure", label: "Responsible disclosure" },
  { id: "security-supported-release", label: "Supported release" },
  { id: "security-report", label: "Report securely" },
  { id: "security-spec", label: "What is actually protecting you" },
  { id: "security-leaves", label: "Everything that leaves" },
  { id: "security-stored", label: "What is kept here" },
  { id: "security-browser", label: "How the page is locked down" },
  { id: "security-threat", label: "What it does not protect" },
  { id: "security-checklist", label: "Five things worth doing" },
] as const;

export const metadata: Metadata = {
  title: "Protect the recovery path",
  description,
  alternates: { canonical: PUBLIC_ROUTES.security },
  openGraph: {
    type: "article",
    url: PUBLIC_ROUTES.security,
    title: "Protect the recovery path",
    description,
    images: [PUBLIC_OPEN_GRAPH_IMAGE],
  },
};

export default function SecurityPage() {
  return (
    <LegalPage
      current="security"
      eyebrow="security // and disclosure"
      title="Protect the recovery path"
      summary="StellarKey reduces custody risk by keeping keys local, but browser origins, extensions, devices, dependencies, and the services you connect remain part of the trust boundary."
      highlights={highlights}
      sections={sections}
    >
        <section id="security-principles"><h2><DocShield />Security principles</h2><ul className="prose-list"><li>Minimize custody: do not build an application backend that can receive keys.</li><li>Encrypt by default: keep sensitive local records encrypted at rest.</li><li>Make authority visible: show the full transaction before signing.</li><li>Fail closed: reject malformed storage, unsupported signing paths, unsafe callbacks, and network mismatches.</li><li>Keep recovery independent: a password and tested backup remain available when optional passkey unlock is used.</li><li>Make releases inspectable: publish source identity, checksums, dependency inventory, and disclosure instructions.</li></ul></section>

        <section id="security-threat-model"><h2><DocAlert />Threat model and limits</h2><p>The local encryption model is designed to reduce exposure when someone reads a locked browser profile, exported encrypted backup, or encrypted merchant database without the unlock material. Transaction review, endpoint validation, and strict parsing are designed to reduce mistakes and unsafe data crossing a trust boundary. Browser security headers are designed to reduce injection, framing, and unnecessary device access.</p><p>These controls cannot protect an already-unlocked wallet on a compromised device; a malicious browser, extension, operating system, keyboard, clipboard, screen recorder, DNS response, hosting origin, dependency, or release artifact; phishing on a lookalike origin; a weak or exposed password; a compromised recovery backup; coerced device verification; or an unsafe transaction the user approves. They also cannot control Stellar consensus, Horizon or RPC operators, asset issuers, market-data services, Trezor infrastructure, or counterparties.</p><p>No design review, automated test suite, encryption algorithm, hardware wallet, passkey, or open-source process removes every vulnerability. StellarKey cannot guarantee absolute security. Use a dedicated, maintained device where practical, keep recovery material offline, verify the exact origin and release, and test new workflows with small amounts.</p></section>

        <section id="security-vault"><h2><DocLock />Vault and local data</h2><p>A new wallet uses a random 256-bit master key. The browser derives a wrapping key from the wallet password using PBKDF2-HMAC-SHA-256 with a unique random salt and 600,000 iterations, then protects the master key with authenticated AES-GCM encryption. Recovery phrases, imported signing keys, contacts, and private notes are encrypted with the master key. Merchant data uses a separate random encryption key wrapped by that master key and is committed transactionally in IndexedDB.</p><p>AES-GCM detects an incorrect key or modified ciphertext; it does not make a weak password strong or protect plaintext after a successful unlock. Signing secrets are opened only for the scoped action that needs them, and in-memory byte buffers are cleared where the platform allows. JavaScript and browser memory management cannot guarantee that every temporary copy is immediately or forensically erased.</p><p>Locking removes the active vault and merchant keys from application state. It does not encrypt the account index needed to render the lock screen: each account&apos;s public key, label, and creation time remain readable to someone who can inspect the locked browser profile. A public key is enough to correlate that account&apos;s full public ledger history. Treat access to the browser profile as financially sensitive even though it does not grant signing authority.</p><p>Auto-lock reduces an unattended session window but is not a substitute for locking the device. Full backups use the encrypted version 2 envelope; legacy plaintext wallet imports are rejected. A backup is useful only if it is stored safely and has been tested.</p></section>

        <section id="security-signing"><h2><DocCheck />Signing and transaction safety</h2><p>StellarKey validates addresses, network identity, amounts, assets, issuers, and supported operations before constructing a transaction. The review surface shows the complete operation list, source, destination, asset identity, amount, memo, fee, and network before a software or hardware signer is invoked. Processing controls prevent accidental duplicate submission while a request is active.</p><p>After broadcast, the app exposes the transaction hash and tracks a pending transaction to a confirmed success or failure where possible. Merchant crypto charges additionally match the destination, network, asset, amount, memo, and confirmation state reported by Horizon. Temporary endpoint failure remains possible, so an interface status is not a substitute for checking the authoritative ledger before releasing high-value goods or treating a payment as final.</p></section>

        <section id="security-private-balance"><h2><DocLock />Private Payments status</h2><p>Private Payments shipped in release 1.3.0 as a testnet-only preview with local zero-knowledge proving and no application backend. The runtime is mounted in the production wallet behind a fail-closed release gate: availability is refused on any network other than Stellar testnet, and the checked-in proving artifacts carry development status, which a production build refuses to use. Promotion to Mainnet requires reproducible artifacts, a completed trusted-setup ceremony, independent contract and circuit review, immutable deployment evidence, recovery drills, and browser and physical-device release gates tied to the same artifact hashes; the app displays that evidence status itself. <a href={PUBLIC_ROUTES.private}>Private payments, explained</a> covers the full design.</p><p>The implementation derives deployment-bound keys only inside an unlocked supported software-account callback, isolates proof work in a worker, encrypts owned records and pending actions locally, reviews exact Soroban operations and restoration keys before signing, and reconciles against a canonical on-chain archive. These controls do not hide the public fee payer, timing, shared-deployment activity, proof, commitments, nullifiers, or ciphertext, and deposits and withdrawals reveal their public endpoint and amount. Browser, device, origin, artifact, RPC, and correlation risks remain.</p></section>

        <section id="security-passkeys"><h2><DocFingerprint />Passkeys and hardware wallets</h2><p>Passkey unlock</p><p>On a compatible HTTPS origin, WebAuthn PRF derives an origin-bound secret after the platform authenticator requires user verification. StellarKey uses that result to unwrap the existing local vault master key. It does not receive a biometric template, export the authenticator’s private key, replace Stellar signing authority, or turn the wallet into a passkey smart account. The local passkey wrapper is not included in backups, so retain the wallet password and recovery material.</p><p>Trezor</p><p>When Trezor is selected, StellarKey sends the supported transaction description through the official Trezor Connect flow and asks the device to sign. Confirm the address and every transaction detail on the hardware display; a compromised browser can still try to present an unsafe request. StellarKey never asks for the Trezor recovery phrase. Trezor Connect and its services are an optional, separately licensed external dependency.</p><p>Release {APPLICATION_VERSION} uses the current stable <code>@trezor/connect-web@9.7.3</code>. Its optional, lazy-loaded dependency graph currently carries ten low-severity <code>elliptic</code> advisories through Trezor Connect&apos;s Bitcoin/UTXO support, not StellarKey&apos;s Stellar signing implementation. npm offers no fixed stable Trezor release. High and critical production advisories remain release-blocking, and this exception is re-evaluated when Trezor publishes an update.</p></section>

        <section id="security-web-security"><h2><DocGlobe />Web and release security</h2><p>Production must be served over HTTPS. The generated host policy applies a build-specific Content Security Policy, blocks framing and MIME sniffing, restricts browser permissions, separates the origin, and permits cross-origin popups needed by Trezor. The app has no dynamic API routes, server sessions, analytics script, advertising script, or cloud database. Its service worker caches only the versioned static application shell.</p><p>The CSP keeps <code>script-src</code> hash-bound with no <code>unsafe-inline</code> or JavaScript <code>unsafe-eval</code>. It permits <code>wasm-unsafe-eval</code> only so the browser can compile the local, hash-verified WebAssembly used to create Private Payments proofs; this does not enable JavaScript string evaluation. Its <code>connect-src https:</code> and image policy are deliberately broad because user-configurable Stellar endpoints and issuer-chosen metadata or logo hosts cannot be enumerated at build time. This is an outbound-connection privacy boundary, not permission for a remote response to execute as script.</p><p>Every production build exposes the full source commit and a machine-readable release manifest. Published releases are expected to include artifact checksums and a CycloneDX software bill of materials. Compare those records with the public source. A matching identifier improves traceability but cannot alone prove that the host, build environment, or device is safe.</p></section>

        <section id="security-maintenance"><h2><DocCycle />Ongoing security maintenance</h2><p>Security is treated as an ongoing engineering process, not a one-time claim. Maintainers review security-sensitive changes and dependencies as part of release work; run type, unit, integration, browser, accessibility, static-export, dependency-audit, and bundle checks; keep unsafe or incomplete flows disabled; and investigate credible vulnerability reports. Release checks cover desktop Chromium plus iPhone and iPad WebKit profiles, while physical Trezor and installed-device behavior remain manual release checks.</p><p>The process is informed by secure-development and verification practices such as NIST’s Secure Software Development Framework and OWASP’s Application Security Verification Standard. This is a statement of direction, not a claim of NIST or OWASP certification, formal compliance, independent audit, penetration-test coverage, or freedom from defects. Public source enables independent inspection, but publication alone is not an audit.</p></section>

        <section id="security-disclosure"><h2><DocFile />Responsible disclosure</h2><p>Report a reproducible issue privately before publishing details. Include the affected route, release or commit, browser and operating-system version, expected behavior, observed behavior, and the smallest safe reproduction. We will acknowledge and triage credible reports, but cannot promise a reward or response deadline unless a separate program says so.</p><p>Good-faith testing must use accounts and data you own or are explicitly authorized to use, avoid privacy violations and disruption, stop if sensitive data is encountered, and allow a reasonable opportunity to investigate before disclosure. This policy does not authorize testing Stellar infrastructure, hosting providers, Trezor services, asset issuers, or any other third party. The machine-readable disclosure contact is published at /.well-known/security.txt in the format defined for security.txt.</p></section>

        <section id="security-supported-release"><h2><DocChip />Supported release</h2><p>Security fixes target the latest published build, currently StellarKey release {APPLICATION_VERSION}, commit {BUILD_COMMIT}. Confirm an issue against that release when practical and name any older affected release in your report.</p><p>Older builds should be treated as unsupported unless a release notice explicitly says otherwise. A support label does not guarantee that an undiscovered vulnerability is absent or that a fix will be available on a particular schedule.</p></section>

        <section id="security-report"><h2><DocKey />Report securely</h2><p>Never include a recovery phrase, secret key, wallet password, passkey output, decrypted or encrypted wallet backup, merchant archive, customer record, or real unredacted transaction data in a report. Use a fresh testnet wallet and redact public addresses when they are not essential to the reproduction.</p><p>The button below constructs the dedicated security contact only after you activate it, which keeps the complete address out of static page markup and deters basic harvesting.</p><p><ContactAction channel="security">Email the security team</ContactAction></p></section>

        <section id="security-spec"><h2><DocChip />What is actually protecting you</h2>
        <p>These are not marketing numbers. Each one is read straight out of the source, and you can check them yourself in the files named beside each figure.</p>
        <div className="spec"><div><DocChip /><b>Vault cipher</b><span>AES-256-GCM</span></div><div><DocKey /><b>Key derivation</b><span>PBKDF2-SHA-256, 600,000 iterations</span></div><div><DocLock /><b>Merchant records</b><span>XChaCha20-Poly1305, 24-byte nonce</span></div><div><DocClock /><b>Auto-lock</b><span>15 minutes idle, adjustable</span></div><div><DocFingerprint /><b>Staff PIN</b><span>5 wrong tries per open app window, then 30 seconds</span></div><div><DocExport /><b>Hardware signing</b><span>Trezor, key never enters the browser</span></div></div>
        <p>The staff PIN throttle is client-side state in the open app window and resets after a reload or close. At roughly ten attempts per minute it is a local till deterrent, not high-security authentication. The PIN cannot sign a Stellar transaction or move money; the unlocked wallet and reviewed signing flow remain separate.</p>
        </section>

        <section id="security-leaves"><h2><DocGlobe />Everything that leaves this device</h2>
        <p>There is no StellarKey application server, but direct destinations vary with the network, endpoints, assets, and optional features you choose. These are the request categories and what they can reveal.</p>
        <div className="tbl" role="region" aria-label="External request destinations" tabIndex={0}><table><thead><tr><th>goes to</th><th>what for</th><th>what it learns</th></tr></thead>
        <tbody><tr><td className="g">Selected Horizon / RPC endpoint</td><td>Balances, history, fees, simulation, and transaction submission</td><td>Your IP, requested public accounts, and signed transactions. Never your secret key.</td></tr><tr><td className="g">CoinGecko</td><td>Optional market and fiat display prices</td><td>Your IP, timing, and requested asset identifiers.</td></tr><tr><td className="g">Issuer-chosen metadata / logo hosts</td><td>Optional stellar.toml details and asset artwork</td><td>Your IP and the asset being viewed. Loading an issuer logo can therefore disclose interest in that asset to the issuer or its image host.</td></tr><tr><td className="g">Friendbot</td><td>Only when requesting testnet funding</td><td>Your IP and testnet public address.</td></tr><tr><td className="g">Trezor Connect</td><td>Only after choosing a Trezor action</td><td>Connection metadata and the supported unsigned transaction presented for device approval.</td></tr><tr><td className="g">External explorer</td><td>Only after opening an explorer link</td><td>The public account or transaction identifier you chose.</td></tr></tbody></table></div>
        <p className="note"><DocAlert />No analytics, advertising, application telemetry, or StellarKey API receives these requests. Use the browser network inspector to see the exact destinations for your configuration.</p>
        </section>

        <section id="security-stored"><h2><DocLock />What is kept here, and how to remove it</h2>
        <p>All of it lives in this browser, on this device. Reset Wallet in Settings deletes every one of these keys, and once it is gone we cannot help you get it back, because we never had it.</p>
        <div className="spec"><div><DocLock /><b>Your vault</b><span>Password-wrapped. Holds encrypted signing authority.</span></div><div><DocFile /><b>Merchant records</b><span>Orders, catalogue, customers, shifts. Encrypted.</span></div><div><DocBook /><b>Contacts</b><span>AES-GCM encrypted and available only while unlocked.</span></div><div><DocAlert /><b>Locked account index</b><span>Public key, label, and creation time remain readable locally.</span></div><div><DocCycle /><b>Preferences</b><span>Network, currency, auto-lock, privacy mode.</span></div></div>
        </section>

        <section id="security-browser"><h2><DocShield />How the page itself is locked down</h2>
        <p>A wallet in a browser is only as safe as the page it runs in. These headers ship with every response, and you can read them in the response yourself.</p>
        <dl className="deflist"><div><dt>Content-Security-Policy</dt><dd>Application scripts require this origin and an exact build-time hash; inline and JavaScript string evaluation are disabled. Hash-verified Private Payments proof code may compile as WebAssembly. Outbound HTTPS and images remain broad for configurable endpoints and issuer metadata.</dd></div><div><dt>frame-ancestors: none</dt><dd>The app cannot be put inside someone else’s page and used to trick you.</dd></div><div><dt>Permissions-Policy</dt><dd>Camera, microphone, location and the payment API are switched off at the browser level.</dd></div><div><dt>Strict-Transport-Security</dt><dd>A year of enforced HTTPS, so the app cannot be served to you over a plain connection.</dd></div><div><dt>X-Content-Type-Options</dt><dd>The browser will not second-guess a file’s type, which closes off a whole class of trickery.</dd></div><div><dt>Referrer-Policy</dt><dd>Links out do not carry the page you came from.</dd></div></dl>
        </section>

        <section id="security-threat"><h2><DocScales />What this protects you from, and what it does not</h2>
        <p>Anyone who only tells you the first half is selling something. Both halves are true and you should read the second one twice.</p>
        <div className="two">
        <div className="col ok"><h3><DocCheck />It protects you from</h3><ul><li>Somebody taking your money, because nobody but you can sign for it</li><li>A company freezing your account, because there is no account</li><li>A database of your customers leaking, because it never left your device</li><li>Us reading your balance, your notes or your books</li><li>A fee appearing later, because there is no billing relationship</li></ul></div>
        <div className="col no"><h3><DocAlert />It cannot protect you from</h3><ul><li>A stolen unlocked device, or a password written on the machine</li><li>Malware on the computer you are using, or a hostile browser extension</li><li>You approving a transaction you did not read properly</li><li>Losing your recovery phrase, which nobody can give back to you</li><li>A mistake in this software, which is why the source is public</li></ul></div>
        </div>
        </section>

        <section id="security-checklist"><h2><DocCheck />Five things worth doing today</h2>
        <p>Self-custody puts the work on you. It is not much work, and it is all front-loaded.</p>
        <ol className="check"><li><b>Write the recovery phrase on paper</b><span>Not in a photo, not in a password manager you also unlock on this device.</span></li><li><b>Test it before you rely on it</b><span>Restore into a second browser and confirm the address matches. Ten minutes now.</span></li><li><b>Export an encrypted backup</b><span>Your records live in this browser. If it is cleared they are gone, and the phrase does not bring them back.</span></li><li><b>Keep the lock short if you trade in public</b><span>A till on a counter is a device strangers stand next to.</span></li><li><b>Check the address before every first payment</b><span>The wallet flags an address you have never sent to. Read that flag.</span></li></ol>
        </section>
    </LegalPage>
  );
}
