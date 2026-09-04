# Next Private Payments format: migration contract

Status: review draft, 2026-09-04. No suite identifier is assigned, no enabled
runtime implements this document, and no replacement pool is deployed. This is
the implementation boundary for the audit's format and infrastructure proposals,
not a claim that the current protocol has hidden diversifiers or IP anonymity.

## 1. Required privacy properties

The next recipient envelope must support all of these together:

- A scanner with seed-derived incoming viewing material can try an output before
  learning its address diversifier, without enumerating previously issued addresses.
- No stable address-derived diversifier, public scanning key, owner identifier,
  asset selector, output role or outgoing-history preference appears in its header.
- Different receive addresses must not expose one shared public scanning key.
- Recipient, change, helper-fee and dummy lanes retain identical wire shape.
- Recipient and outgoing data remain bound to the exact note commitment, action,
  network, deployment, suite and format version. Moving a ciphertext between these
  contexts must not produce an accepted note.
- A malicious ciphertext is an ordinary failed trial, never a reason to lose an
  authenticated archive cursor or make a note-specific network request.

These are adversary-specific targets. They do not hide transparent deposits or
withdrawals, timing, a helper's same-asset fee, colluding transport operators, or
data already learned by a counterparty.

## 2. Version and cryptographic freeze

Use a new manifest-bound address/envelope version and a separate seed-derivation
domain. Never reinterpret a v1 address or encrypted record using the next suite.
Unknown versions must fail closed; decoding failure must not trigger v1 fallback.
Reserve a wider, initially proposed 128-bit, **encrypted** diversifier. Its width
and every plaintext/header length must be frozen with the chosen suite, rather
than patched independently into the current four-byte format.

The candidate architecture is diversified group key agreement: derive a group
base from the address diversifier, multiply it by the incoming viewing scalar
for the public address key, and let trial decryption multiply the transmitted
ephemeral group element by that scalar. This removes the current circular
dependency on clear diversifier bytes. It follows the architecture discussed in
the [Orchard key design](https://zcash.github.io/orchard/design/keys.html), but that
does not establish the security of a custom adaptation.

Do not label a bespoke diversified-group construction “RFC 9180 X25519 HPKE.”
The existing Ristretto screening prototype is not a suite specification.
[RFC 9496](https://www.rfc-editor.org/rfc/rfc9496.html) supplies group encodings,
operations and invalid-encoding vectors; it does not specify this wallet's KEM,
key schedule, note commitments or recovery policy.

Before code can enter an enabled path, independent review must freeze:

1. The exact group, hash-to-group domain/encoding, scalar derivation and sampling,
   canonical point/scalar parsing, identity rejection, and seed-derivation labels.
2. The ephemeral-key generation and validation rules, including sender randomness,
   retransmission behavior, key privacy, contributory behavior and chosen-ciphertext
   analysis. Do not assume a randomly generated ephemeral key alone proves these.
3. Byte-exact KEM transcript, KDF labels, suite binding, AEAD, nonces, view tags,
   associated-data encoding and all endian/length rules. No JSON or implicit
   concatenation is permitted in cryptographic transcript encodings.
4. The order of note validation: authenticated decryption, canonical decoding,
   recovered diversifier/address checks, registered asset binding, ownership,
   commitment recomputation and spend-status classification. The complete
   dependency graph must avoid needing a hidden field before deriving its key.
5. Circuit/public-action/archive binding for every encrypted package, fixed arity,
   dummy rules, value bounds, conservation and historical asset-registry indices.

This document deliberately does not invent missing byte constants or claim an
unreviewed KEM secure. The exact suite specification is a required deliverable
from that review, not a task an implementation agent should fill by guesswork.

## 3. Compatibility and migration

Maintain separate pinned manifests, codecs and encrypted storage namespaces for
the current and next deployments. Existing notes and backups remain readable;
their recovery uses the suite that originally encrypted them. The current
immutable pool must remain available for spending existing notes while migration
is supported. A client upgrade must not silently retire it or discard its state.

Seed-only recovery must scan the same authenticated public archive ranges for
every supported deployment and recover notes sent to unused, old, rotated and
independently generated addresses. An issuance history is an allocation safeguard,
not a substitute for seed-only note recovery. The current encrypted local history
cannot recover unused addresses that were never backed up or recorded on-chain.

The default migration mechanism is not presumed private. A v1 withdrawal followed
by a next-pool deposit exposes both transparent boundaries and possible timing and
amount linkage. Any shielded cross-pool migration requires a separately reviewed
proof of old-note spend/nullifier consumption and new-note conservation. Never
present an ordinary exit/re-entry sequence as an unlinkable conversion.

Freeze in one coordinated change: address bytes and test vectors, note plaintext,
recipient/outgoing envelope sizes, worker/backend codecs, circuit statement,
contract/archive layout, generated clients, browser scanner, backup semantics and
manifest validation. After the R1CS is final, regenerate and bind all proving and
verification artifacts. A production ceremony and deployment require their own
authorization and evidence; none was performed by this client hardening.

## 4. Acceptance evidence

The implementation gate requires:

- Cross-language Rust/browser vectors for derivation, address encode/decode,
  encapsulation, decryption, commitment and seed recovery, including malformed
  points, noncanonical scalars, identity elements, truncation and unknown versions.
- Mutation tests for every authenticated context field and circuit relation,
  differential tests against the frozen reference, and independent underconstraint
  review. Positive round trips alone are insufficient.
- Synthetic observer tests showing no stable clear address correlator or lane-role
  classifier, with negative controls demonstrating that the harness detects v1's
  repeated diversifier. Never collect real note material as analytics.
- Recovery tests spanning both deployments, restoration, interrupted sync, changed
  registry state, duplicate public records, corrupt mirrors and lost local caches.
- Physical iPhone and Android p50/p95 scan/prove latency and peak memory, compared
  against the existing native-X25519 path on equal public histories. The existing
  desktop prototype timing is only screening evidence.
- A reproducible artifact manifest, final independent review report and a rollback
  plan that preserves both historical reading and current note reservations.

## 5. Transport and fee separation are different workstreams

A strong network-private mode needs one enforced transport policy for account
reads, public-wallet refreshes/streams, proof preparation, archives, restoration,
submission and recovery. Ordinary unlocked public-account requests cannot bypass
that policy. The client must fail closed if its route is unavailable, with an
explicit user choice before returning to ordinary direct networking.

Two possible deployments need real operational ownership: a Tor-capable packaged
client/companion, or independently operated oblivious ingress and compatible
gateway services. Specify bootstrap, DNS, credentials, logging, operator
separation, retention, abuse controls, padding, traffic-volume assumptions and
outage behavior before enabling either. A static browser cannot create these
services or force all its traffic through Tor by changing an RPC URL.

A common helper directory should publish account-authenticated, expiring
advertisements independent of sender payment intent. Clients fetch common epochs;
one-time encrypted job keys perform fresh negotiation. Do not embed stable
per-wallet identifiers, payment-specific directory queries or a directory access
token reused at redemption. Forward-secret job sessions need a reviewed handshake
and key-erasure model rather than a claim that NIP-44 already supplies them.

Keepers or sponsors restoring public archive epochs must use ownership-independent
ranges, preserve local transcript/root verification and independently corroborated
chain heads, and have explicit funding and compensation rules. No sponsor should
receive viewing keys or a list of wallet-owned notes.

Finally, hiding the asset from the selected helper cannot be achieved while its
fee is a note in that asset. A separate shielded fee asset changes conservation
and fixed input/output capacity; unlinkable vouchers introduce purchase/redemption,
double-redemption, withholding and refund rules. Each needs a separate reviewed
economic and cryptographic design. None is enabled by removing a selection field.

## 6. Outgoing-history choice

Any optional omission of future outgoing recovery data must be explicit, keep the
same ciphertext shape, and explain what seed recovery loses. Incoming ownership
and nullifier/spend recovery must remain complete. Test fee-bearing sends,
self-transfers, withdrawals and ambiguous recovery without misclassifying a spent
input as incoming value. Existing archived outgoing ciphertexts are not erased by
local deletion or a new preference.

Do not promise both complete historical plaintext recovery from one static seed
and protection of that plaintext after the same seed is compromised. Standard
HPKE likewise does not provide forward secrecy against later recipient-key
compromise; see [RFC 9180 section 9.7.4](https://www.rfc-editor.org/rfc/rfc9180.html#section-9.7.4).

## 7. Proof disclosure is spend authorization

The current transfer/withdraw proof is not bound to a transaction envelope's
source, fee, signature or maximum time. A party receiving it can put the same
operation in a new envelope. The current root can also be refreshed, so its
previously reported expiry is not an immutable proof deadline. Manual helper
signing is a local helper policy, not protection against a dishonest helper.

Before any proof-bearing simulation or helper message, the client must obtain
explicit consent to the exact spend intent and its private fee, and durably reserve
its inputs as externally exposed. Cancelling preparation or seeing an expired or
failed envelope cannot revoke that proof. Canonical inclusion or consumed
nullifiers resolve spend state; otherwise a release needs independent evidence
that the anchor is permanently unusable, not merely an old expiry estimate.
Seed-only recovery cannot reconstruct a proof-disclosure journal for an action
that never appeared on-chain. Backup/restore and recovery disclosures must state
this limit; a reset must not be described as revoking earlier spend authority.

A next-format action should bind an explicit finite execution deadline into the
proof/public-action statement and enforce it in the contract, including replay,
fee-bump, rewrap and permissionless-root-refresh tests. Any submitter restriction
or revocation mechanism needs separate authorization and privacy analysis. Do
not equate an envelope maxTime with a proof-bound deadline in the migration.
