# Private payments privacy audit

Reviewed 2026-09-04 at commit 23451f2. Scope: the current unified Testnet pool, Circom/Rust/TypeScript protocol, browser wallet, peer relay, recovery, and adjacent stealth-payment path.

This is a source audit and design assessment, not a formal cryptographic audit or a production deployment attestation. No live user data, keys, RPC traffic, or Nostr conversations were inspected. No source code was changed. Older reports describe retired deployments and were treated as historical context.

## Assessment

The largest remaining privacy gains are in how a payment reaches the chain, how its recipient is discovered, and how public/private wallet activity is combined. The current zero-knowledge statement already hides the internal asset, amount, input membership, and output roles from a passive chain observer under its cryptographic assumptions. Replacing Groth16 alone would not remove the observed leaks.

The most immediately actionable security finding is an unauthenticated Stellar account claim in relay offers. The largest architectural gap is that relay users still directly simulate their transactions and query their hashes through the sender's RPC connection. The most important cryptographic-format improvement is removing the clear address-derived diversifier.

The current default is direct submission: relay use is false in [preferences.ts](../src/features/private-balance/relay/preferences.ts#L17). The transaction source consequently identifies the sender's public account unless the sender explicitly selects a helper. Deposits and withdrawals necessarily expose their transparent legs under the current Stellar asset integration.

## What each observer can see

| Observer | Available information |
| --- | --- |
| Passive chain observer | Source account, action kind/time, proof, anchor, two nullifiers, three commitments and encrypted packages, clear action diversifier. Deposits/withdrawals also expose asset, value and endpoint. |
| Sender's RPC | Connection/IP, scan ranges, complete transaction sent for simulation, exact transaction hashes requested for confirmation. This also occurs with a helper source. |
| Public Nostr subscriber | Pool/network, requested action kind, ephemeral author/recipient graph, timestamps and ciphertext lengths. Discovery does not publish asset or payment amount. |
| Nostr operator | Public Nostr information plus connection/IP, subscriptions and connection lifetimes. |
| Selected helper | Payment asset, its fee, action diversifier, full transaction/proof and its own decrypted fee output. It does not thereby learn the internal payment amount or full recipient address. |
| Counterparty or person given a receive address | Their own payment details, and the address diversifier that can be matched against other public actions, subject to collisions. |
| Holder of compromised viewing material | Historical received notes or outgoing records within the compromised key's scope, even after local application history is deleted. |

These are capabilities of observers, not claims that particular service operators collect, retain or combine the information. IP correlation is not a cryptographic proof of a person's identity, especially behind shared networks.

## Prioritized findings

Effort: S = hours, M = several days, L = substantial implementation or research. Risk describes the proposed change. Confidence concerns the observed code; the effectiveness of research alternatives is assessed separately.

| Priority | Finding | Category | Impact | Effort | Change risk | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Authenticate a helper's claimed Stellar account before revealing selection metadata | Security defect | Prevents impersonation and avoidable metadata harvesting | M–L | Medium | High |
| 2 | Preserve privacy routing through crash recovery | Recovery/privacy gap | Prevents an unapproved direct network broadcast after restart | M | Medium | High |
| 3 | Protect simulation, confirmation and ordinary wallet traffic together | Architecture limitation | Removes direct RPC linkage between sender connection and relayed payment | L | High | High |
| 4 | Replace the clear recipient-derived diversifier | Documented protocol limitation | Removes a persistent public correlator for reused receive addresses | L | High | High |
| 5 | Support relayed consolidation | Product/protocol gap | Makes private submission usable with fragmented balances | L | High | High |
| 6 | Remove payment-specific public discovery metadata | Documented transport limitation | Reduces public session-graph and timing correlation | M–L | Medium–high | High |
| 7 | Coarsen recovery ranges and avoid account-linked archive restoration | Operational metadata | Limits wallet-birthday and recovery participation disclosure | M–L | Medium | High |
| 8 | Prevent rotation from repeating an older address | Allocation weakness | Avoids accidental address reuse at high address volumes | M–L | Medium | High |

### 1. Relay offers do not prove control of the account they display

[protocol.ts:234](../src/features/private-balance/relay/protocol.ts#L234) validates the syntax of the claimed peer account. [session.ts:151](../src/features/private-balance/relay/session.ts#L151) checks the Nostr signature and binds the quoted Nostr key to the event author, but does not authenticate the Stellar account claim. [session.ts:303](../src/features/private-balance/relay/session.ts#L303) groups offers by that claimed account and lets a cheaper offer replace an existing one. The interface renders its account mark at [PrivateRelayQuotePicker.tsx:60](../src/features/private-balance/components/PrivateRelayQuotePicker.tsx#L60).

When an offer is selected, [usePrivateActionController.ts:246](../src/features/private-balance/components/usePrivateActionController.ts#L246) extracts the recipient's diversifier and sends it with the asset index before transaction preparation or signing. A malicious responder can claim a recognizable helper account, underbid its legitimate offer, receive this metadata when selected, and then fail to sign. This does not let it forge the Stellar signature or steal the payment.

Require a domain-separated account authorization binding the Stellar source to the ephemeral relay identity, network/pool, scope and expiry. Verify it before relying on the account identity or disclosing selection metadata. Carry the authorization inside encrypted negotiation. A scoped session authorization can avoid a hardware-wallet prompt for every unsolicited quote; account signer/threshold semantics must be defined explicitly.

Verification should exercise forged account claims, cheaper replacement offers, expiry, request/session substitution and cross-network replay. Proof of account control prevents impersonation; it does not prove that two helpers have independent operators.

### 2. Restart can change the network route of a signed relay payment

The normal submission path uses helper callbacks at [provider.tsx:1758](../src/features/private-balance/runtime/provider.tsx#L1758) and [provider.tsx:1779](../src/features/private-balance/runtime/provider.tsx#L1779). On restart, [provider.tsx:738](../src/features/private-balance/runtime/provider.tsx#L738) passes all pending signed actions to the local RPC. [submission.ts:436](../src/features/private-balance/runtime/submission.ts#L436) rebroadcasts them without a stored route policy.

The transaction remains helper-sourced: this is not a switch to signing with the user's public account. It exposes the original helper-signed transaction through the sender's network connection. Direct simulation already exposes it to that RPC today, but this becomes a critical bypass once protected transport is introduced.

Persist an encrypted routing policy with each pending action. Recover by reconciling authenticated chain data over an allowed route, retaining note reservations while status is unknown. If rebroadcast is needed, use an allowed transport or request an explicit change of privacy policy. Do not store obsolete ephemeral message keys just to recreate a dead session.

Test crashes before/after the signature commit, possible prior broadcast, absent helpers, expired transactions, and route unavailability. No recovery path should silently relax the policy or release possibly spent notes.

### 3. A relay protects the chain source but not the sender's RPC connection

[action-flow.ts:629](../src/features/private-balance/runtime/action-flow.ts#L629) creates a direct RPC client for every preparation. [action-transaction.ts:51](../src/features/private-balance/runtime/action-transaction.ts#L51) reads the chosen source account, and line 60 sends the complete transaction for simulation. [provider.tsx:1818](../src/features/private-balance/runtime/provider.tsx#L1818) still monitors the result through the browser RPC; [submission.ts:57](../src/features/private-balance/runtime/submission.ts#L57) queries the exact transaction hash.

That operator can match the simulated action's public commitments/nullifiers to its later chain appearance without breaking encryption or cooperating with Nostr. Separately, [useWallet.tsx:937](../src/hooks/useWallet.tsx#L937) sends the public account to ordinary wallet APIs, while [useWallet.tsx:1199](../src/hooks/useWallet.tsx#L1199) and [useWallet.tsx:1264](../src/hooks/useWallet.tsx#L1264) keep public refreshes and account-specific streaming active whenever unlocked. Common operators or cooperating services can combine those observations.

History is an additional bypass: [stellar-endpoints.ts:153](../src/lib/stellar-endpoints.ts#L153) deliberately uses the fixed history service despite a custom operational endpoint. Stealth discovery calls it at [stealth-horizon.ts:218](../src/features/private-balance/runtime/stealth-horizon.ts#L218). This is current retention policy, not an accidental URL bug, but a strong privacy mode needs a different policy.

Create one transport boundary for account reads, proof-bearing simulation, registry/history reads, submission, confirmation, recovery and restoration. Account-specific public activity also needs isolation or suspension. Fetch common public archive segments and reconcile locally where possible, reducing transaction-specific lookups.

Two plausible transport directions are a tested Tor-capable client/companion for all relevant traffic, or independently operated oblivious ingress/gateway services for suitable HTTP requests. Ordinary website JavaScript cannot simply force Tor routing. Oblivious HTTP also requires compatible infrastructure; it is not a wrapper that an unchanged public RPC will accept. Its privacy depends on operator separation and does not defeat traffic analysis. [RFC 9458](https://www.rfc-editor.org/rfc/rfc9458.html#section-6.2.3) discusses padding, timing and relay-volume tradeoffs.

Moving simulation to the chosen helper is a narrower option. The wallet must still validate the exact proof-bound operation, source, resource/fee limits and simulation-derived envelope, and authenticate chain evidence independently. It shifts observation to the helper rather than removing all observation.

### 4. Clear diversifiers enable address-to-action matching

[encryption.ts:225](../protocol/private-balance/packages/browser/src/encryption.ts#L225) puts the four-byte diversifier in plaintext. [action-builder.ts:585](../src/features/private-balance/worker/action-builder.ts#L585) chooses it from the transfer recipient's address and uses it across all three outputs.

The matched headers correctly conceal which lane is recipient/change/fee/dummy. They still expose an address-derived value on the whole action. A party given a relatively uncommon rotated address can search for other actions bearing the same value. Collisions and shared default values prevent treating this as certain attribution; a common zero diversifier does not identify one wallet.

Use a versioned diversified key-agreement design in which the scanner can compute the shared secret before learning the diversifier, then recover and authenticate that diversifier inside ciphertext. Orchard's key design is an established reference, including its prime-order group and wider diversifiers; its primitives are not a drop-in replacement for the current HPKE scheme. [Orchard keys and addresses](https://zcash.github.io/orchard/design/keys.html).

The current decoder first needs the clear diversifier at [encryption.ts:263](../protocol/private-balance/packages/browser/src/encryption.ts#L263). Deleting those bytes breaks recovery. Replacing diversified keys with one public scanning key makes different addresses linkable off-chain. Widening the clear field alone makes its public matching more precise.

The repository's earlier research already measured a slower JavaScript Ristretto prototype. Reuse that evidence as a screening result, then require a complete KEM/KDF/AEAD/validation specification, key-privacy and malformed-point review, cross-language vectors, seed recovery across historical addresses, and physical-phone scan/memory measurements. Freeze the address/envelope/circuit consequences together before new deployment evidence or ceremony work.

### 5. Fragmented balances cannot complete the existing relay send path

[usePrivateActionController.ts:180](../src/features/private-balance/components/usePrivateActionController.ts#L180) offers chained consolidation only in direct mode. [provider.tsx:2032](../src/features/private-balance/runtime/provider.tsx#L2032) prepares and submits its steps without relay callbacks. [chained-send.ts:153](../src/features/private-balance/runtime/chained-send.ts#L153) proceeds to the next action after confirmation.

This does not silently downgrade a relay send. It means users with balances requiring more than two inputs lack the corresponding relayed workflow. Choosing direct submission creates a series of transactions under their public account; the immediate sequence adds behavioral evidence.

Extend relay fee approval, quoting and route-preserving recovery across consolidation first. Then benchmark a larger fixed input shape to reduce consolidation demand. Do not make the public input count vary with the actual number of notes. Preserve cumulative fee limits and conservative handling of ambiguous actions.

One circuit authority currently controls all inputs at [action.circom:49](../protocol/private-balance/circuits/circom/action.circom#L49). Collaborative settlement across users therefore requires authorization redesign, not just assembling other people's notes into one witness.

### 6. Discovery broadcasts when and how someone intends to pay

[session.ts:262](../src/features/private-balance/relay/session.ts#L262) constructs a plaintext request containing pool, network and transfer/withdrawal kind. [session.ts:106](../src/features/private-balance/relay/session.ts#L106) publishes a recognizable topic, recipient tag and current timestamp outside payload encryption. [nostr.ts:45](../src/features/private-balance/relay/nostr.ts#L45) sends the event to the configured relay origins.

The request does not disclose the asset. Subsequent encryption does not hide the author/recipient pseudonym graph, timing or message lengths. Two relay origins improve availability and expose the traffic to two operators; this is not an anonymity mechanism.

Compare common helper advertisements/directories with sender-specific broadcast requests. Fetch the same directory for many clients, negotiate with one-time job keys, remove unnecessary discovery fields, and use padded message classes. Evaluate a reviewed protocol for forward-secret job sessions, with optional batching/delay when users accept the latency. Discovery and job encryption identities should have separate lifetimes.

NIP-44 explicitly lacks forward secrecy and metadata hiding. Per-action sender keys already reduce exposure, but retaining a helper session key lets later compromise expose captured earlier conversations under that key. [NIP-44 limitations](https://github.com/nostr-protocol/nips/blob/master/44.md#limitations).

Cheap or numerous helpers may all belong to one adversary. Account attestations, limits or bonds can raise abuse costs but cannot establish an honest fraction. Model hostile helper selection explicitly; do not equate the number of offers with anonymity.

### 7. Recovery reveals participation; a latent reader accepts precise scan boundaries

Correction during implementation (2026-09-04): the original audit overstated the active birthday leak. Although `stealth-runtime.ts` passes wallet creation time and `stealth-horizon.ts` implements a timestamp binary search, `createEmptyStealthDiscoveryCache` deliberately replaces the bound with zero. Existing runtime and sync tests confirm that new-wallet/seed-recovery requests scan all retained history. The exact-boundary search was a latent reader/legacy-caller risk, not a demonstrated new-wallet disclosure. The hardening branch removes the search and normalizes old cached bounds without changing durable forward cursors.

Keep the common retained-history floor. If future optimizations introduce bounded recovery, use shared coarse epochs rounded earlier with overlap. Never round forward and skip recoverable payments. Verify that different birthdays produce identical initial request targets.

Separately, [provider.tsx:1233](../src/features/private-balance/runtime/provider.tsx#L1233) restores expired shared archive data using the user's public account as source. The restoration footprint reveals the public interval being restored. It establishes participation and recovery activity, not ownership of every note in that interval.

Consider permissionless keepers, independently funded sponsors, and authenticated mirrors of complete public archive epochs. Preserve local transcript/root validation and an independently verifiable chain head. Sponsors should restore common ranges rather than records selected by note ownership. Any fee-compensation design must be assessed for its own correlation leaks.

### 8. Address rotation can revisit an older address

[private-balance.worker.ts:170](../src/features/private-balance/worker/private-balance.worker.ts#L170) draws four random bytes and excludes only the currently selected value. Deterministic address derivation therefore recreates the same wallet address on a historical collision.

For roughly uniform 32-bit draws, the birthday approximation gives about a 1.16% chance of a collision by 10,000 generated addresses and about 50% around 77,000. This is mostly relevant to high-volume recipients or future automated invoice generation.

Use a persistent authenticated allocation scheme with an explicit multiple-device/restoration model. A counter with a keyed permutation can avoid repeats within a coordinated allocator, but rollback and concurrent devices still need design. A future encrypted diversifier should be wider. Do not sell a wider clear correlator as a privacy improvement.

## Larger design options

These are research directions, not defects with a predetermined fix.

### A. Hide the payment asset from the helper by changing how fees work

The encrypted selection discloses the asset at [session.ts:351](../src/features/private-balance/relay/session.ts#L351). The fee is an output in that same asset at [action-builder.ts:617](../src/features/private-balance/worker/action-builder.ts#L617). The helper necessarily learns the payment asset by receiving its fee, even though the public chain does not.

Compare independently funded/subsidized submission, unlinkable prepaid service vouchers, or a universal fee asset separate from the payment asset. The last option needs correct multi-asset conservation and enough fixed input/output capacity for both assets and change; the current same-asset circuit cannot do it. Vouchers need purchase/redemption unlinkability, double-redemption protection and an explicit withholding/refund model. These alternatives are L effort with high economic/cryptographic risk.

This is worth reopening if hiding the asset from the selected helper is a product requirement. Merely encrypting today's fee more strongly cannot satisfy that requirement.

### B. Introduce a slower privacy policy for anchors, bursts and exits

[action-flow.ts:503](../src/features/private-balance/runtime/action-flow.ts#L503) always uses the current root. [archive.rs:18](../protocol/private-balance/contracts/pool/src/archive.rs#L18) exposes ledger, anchor and resulting root, so an observer can identify the snapshot used for proving and exclude later notes. This does not reveal the spent leaf.

Evaluate common sufficiently mature epoch roots, avoiding note-by-note timing choices, and scheduled consolidation or submission windows with explicit latency budgets. Arbitrarily choosing older roots can shrink the candidate set and create a distinctive fingerprint. Evidence for practical correlation strength remains to be measured.

Transparent deposits/withdrawals expose their asset, value and endpoint by contract design at [contract.rs:189](../protocol/private-balance/contracts/pool/src/contract.rs#L189). Encourage sustained shielded balances and shielded merchant/invoice flows so ordinary payments do not immediately cross the transparent boundary. Shared exit processing can obscure relationships but cannot make ordinary public Stellar transfers confidential.

The stealth subsystem creates and funds a visible one-time account at [stealth-transaction.ts:115](../src/features/private-balance/runtime/stealth-transaction.ts#L115). It can hide the association to a reusable receive identity; it does not hide the public payment amount, source, or its later transparent movements. It should not substitute for shielded-to-shielded payments when those are available.

Empirical Zcash research demonstrates why boundary behavior matters despite cryptographic shielding; it is context, not a measured anonymity result for this deployment. [Kappos et al., USENIX Security 2018](https://www.usenix.org/conference/usenixsecurity18/presentation/kappos).

### C. Offer less historical recoverability in exchange for less retrospective exposure

[keys.ts:294](../protocol/private-balance/packages/browser/src/keys.ts#L294) derives stable deployment/account viewing material. [action-builder.ts:322](../src/features/private-balance/worker/action-builder.ts#L322) archives outgoing value, recipient key, diversifier, asset and memo under the outgoing viewing key. Local deletion cannot remove those ciphertexts from historical copies.

Provide an explicit option to omit recoverable outgoing metadata, replacing its envelope with indistinguishable fixed-size random data, and define exactly which history then depends on a separate backup. Separate incoming, outgoing and spend-status capabilities and support narrowly scoped disclosure.

A stronger evolving-key design can limit compromise of a current online key, with careful erasure and backup rules. It cannot promise protection from compromise of a static recovery seed while also promising that the same seed and public chain recover all historical plaintext. This is an inherent policy choice. HPKE does not provide forward secrecy against later recipient-key compromise. [RFC 9180 section 9.7.4](https://www.rfc-editor.org/rfc/rfc9180.html#section-9.7.4).

Optional outgoing recovery is M effort; robust evolving-key recovery is L/high risk. Neither hides information already known to counterparties.

### D. Evaluate shared settlement infrastructure and a stronger client boundary

The repository currently prioritizes having no operated backend, relayer or indexer; that constraint appears in [ADR 0009](../protocol/private-balance/docs/decisions/0009-browser-peer-relay.md). Since the brief opens architectural choices, reconsider it. Shared infrastructure can hold only public authenticated history and opaque encrypted jobs while witnesses remain local.

A target design could combine independently operated ingress/egress, common history epochs, authenticated relay identities, hidden-diversifier notes, and fixed-shape batched settlement. An independently packaged client can provide clearer network-route control than a general browser origin. This introduces service availability, client distribution, censorship and operator-collusion assumptions that must be specified.

Batching proofs alone does not establish participant anonymity. The current shared input authority prevents a simple multi-owner join. A rollup or alternate execution layer is worth a bounded benchmark only if independently hidden jobs, adequate traffic, verifiable data availability and acceptable withdrawal behavior can be demonstrated. Treat this as L/high-risk research, after fixing the identified metadata paths.

## Privacy verification to add

The current correctness tests are useful, but they do not constitute an adversarial observation test.

Build a synthetic, offline observer harness with in-memory adapters for the chain, RPC, Nostr operator, selected helper and colluding observers. Use artificial wallets and inputs only; never collect production private addresses, values, note material or transaction hashes for analytics.

The harness should verify:

1. A false Stellar account claim cannot win authenticated presentation or receive selection metadata.
2. An action's selected transport policy survives restart, retry, expiry and ambiguous submission.
3. Protected mode sends no transaction-specific simulation/status request or account-identifying background request outside its allowed routes.
4. Matching public history with different ownership produces the same public request targets and approved scheduling pattern.
5. Common recovery epochs conceal exact birthdays without skipping notes.
6. The next envelope format lacks an address-derived clear correlator and preserves recovery and lane indistinguishability.
7. Fragmentation/consolidation can complete without requiring a public sender source.
8. Fee-asset designs hide the payment asset from every observer for whom that privacy is claimed.

One unresolved side-channel hypothesis deserves a controlled measurement: [sync-machine.ts:424](../src/features/private-balance/runtime/sync-machine.ts#L424) waits for scanning and encrypted state commits before requesting the next page; [scanner.ts:279](../src/features/private-balance/runtime/scanner.ts#L279) exits its candidate-asset loop upon a match. Owned/unowned pages can therefore have different processing times. No practical remote ownership classifier was demonstrated. Test with synthetic equal public histories, randomized network jitter and physical browsers before assigning severity or changing the implementation.

Report adversary-specific inference success, false positives, latency, bandwidth, fees and recovery correctness. A tree's leaves include dummy outputs and adversary-owned notes. Shared assets, high transaction counts and nominal pool size are not measurements of independent-user anonymity.

## What to preserve; ideas considered and rejected

- Internal transfers already hide the asset in the public statement; a second proposal to unify the assets would duplicate completed work.
- Fixed two-input/three-output shape, randomized lanes and matched diversifiers already address basic lane-role fingerprints.
- The sender cannot compute a recipient's later nullifier merely from its known note plaintext: [nullifier.circom:15](../protocol/private-balance/circuits/circom/nullifier.circom#L15) also requires the recipient's nullifier secret.
- Shielded scanning fetches all sequential records at [sync-machine.ts:414](../src/features/private-balance/runtime/sync-machine.ts#L414) and resolves ownership/spends locally at [scanner.ts:206](../src/features/private-balance/runtime/scanner.ts#L206). Keep this property. No owned-note-specific nullifier RPC was found.
- Ledger timestamps are fetched for all records at [sync-machine.ts:440](../src/features/private-balance/runtime/sync-machine.ts#L440), not just recovered private activity.
- Do not remove independent chain corroboration to reduce endpoint count without supplying a replacement authenticity model.
- Do not remove clear diversifiers without replacing the key-agreement/recovery design.
- Do not use one static public scanning key as the unqualified solution to address privacy.
- Fresh gas accounts funded from a known account and fee bumps do not remove the public source/funding relationship.
- Extra self-transfers and zero-value cover actions do not manufacture independent honest participants.
- A different proof system or a trusted-setup ceremony does not by itself solve metadata correlation. A production ceremony and independent circuit/contract review remain separate release requirements.
- No theft, balance forgery or recipient-spend tracing exploit was established in this privacy-focused review. That is not a comprehensive proof of soundness.

## Verification performed and limits

The main reviewer ran these source-preserving offline commands:

~~~sh
node --no-warnings --test --test-force-exit protocol/private-balance/packages/browser/test/protocol-v1.test.mjs protocol/private-balance/packages/browser/test/multiasset.test.mjs protocol/private-balance/packages/browser/test/vectors.test.mjs
node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/private-balance-redaction.test.mjs tests/private-balance-relay-protocol.test.mjs tests/private-balance-coin-selection.test.mjs tests/private-balance-scanner.test.mjs tests/private-balance-action-builder.test.mjs
~~~

Results: 25/25 protocol tests and 19/19 runtime/relay tests passed. The protocol command tested the checked-in browser distribution without invoking its build/pretest step. Two independent reviewers also reported passing focused sets of 31 and 24 tests; these overlap the main set and must not be summed as unique coverage.

The audit did not rerun full Rust/circuit mutation/underconstraint gates, a complete release verification, dependency audit, live deployment checks, third-party service probes, browser packet captures, physical-phone benchmarks or human accessibility checks. It did not inspect unrelated merchant/public-wallet functionality beyond relevant background network paths. Passing focused tests does not quantify anonymity or replace independent cryptographic review.

## Recommended order

First establish the synthetic observer tests and authenticate relay account claims. Persist and enforce route policy before adding protected transport. Next protect the complete network lifecycle, remove history/public-account bypasses and make consolidation relay-capable.

Start the hidden-diversifier specification and recovery benchmark alongside those engineering changes; it has the longest independent-review lead time. Follow with discovery/session metadata minimization and common recovery infrastructure. Evaluate separate fee assets, optional outgoing recovery and shared settlement as distinct design decisions with measured tradeoffs.

For implementation, follow AGENTS.md: read relevant bundled Next.js guides before code changes; update CHANGELOG.md for security, behavior or stored-data changes; preserve overlay interaction invariants; run focused tests. Protocol changes require coordinated specification, vectors, artifacts and deployment evidence. Run the complete release verification from a clean worktree before any release.
