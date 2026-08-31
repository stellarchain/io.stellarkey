import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { PanelDeal, PanelReceive, PanelSendReview } from "@/components/marketing/LandingPanels";
import "@/components/marketing/landing.css";
import {
  APPLICATION_VERSION,
  PUBLIC_OPEN_GRAPH_IMAGE,
  PUBLIC_ROUTES,
} from "@/lib/brand";
import {
  DocAlert,
  DocCheck,
  DocChip,
  DocCoin,
  DocCycle,
  DocEyeOff,
  DocFile,
  DocFingerprint,
  DocKey,
  DocQuestion,
  DocScales,
  DocShieldDots,
} from "@/components/marketing/DocIcons";

const description =
  "How Private Payments works: the note model, Poseidon2 commitments and nullifiers, Groth16 proofs built on your device, shielded addresses, recovery, and the gates before Mainnet.";

const highlights = [
  "Private: the amount, the recipient, and the memo of a private transfer stay encrypted. Public: money moving in or out, network fees paid by your Stellar account, and timing.",
  "Proofs are created on this device. There is no application backend, relayer, indexer, or hosted key service anywhere in the flow.",
  "A testnet-only preview today. Mainnet waits for independent audit and trusted-setup evidence, and the app shows you that status itself.",
] as const;

const sections = [
  { id: "private-what", label: "What it is" },
  { id: "private-pockets", label: "One wallet, two pockets" },
  { id: "private-split", label: "Private vs public" },
  { id: "private-how", label: "How a private payment works" },
  { id: "private-receiving", label: "Receiving privately" },
  { id: "private-screens", label: "What it looks like" },
  { id: "private-recovery", label: "Recovery" },
  { id: "private-trust", label: "The trust story" },
  { id: "private-faq", label: "The awkward questions" },
] as const;

export const metadata: Metadata = {
  title: "Private Payments",
  description,
  alternates: { canonical: PUBLIC_ROUTES.private },
  openGraph: {
    type: "article",
    url: PUBLIC_ROUTES.private,
    title: "Private Payments",
    description,
    images: [PUBLIC_OPEN_GRAPH_IMAGE],
  },
};

/* Shared diagram palette: the marketing tokens, written out because inline SVG
 * should not depend on custom-property inheritance to stay legible. */
const ink = {
  panel: "#141419",
  hair: "rgba(255,255,255,0.16)",
  gold: "#FDDA24",
  goldDeep: "#AA840E",
  jade: "#4FC98D",
  jadeLine: "rgba(79,201,141,0.55)",
  goldLine: "rgba(253,218,36,0.45)",
  dim: "#B3B3B3",
  faint: "#9A9AA2",
} as const;

const monoStack = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

function PocketFlowDiagram() {
  return (
    <svg
      viewBox="0 0 360 440"
      role="img"
      aria-labelledby="pocket-flow-title"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <title id="pocket-flow-title">
        Pocket flow: adding funds moves them from the public account into the
        private balance and is public. Sending and receiving inside the private
        balance is encrypted. Withdrawing moves funds back out to any Stellar
        address and is public again.
      </title>
      <defs>
        <marker id="pf-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 8 4 0 8Z" fill={ink.goldDeep} />
        </marker>
      </defs>
      <g fontFamily={monoStack}>
        <rect x="50" y="16" width="260" height="56" rx="10" fill={ink.panel} stroke={ink.goldLine} />
        <text x="180" y="40" textAnchor="middle" fontSize="12.5" fill={ink.gold}>public account</text>
        <text x="180" y="58" textAnchor="middle" fontSize="10" fill={ink.faint}>balances anyone can look up</text>

        <line x1="180" y1="72" x2="180" y2="122" stroke={ink.goldDeep} strokeWidth="1.4" markerEnd="url(#pf-arrow)" />
        <text x="194" y="94" fontSize="11" fill={ink.gold}>add · public</text>
        <text x="194" y="109" fontSize="9.5" fill={ink.faint}>amount and source visible</text>

        <rect x="40" y="128" width="280" height="132" rx="12" fill={ink.panel} stroke={ink.jadeLine} />
        <text x="180" y="152" textAnchor="middle" fontSize="12.5" fill={ink.jade}>private balance</text>
        <text x="180" y="169" textAnchor="middle" fontSize="10" fill={ink.faint}>encrypted records on this device</text>
        <rect x="60" y="182" width="112" height="34" rx="8" fill="#0E0E11" stroke={ink.hair} />
        <text x="116" y="203" textAnchor="middle" fontSize="10.5" fill={ink.jade}>send privately</text>
        <rect x="188" y="182" width="112" height="34" rx="8" fill="#0E0E11" stroke={ink.hair} />
        <text x="244" y="203" textAnchor="middle" fontSize="10.5" fill={ink.jade}>receive privately</text>
        <text x="180" y="240" textAnchor="middle" fontSize="9.5" fill={ink.faint}>amount · recipient · memo: encrypted</text>

        <line x1="180" y1="260" x2="180" y2="310" stroke={ink.goldDeep} strokeWidth="1.4" markerEnd="url(#pf-arrow)" />
        <text x="194" y="282" fontSize="11" fill={ink.gold}>withdraw · public</text>
        <text x="194" y="297" fontSize="9.5" fill={ink.faint}>amount and recipient visible</text>

        <rect x="50" y="316" width="260" height="56" rx="10" fill={ink.panel} stroke={ink.goldLine} />
        <text x="180" y="340" textAnchor="middle" fontSize="12.5" fill={ink.gold}>any Stellar address</text>
        <text x="180" y="358" textAnchor="middle" fontSize="10" fill={ink.faint}>a public payment like any other</text>

        <rect x="60" y="400" width="10" height="10" rx="2" fill={ink.gold} />
        <text x="78" y="409" fontSize="10.5" fill={ink.dim}>public by design</text>
        <rect x="204" y="400" width="10" height="10" rx="2" fill={ink.jade} />
        <text x="222" y="409" fontSize="10.5" fill={ink.dim}>encrypted</text>
      </g>
    </svg>
  );
}

function SplitDiagram() {
  return (
    <svg
      viewBox="0 0 360 400"
      role="img"
      aria-labelledby="split-title"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <title id="split-title">
        What leaves the device: keys, amounts, recipients, memos, the proof
        inputs, and history stay on the device. The public ledger sees a
        contract interaction, the fee account and its fee, timing, deposits and
        withdrawals with amounts, and an encrypted package it cannot open. The
        only bridge is the proof, checkable by the contract and readable by no
        one.
      </title>
      <defs>
        <marker id="sd-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 8 4 0 8Z" fill={ink.goldDeep} />
        </marker>
      </defs>
      <g fontFamily={monoStack}>
        <rect x="24" y="16" width="312" height="150" rx="12" fill={ink.panel} stroke={ink.jadeLine} />
        <text x="180" y="40" textAnchor="middle" fontSize="12.5" fill={ink.jade}>stays on this device</text>
        <text x="48" y="66" fontSize="11" fill={ink.dim}>· your keys</text>
        <text x="48" y="85" fontSize="11" fill={ink.dim}>· amounts and recipients</text>
        <text x="48" y="104" fontSize="11" fill={ink.dim}>· private memos</text>
        <text x="48" y="123" fontSize="11" fill={ink.dim}>· the proof&apos;s inputs</text>
        <text x="48" y="142" fontSize="11" fill={ink.dim}>· sent and received history</text>

        <line x1="180" y1="166" x2="180" y2="230" stroke={ink.goldDeep} strokeWidth="1.4" markerEnd="url(#sd-arrow)" />
        <text x="194" y="188" fontSize="11.5" fill={ink.gold}>the proof</text>
        <text x="194" y="203" fontSize="9.5" fill={ink.faint}>checkable by the contract</text>
        <text x="194" y="217" fontSize="9.5" fill={ink.faint}>readable by no one</text>

        <rect x="24" y="236" width="312" height="148" rx="12" fill={ink.panel} stroke={ink.goldLine} />
        <text x="180" y="260" textAnchor="middle" fontSize="12.5" fill={ink.gold}>the public ledger sees</text>
        <text x="48" y="286" fontSize="11" fill={ink.dim}>· a contract interaction</text>
        <text x="48" y="305" fontSize="11" fill={ink.dim}>· the fee account and its fee</text>
        <text x="48" y="324" fontSize="11" fill={ink.dim}>· timing</text>
        <text x="48" y="343" fontSize="11" fill={ink.dim}>· deposits and withdrawals, with amounts</text>
        <text x="48" y="362" fontSize="11" fill={ink.dim}>· an encrypted package it cannot open</text>
      </g>
    </svg>
  );
}

function SendPipelineDiagram() {
  const steps = [
    {
      n: "01 · choose",
      a: "picks notes to spend · two in, two out",
      b: "the selection never leaves this device",
    },
    {
      n: "02 · prove — on this device",
      a: "builds a Groth16 proof over BN254",
      b: "22,408 constraints · nothing uploaded",
    },
    {
      n: "03 · verify — on Stellar",
      a: "the contract checks proof and nullifiers",
      b: "it never learns amount, recipient, or memo",
    },
    {
      n: "04 · discover",
      a: "trial-decrypts the output envelopes",
      b: "only their viewing key opens theirs",
    },
  ] as const;
  return (
    <svg
      viewBox="0 0 360 424"
      role="img"
      aria-labelledby="pipeline-title"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <title id="pipeline-title">
        The send pipeline in four steps: the wallet chooses two notes to spend
        and two to create, an isolated worker builds a Groth16 proof over BN254
        on the device, the pool contract on Stellar verifies the proof and the
        nullifiers without learning the contents, and the recipient discovers
        the payment by trial-decrypting the output envelopes with their viewing
        key.
      </title>
      <defs>
        <marker id="sp-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 8 4 0 8Z" fill={ink.goldDeep} />
        </marker>
      </defs>
      <g fontFamily={monoStack}>
        {steps.map((step, index) => {
          const top = 16 + index * 102;
          return (
            <g key={step.n}>
              <rect x="24" y={top} width="312" height="76" rx="10" fill={ink.panel} stroke={ink.hair} />
              <text x="44" y={top + 24} fontSize="10" fill={ink.gold} letterSpacing="1">{step.n}</text>
              <text x="44" y={top + 45} fontSize="11" fill={ink.dim}>{step.a}</text>
              <text x="44" y={top + 62} fontSize="9.5" fill={ink.faint}>{step.b}</text>
              {index < steps.length - 1 ? (
                <line x1="180" y1={top + 76} x2="180" y2={top + 96} stroke={ink.goldDeep} strokeWidth="1.4" markerEnd="url(#sp-arrow)" />
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export default function PrivatePaymentsPage() {
  return (
    <LegalPage
      current="private"
      eyebrow="private payments // a testnet preview"
      title="Private payments, explained."
      summary="A private balance inside the same wallet. The amount, the recipient, and the memo of a private transfer stay encrypted; the proof is built on your device and verified against the public Stellar ledger."
      highlights={highlights}
      sections={sections}
      stamp={`Describes StellarKey release ${APPLICATION_VERSION} · testnet-only preview`}
    >
        <section id="private-what"><h2><DocShieldDots />What it is</h2>
        <p>Private Payments is a shielded pool for configured XLM and USDC, driven from the wallet you already have. Funds you move into it are held as encrypted notes on this device and can change hands without publishing the amount, the recipient, or the memo; a zero-knowledge proof convinces a contract on the public Stellar ledger that every rule held, without showing it the contents. That one sentence is the whole promise. The rest of this page is the mechanism.</p>
        <p>Release {APPLICATION_VERSION} ships it as a testnet-only preview, enforced in code at every boundary — the artifact manifest, preparation, review, and the transaction builder each refuse any network other than Stellar testnet, and a production build refuses the development-status proving artifacts outright. Mainnet comes after the release gates named in the trust story. Not before.</p></section>

        <section id="private-pockets"><h2><DocCoin />One wallet, two pockets</h2>
        <p>Your Stellar account is a public pocket: anyone can look up its balance and history, and that openness is what makes the ledger checkable. The private balance is a second pocket beside it. Crossings between the two — deposits in, withdrawals out — are ordinary public transactions by design; only life inside the pocket is encrypted.</p>
        <div className="tbl" style={{ padding: "1.25rem" }}><PocketFlowDiagram /></div>
        <p className="cap-line">every crossing is public · everything inside is encrypted</p></section>

        <section id="private-split"><h2><DocEyeOff />What is private, what is public</h2>
        <p>The whole deal, in one table. If a fact is not marked encrypted here, assume the world can see it.</p>
        <div className="tbl" role="region" aria-label="What is encrypted and what is public" tabIndex={0}><table><thead><tr><th>fact</th><th>who can read it</th></tr></thead>
        <tbody>
        <tr><td className="g">amount of a private transfer</td><td>Encrypted. The sender and the recipient.</td></tr>
        <tr><td className="g">recipient of a private transfer</td><td>Encrypted. The sender and the recipient.</td></tr>
        <tr><td className="g">private memo</td><td>Encrypted. Up to 32 bytes, and it survives recovery.</td></tr>
        <tr><td className="g">which notes were spent</td><td>Encrypted. The ledger stores commitments and ciphertext; spend selection stays on the device.</td></tr>
        <tr><td className="g">money moving in or out</td><td>Public. Deposits and withdrawals show their amount, endpoint, and timing, like any Stellar payment.</td></tr>
        <tr><td className="g">the fee account and its fee</td><td>Public. Every private send is submitted and paid for by a Stellar account.</td></tr>
        <tr><td className="g">timing and activity</td><td>Public. When the shared pool was used, and how often, is visible to anyone.</td></tr>
        </tbody></table></div>
        <div className="tbl" style={{ padding: "1.25rem" }}><SplitDiagram /></div></section>

        <section id="private-how"><h2><DocChip />How a private payment works</h2>
        <p>The private balance is a set of notes — think unspent banknotes rather than an account balance. A note is a 128-byte record carrying a 63-bit value, its owner, a random seed, and an optional 32-byte memo. The vocabulary, defined once and used throughout:</p>
        <div className="deflist">
        <div><dt>commitment</dt><dd>A Poseidon2 hash of a note (BN254, width 4, domain-tagged). The ledger stores the hash; the note itself never appears on-chain.</dd></div>
        <div><dt>Merkle tree</dt><dd>The pool&apos;s append-only binary tree of commitments, 32 levels deep — room for 2³² notes. Owning a note means being able to prove a path from its commitment to a recent root, without pointing at which leaf.</dd></div>
        <div><dt>nullifier</dt><dd>A second domain-tagged Poseidon2 hash, derivable only by a note&apos;s owner and revealed exactly once, when the note is spent. The contract keeps every nullifier it has seen; a repeat is a double-spend and is refused. The nullifier cannot be linked back to its commitment by an observer.</dd></div>
        <div><dt>Groth16</dt><dd>The proof system: a succinct zero-knowledge proof over the BN254 pairing curve, small enough for a contract to verify cheaply. Zero-knowledge means the verifier learns that the statement is true and nothing else.</dd></div>
        <div><dt>recipient envelope</dt><dd>A 181-byte HPKE ciphertext (RFC 9180: X25519 key agreement, HKDF-SHA256, AES-128-GCM) that carries the new note to its owner. Only the matching viewing key can open it.</dd></div>
        </div>
        <p>Every operation — deposit, private transfer, withdrawal — is one action with the same shape: up to two notes spent, up to two notes created, and a public value leg that is zero for a private transfer. That uniformity matters; an observer sees the same 213-byte output packages either way.</p>
        <ol className="prose-list">
        <li>The wallet selects the notes to spend. The proof anchors to any pool root from the last 1,440 ledgers, roughly the last two hours, so the transaction does not reveal how fresh your notes are.</li>
        <li>An isolated worker builds the Groth16 proof on this device: the spent notes sit in the tree under the anchor root, the nullifiers are correctly derived, values balance in and out, and both output commitments are well-formed. The circuit is 22,408 constraints with 13 public inputs, and nothing about the amount or the recipient leaves the device — there is no server to send it to.</li>
        <li>The transaction goes straight to the Stellar RPC endpoint you configured. The pool contract verifies the proof, checks both nullifiers are unseen, appends both commitments to the tree, and records the encrypted output packages.</li>
        <li>The recipient&apos;s wallet scans the pool&apos;s public record and trial-decrypts each envelope with its incoming viewing key. The one addressed to them opens; the rest are noise. There is no notification service, because a notification service would have to know.</li>
        </ol>
        <div className="tbl" style={{ padding: "1.25rem" }}><SendPipelineDiagram /></div>
        <p>None of the proving machinery is taken on trust. Every artifact is pinned by SHA-256 in a manifest the app ships publicly at <span style={{ fontFamily: "var(--mono)", fontSize: ".85em" }}>/protocol/private-balance/v1/manifest.json</span>, downloaded once, verified, kept locally, and reused. The shipped figures:</p>
        <div className="spec"><div><DocChip /><b>Proof system</b><span>Groth16 over BN254 · 22,408 constraints · 13 public inputs</span></div><div><DocFile /><b>Hashing</b><span>Poseidon2 (BN254, t=4) commitments and nullifiers · depth-32 tree</span></div><div><DocKey /><b>Proving key</b><span>3,934,162 bytes compressed on the wire · 14,169,632 bytes kept locally</span></div><div><DocCheck /><b>Witness builder</b><span>183,221-byte WASM module, the only code the page may compile to WebAssembly</span></div></div>
        <p>A SHA-256 mismatch on any artifact stops the feature rather than degrading it, and the content-security policy that limits WebAssembly to this hash-verified prover is documented on the Security page.</p></section>

        <section id="private-receiving"><h2><DocFingerprint />Receiving privately</h2>
        <p>A shielded address is 119 characters of bech32m — <span style={{ fontFamily: "var(--mono)", fontSize: ".85em" }}>tks1…</span> on testnet, <span style={{ fontFamily: "var(--mono)", fontSize: ".85em" }}>sks1…</span> on Mainnet — encoding a 68-byte payload with a 6-character checksum, so a mistyped address fails loudly instead of paying quietly. It never appears as an account on the public ledger, and there is no on-chain registration step, because registering an address would publish it.</p>
        <p>Addresses are diversified: from one incoming viewing key, the wallet derives a practically unlimited family of distinct addresses, one per 4-byte diversifier, all spendable by the same wallet and none linkable to each other by sight. Hand different addresses to different relationships and each counterparty can only ever recognize their own. One address for everyone is convenient; separate addresses reveal less. The wallet supports both, and the trade is yours.</p>
        <p>Sharing happens out of band, over a channel you already trust. Beside the QR code the wallet shows a short verification code derived from the address — the drawn panel below shows one, FC42 C9CF — and the sender&apos;s wallet derives the same code from whatever it is about to pay. Matching codes mean the address survived the copy intact.</p>
        <p>The receive screen also offers a reusable stealth address (<span style={{ fontFamily: "var(--mono)", fontSize: ".85em" }}>tsm1…</span>): a two-key meta-address, one scan key and one spend key, from which a sender derives a fresh one-time destination per payment. Only your scan key can link those destinations back together. It is the same discipline — publish nothing that connects your payments — applied to a different receiving pattern.</p></section>

        <section id="private-screens"><h2><DocFile />What it looks like</h2>
        <p>The surfaces below are drawn to the app&apos;s own geometry with representative values: the deal as the setup sheet states it, a shielded receive with its verification code, and a private send review. The real thing is release {APPLICATION_VERSION}, running against Stellar testnet, one click away.</p>
        <div className="panel-grid">
        <PanelDeal />
        <PanelReceive />
        <PanelSendReview />
        </div>
        <p className="cap-line">the deal, stated before you turn it on · a shielded receive · a private send review</p></section>

        <section id="private-recovery"><h2><DocCycle />Recovery</h2>
        <p>Your recovery phrase is enough, because every private key in this feature is derived from it deterministically, via HKDF, and bound to the specific deployment — the network, realm, and pool contract are hashed into the derivation, so testnet keys are not Mainnet keys and a key can never be replayed against the wrong pool. On a new device the wallet rederives the viewing key, walks the pool&apos;s public record page by page, trial-decrypts every envelope, and rebuilds the balance while verifying each commitment and nullifier against the chain. No server holds a copy of anything.</p>
        <p>Two caveats. Restoring can itself cost network fees, shown before you approve them. And the labels on payments you sent — which memo went to whom — live only in your encrypted local backup, not on the chain: the phrase recovers the money, the backup recovers the story. Export the backup.</p></section>

        <section id="private-trust"><h2><DocScales />What you must trust, and what you must not</h2>
        <p>A privacy claim is a trust claim. Here is exactly where this one rests.</p>
        <div className="two">
        <div className="col ok"><h3><DocCheck />You must trust</h3><ul>
        <li>Your device and browser. An unlocked wallet on a compromised machine has no defense, this feature included.</li>
        <li>The pool contract on Stellar. Independent review of the contract and circuit is a release gate for exactly this reason.</li>
        <li>The mathematics: Groth16 and its one-time trusted-setup ceremony — the multi-party ritual that creates the proof parameters, sound if even one participant was honest and the transcript is public.</li>
        </ul></div>
        <div className="col no"><h3><DocAlert />You must not trust</h3><ul>
        <li>Us. At runtime no StellarKey server sees a request, holds a key, or relays a payment.</li>
        <li>A hosted prover. Proofs are built on your device; anything else would break the claim they make.</li>
        <li>Obscurity. What stays public — fees, timing, deposits, withdrawals — is written on this page so you can plan around it.</li>
        </ul></div>
        </div>
        <p>The bar for Mainnet is written down and enforced in code: reproducible artifacts, a completed trusted-setup ceremony, independent contract and circuit review, immutable deployment evidence, and recovery drills, all tied to the same artifact hashes. Today the record reads: independent audit, not yet recorded; trusted setup, not yet recorded. The app shows you that same status table, because a privacy feature that grades its own homework would not deserve the name.</p></section>

        <section id="private-faq"><h2><DocQuestion />The awkward questions</h2>
        <div className="faq">
        <details><summary>Why is my deposit public?</summary><p>A deposit spends from your public Stellar account, and a public account cannot spend without the ledger recording the amount, the source, and the timing. What the ledger never learns is what happens next: the notes the deposit created, and every private transfer after them.</p></details>
        <details><summary>What does the fee account reveal?</summary><p>Every private send is submitted by a Stellar account that pays the network fee, and that account, its fee, and the moment it acted are public. An observer can tell that your account used the pool, and when — not the amount, the recipient, or the memo. If that link matters for your situation, it is a real consideration; we would rather name it here than have you discover it later.</p></details>
        <details><summary>How private is it, really?</summary><p>Contextual. A transfer among many transfers made by many independent people is hard to single out; the same transfer in a quiet week, between two accounts that always act within the same minute, invites guessing. Correlation through timing, repeated endpoints, address reuse, or a compromised browser remains possible. Privacy grows with more independent activity. It is context, not a guarantee, and we will not sell it as one.</p></details>
        <details><summary>Why testnet first?</summary><p>Because the evidence is not finished: the proof parameters need a completed public ceremony and the contract and circuit need independent review, and neither is recorded yet. Until both exist, the preview stays on a network where balances have no monetary value. Preview first, promotion after the evidence — that is an order we can defend.</p></details>
        <details><summary>What if I lose this device?</summary><p>The recovery phrase rebuilds the private balance on any device by rescanning the public record, exactly as the recovery section describes. Restoration can cost network fees, shown before you approve them, and the labels on sent payments live only in your encrypted backup — so keep one.</p></details>
        <details><summary>Can StellarKey see my private balance?</summary><p>No — the records are encrypted on your device, the proving happens on your device, and requests go directly to the Stellar RPC endpoint you configured. That endpoint&apos;s operator can see your IP address and request timing, so choose one you trust.</p></details>
        </div></section>
    </LegalPage>
  );
}
