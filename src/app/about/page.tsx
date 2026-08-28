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
} from "@/lib/brand";

const description = `How ${BRAND_NAME} keeps Stellar keys and records under your control without an application backend.`;

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
    >
      <section>
        <h2>Keys first</h2>
        <p>
          StellarKey creates, encrypts, and uses wallet keys in your browser. It does not create a
          StellarKey account for you, upload your recovery material, or place an application server
          between you and the Stellar network. You authorize every transaction from the device that
          holds your encrypted vault or connected hardware wallet.
        </p>
      </section>

      <section>
        <h2>Backend-free by design</h2>
        <p>
          The production release is a static web application. It talks directly to the Stellar
          Horizon and RPC endpoints selected in Settings, issuer-controlled asset domains,
          market-data services, and Trezor Connect when you choose those features. Merchant records
          stay encrypted in this browser and do not synchronize between devices.
        </p>
      </section>

      <section>
        <h2>What StellarKey supports</h2>
        <ul>
          <li>Mainnet and testnet accounts, payments, assets, activity, and Stellar DEX swaps.</li>
          <li>Password-encrypted backups and optional origin-bound Face ID or Touch ID unlock.</li>
          <li>Trezor address verification and on-device Stellar transaction signing.</li>
          <li>Local-first merchant tools whose operational records remain on this device.</li>
        </ul>
      </section>

      <section>
        <h2>Current release</h2>
        <p>
          You are reading the trust center for {BRAND_NAME} release {APPLICATION_VERSION}. The
          release identifier also appears in Security so reports can name the affected build.
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
            : " A clean match verifies that the deployed files were built from that source revision."}
        </p>
      </section>

      <section>
        <h2>Independent software</h2>
        <p>
          StellarKey is independent software, not affiliated with, sponsored or endorsed by the
          Stellar Development Foundation. “Stellar” is a trademark of the Stellar Development
          Foundation. References to Stellar describe the network on which this software operates.
        </p>
      </section>
    </LegalPage>
  );
}
