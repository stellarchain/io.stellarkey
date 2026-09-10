# Hidden Diversifiers and a Unified Asset-Private Pool

> Historical record: peer relaying and helper earnings were removed on 2026-09-10.
> Relay instructions, measurements, and proposals below are not current functionality.
> See [the current whitepaper](private-balance.md) for direct submission and legacy recovery.

**Date:** 2026-09-04

**Status:** Research complete; the lane-role mitigation and governed
asset-private pool are implemented in the Testnet development deployment

**Scope:** Proposal 3 (remove cleartext diversifiers) and proposal 7 (unified
multi-asset pool)

The measurements supporting this note are preserved in
[`privacy-design-research-2026-09-04.json`](../protocol/private-balance/spikes/results/privacy-design-research-2026-09-04.json).

## Decision summary

| Proposal | Decision | Reason |
| --- | --- | --- |
| Delete the four clear diversifier bytes | Reject | The scanner needs those bytes to derive the current diversified X25519 key before it can decrypt the note. Deleting them makes recovery circular. |
| Match every lane's clear diversifier | Implemented | All three output lanes use one action diversifier. This removes the observed output-role fingerprint without hiding repeat use of a receive address. |
| Replace X25519 HPKE with diversified key agreement | Continue as a separately reviewed cryptographic change | It can hide the diversifier and preserve seed-only scanning, but it replaces the current standard HPKE construction and was materially slower in the screening benchmark. |
| Shared tree while the asset remains public | Reject | It combines operational failure domains without providing meaningful cross-asset privacy. This remains the correct conclusion of ADR 0003. |
| One asset-private pool | Implemented with governed admission | The deployed Testnet replacement uses an append-only administrator-controlled registry with `Active` and `ExitOnly` states. Internal registered-asset transfers share one action set; transparent boundaries still reveal their asset. |

The two protocol changes were not coupled. Asset-private transfers use the
reviewed current envelope, while full diversifier hiding remains deferred. The
implemented registry deliberately supersedes this note's earlier immutable
two-asset recommendation: entries can be admitted or moved to `ExitOnly`, but
historical indices can never be deleted, replaced, or reindexed.

## 1. Cleartext diversifiers

### What the current construction actually does

The 181-byte recipient envelope is:

```text
1-byte view tag || 4-byte diversifier || 32-byte ephemeral X25519 key ||
144-byte authenticated ciphertext
```

The receiver performs these operations in order:

1. Read the clear diversifier.
2. Derive a child X25519 private/public key from the incoming viewing key and
   that diversifier.
3. Perform X25519 key agreement with the ephemeral public key.
4. Check the view tag and decrypt the note.
5. Check that the decrypted diversifier, owner commitment, and note commitment
   agree with the public record.

The note plaintext also contains the diversifier, but that does not make the
clear copy redundant: the scanner cannot reach the plaintext until it has used
the clear copy to derive the decryption key. The proposed 181-to-177-byte edit
therefore breaks normal scanning and seed-only recovery.

This follows directly from
`packages/browser/src/encryption.ts::openRecipientEnvelope` and
`packages/browser/src/keys.ts::deriveDiversifiedScanningKeys`.

### The measured leak is output-role classification

New StellarKey private accounts start with diversifier `00000000`. Change and
dummy outputs deliberately use random nonzero diversifiers. The live testnet
archive at ledger 4,490,577 contained:

| Pool | Actions | Internal transfers | Transfers with exactly one zero-diversifier output |
| --- | ---: | ---: | ---: |
| XLM | 36 | 8 | 8 |
| USDC | 3 | 2 | 2 |

All ten observed private transfers therefore disclosed which encrypted lane was
the recipient and which was change or padding. The observer still did not learn
the recipient identity or amount, and `00000000` is shared by default addresses,
so the zero value does not by itself identify one wallet. It does weaken the
intended output-role hiding.

A rotated random diversifier has the opposite tradeoff: it no longer looks like
the common default, but repeated payments to that exact address expose the same
four-byte value and can be clustered. Four random bytes also have a birthday
collision probability of about 1.16% after 10,000 generated addresses and 68.8%
after 100,000, so a future redesigned format should use a wider diversifier.

### Approaches evaluated

#### A. Delete the field and enumerate known addresses — reject

Trying every previously issued diversifier for every output changes scanning to
work proportional to `history × address count`. At the time of the experiment,
StellarKey persisted only the active receive address. Historical rotated
diversifiers remain recoverable precisely because each envelope carries its
diversifier. Enumeration would make seed-only recovery incomplete unless the
wallet introduced another backed-up address index or list.

Implementation note, 2026-09-04: the client hardening now keeps a bounded encrypted
local issuance history to reject accidental reuse. This is not a seed-complete
list of unused addresses and does not change the rejection of enumeration-based
recovery. See the [next-format migration contract](private-payments-next-format-migration.md)
for the separate reviewed suite and compatibility gates.

#### B. Use one static X25519 scanning key — reject for the privacy target

This would retain native RFC 9180 HPKE speed and allow the diversifier to stay
inside the ciphertext. However, every private address would expose the same
X25519 public key. Anyone who sees two addresses could link them to the same
wallet even if the chain could not. It trades an on-chain leak for an off-chain
address-linkability regression.

#### C. Give every lane the same clear diversifier — implemented mitigation

For a transfer, derive the change or dummy output using the recipient's
diversifier. For deposits and withdrawals, choose one action diversifier and use
it for every output lane. Distinct wallets using the same diversifier still derive
different owner and encryption keys because their account key material differs.

This makes all output headers identical in shape and directly closes the lane
classification observed above. It preserves standard X25519 HPKE, encrypted
storage, and seed-only recovery. Reusing a rotated recipient address would still
cluster whole actions carrying that diversifier, so this is a mitigation rather
than the final hidden-diversifier design.

#### D. Diversified group key agreement — cryptographically plausible, not ready

Sapling and Orchard solve the circularity with a different key structure. In
simplified form:

```text
g_d = DiversifyHash(d)
pk_d = [ivk] g_d
epk = [esk] g_d
sender shared secret = [esk] pk_d
receiver shared secret = [ivk] epk
```

The receiver derives the shared secret from its incoming viewing scalar and the
ephemeral key; it does not need `d` first. After decryption it recovers `d` from
the note and validates the address and commitment. This is why Zcash can omit a
clear diversifier from its transmitted note ciphertext. Orchard uses a
prime-order group and 11-byte diversifiers. RFC 9496's Ristretto255 group and
RFC 9380's hash-to-curve guidance provide standardized building blocks for a
similar construction, but RFC 9180 does not define this as its X25519 DHKEM.

A disposable Ristretto255/AES-GCM feasibility prototype produced a 177-byte
envelope, round-tripped successfully, and produced different ephemeral keys and
ciphertexts for two payments to the same address. It is not a proposed
production specification or an audit result.

On an Apple M3 Max under Node 26.7, with 2,000 outputs per run and one warm-up:

| Operation | Median | Per output/address |
| --- | ---: | ---: |
| Current diversified-key derivation plus native X25519 scan | 329.13 ms | 164.57 µs |
| Ristretto255 variable-base scan prototype | 1,442.91 ms | 721.46 µs |
| Current X25519 address generation | 234.41 ms | 117.21 µs |
| Ristretto255 hash-to-group plus address multiplication | 1,728.97 ms | 864.48 µs |

The prototype scan was about 4.4 times slower and address generation about 7.4
times slower. This compares native X25519 with JavaScript Ristretto255, so it is
a screening result rather than a final implementation benchmark. A reviewed
Rust/Wasm implementation with batched trial decryption may narrow the gap.

### Gate for a fully hidden diversifier

Do not replace the current HPKE construction until all of these are complete:

- a written key-agreement, KDF, view-tag, AEAD, validation, and domain-separation
  specification based closely on a deployed construction;
- independent cryptographic review, including invalid-point, identity,
  contributory-behaviour, key-privacy, and side-channel analysis;
- deterministic cross-language vectors and malformed-input tests;
- proof that all historical addresses remain recoverable from seed and chain
  data without an address list or hosted service;
- batched browser implementation with physical-phone p50/p95 scan latency and
  peak-memory measurements;
- a decision on a wider diversifier and private-address encoding.

## 2. Unified asset-private XLM/USDC pool

### Why this is not the design rejected by ADR 0003

ADR 0003 correctly rejected sharing a tree while publishing the asset for every
action. The researched design hides the asset for internal transfers. This
changes the privacy result: an internal XLM transfer and an internal USDC
transfer can use the same contract, action shape, public asset sentinel, tree,
and archive layout.

Penumbra deploys a single multi-asset shielded pool whose notes contain typed
quantities but whose chain data contains opaque note commitments. Namada's MASP
likewise places the asset type in the note and note commitment, and explicitly
notes that shielded-to-shielded activity does not transact that asset from the
transparent ledger's perspective. Both demonstrate that the architecture is
established rather than novel.

### Historical narrow architecture screened

The following was the deliberately narrow candidate measured before
implementation. It is retained to explain the experiment, not to describe the
shipped contract. The later governed-registry requirement and ADR 0008 replaced
its immutable two-asset allowlist while preserving its private-transfer asset
sentinel and same-asset conservation model.

Use one new immutable pool for exactly the supported testnet XLM and USDC SACs.
Do not add a mutable guardian-curated token registry or arbitrary-asset entry
point.

- Bind the ordered XLM/USDC allowlist into the deployment context and manifest.
- Keep one commitment tree, archive transcript, root window, and private
  address namespace.
- Put a compact immutable asset index in both the recipient note plaintext and
  the sender-recoverable outgoing plaintext. Each currently has 15 reserved
  bytes, so this does not need to grow either ciphertext.
- Continue binding the full 32-byte asset field into every note commitment.
- Use one private `actionAssetField` for every real input and output in an
  action. This intentionally allows only one asset per action; it is not a swap
  or multi-asset conversion circuit.
- For deposits and withdrawals, publish and bind the selected asset because the
  SAC invocation, amount, and transparent endpoint are public anyway.
- For internal transfers, publish a constant zero asset sentinel and invoke no
  SAC. Omit the asset from the transfer archive record.
- Derive outgoing-envelope authenticated data from that public sentinel for
  internal transfers, not from the hidden asset. Otherwise outgoing recovery
  would need the asset before it could decrypt the asset. After decryption, map
  the encrypted index to the immutable asset field and authenticate/classify the
  recovered activity locally.
- Change the scanner to learn an internal transfer's asset from a successfully
  decrypted recipient or outgoing plaintext. The tree update remains
  asset-independent, so outputs that do not belong to the wallet require no
  asset guess.
- Have the contract admit deposits only for its immutable two-asset allowlist.
  A positive note of another asset then cannot enter the tree. Membership,
  asset-bound note commitments, and same-asset conservation prevent changing a
  valid input note from XLM to USDC or vice versa without finding a commitment
  collision.

This also gives the product one private setup, one private receive address, and
one local scan for both assets. The sender chooses the asset; the recipient does
not enable a second private account.

### Circuit experiments

At the time of this experiment, the two-output circuit had 14,574 constraints
in a maximum 16,384-constraint Groth16 domain. Temporary research variants
compiled as follows. The implemented three-output circuit now has 15,114
constraints in that same domain.

| Historical experiment | Constraints | Remaining in domain |
| --- | ---: | ---: |
| Current depth 17, two outputs | 14,574 | 1,810 |
| Hidden asset, depth 17, two outputs | 14,579 | 1,805 |
| Hidden asset, depth 17, three outputs | 15,180 | 1,204 |
| Hidden asset, depth 18, three outputs | 15,722 | 662 |
| Hidden asset, depth 19, three outputs | 16,264 | 120 |
| Hidden asset, depth 20, three outputs | 16,806 | Does not fit |

The hidden-asset-only change costs five constraints. Witness tests accepted a
valid hidden-asset transfer and matching public-boundary deposit, while rejecting
a nonzero public asset on an internal transfer, the wrong private asset, and a
boundary/private asset mismatch.

The third-output measurements reserved capacity for a possible private relayer
fee note. The subsequently implemented relay protocol resolved peer failover by
committing a sender-chosen fee and allowing the submitting peer to receive that
fee through an encrypted same-asset output, without publishing a relayer
address in the action.

The depth-17 three-output prototype remained in the same proving domain. On the
same desktop environment, three measured runs after warm-up were:

| Circuit | Median full proof | Wasm | Development zkey |
| --- | ---: | ---: | ---: |
| Current depth-17/two-output | 538.1 ms | about 149 KiB | about 8.6 MiB |
| Hidden-asset depth-17/three-output | 545.9 ms | about 152 KiB | about 8.9 MiB |

The median increase was about 1.4%. Peak memory was not measured reliably and
the result is not a substitute for physical-phone browser testing.

### Historical Testnet snapshot

At ledger 4,490,577 the pools contained:

| Pool | Actions | Leaves | Deposits | Internal transfers | Withdrawals |
| --- | ---: | ---: | ---: | ---: | ---: |
| XLM | 36 | 72 | 22 | 8 | 6 |
| USDC | 3 | 6 | 1 | 2 | 0 |
| Combined | 39 | 78 | 23 | 10 | 6 |

At this tiny testnet snapshot, a unified two-output tree would increase the
nominal USDC leaf set from 6 to 78 (13 times) and XLM's from 72 to 78 (8.3%). It
would impose the inverse scanning cost: a USDC-only wallet would scan all 39
actions rather than 3. These numbers are developer-driven testnet traffic, and
leaf count is not an effective anonymity-set measurement. They demonstrate the
direction of the tradeoff, not a production privacy claim.

### Capacity and state cost

A depth-17 ternary tree has 129,140,163 leaves. It supports 64,570,081 actions
at two outputs or 43,046,721 actions at three outputs. At a sustained one action
per second, the latter is about 1.36 years. Depth 18 raises this to 129,140,163
three-output actions (about 4.09 years); depth 19 raises it to 387,420,489
actions (about 12.28 years). Depth 19 technically fits the present circuit
domain but leaves only 120 constraints and is not a responsible production
margin. Depth 20 requires moving to at least a larger proving domain or reducing
constraints.

A third output also adds one 370-byte logical output package and a third tree
leaf to every action—about 50% more output archive data before XDR overhead.
That cost belongs to the relay/arity design, not to hidden assets themselves.

### Historical implementation gate

The research recommended proceeding only after the following checks. The
Testnet implementation subsequently completed the specification, ADR,
circuit/contract tests, vectors, manifest, and deployment steps; physical-phone
measurements, a production ceremony, and independent review remain release
gates rather than claims of this development deployment.

- a new ADR explicitly supersedes ADR 0003 for the asset-private, immutable
  two-asset case;
- the specification states the base-case and inductive conservation argument,
  recipient/outgoing asset-index encoding, public-sentinel authenticated data,
  boundary rules, scanner ordering, and archive format;
- circuit positive, mutation, differential, underconstraint, and constraint
  inspection tests cover cross-asset forgery and boundary mismatch;
- contract tests cover allowlist immutability, SAC identity, asset-field
  collision rejection, pool solvency, clawback/authorization failure, archive
  restoration, and spam/rent limits;
- testnet simulation records Soroban instruction, read/write, event, rent, and
  verification costs for both assets;
- physical-phone browser p50/p95 proving and scanning latency and peak memory
  pass agreed budgets;
- the tree depth/output-count choice has adequate production capacity and
  circuit headroom;
- a fresh phase-2 ceremony and complete vectors/manifests are prepared after the
  R1CS is frozen.

## Implemented outcome

1. The matched-diversifier mitigation is implemented across all three output
   lanes with focused vectors and recovery tests.
2. ADR 0008 supersedes ADR 0003 for a governed, append-only asset-private pool.
3. The Testnet replacement uses three outputs because the optional peer relay
   pays an encrypted same-asset fee note. Its measured archive/capacity cost is
   accepted for the development deployment.
4. Desktop and emulated-browser validation is recorded, but physical-phone
   proving, scanning, memory, and real multi-peer relay measurements remain
   release gates.
5. Fully hidden diversifiers remain a separate cryptographic workstream. The
   Ristretto feasibility code and any bespoke KEM remain unshipped pending
   independent review.

## Primary references

- [Zcash protocol specification](https://zips.z.cash/protocol/protocol.pdf)
- [Orchard keys and addresses](https://zcash.github.io/orchard/design/keys.html)
- [ZIP 212 note-plaintext and ephemeral-key derivation](https://zips.z.cash/zip-0212)
- [RFC 9180: Hybrid Public Key Encryption](https://www.rfc-editor.org/rfc/rfc9180.html)
- [RFC 9380: Hashing to Elliptic Curves](https://www.rfc-editor.org/rfc/rfc9380.html)
- [RFC 9496: Ristretto255 and Decaf448](https://www.rfc-editor.org/rfc/rfc9496.html)
- [Penumbra multi-asset shielded pool](https://protocol.penumbra.zone/main/shielded_pool.html)
- [Penumbra note commitments](https://protocol.penumbra.zone/main/shielded_pool/note_commitments.html)
- [Namada MASP ledger integration](https://specs.namada.net/modules/masp/ledger-integration)
- [Stellar Asset Contract](https://developers.stellar.org/docs/tokens/stellar-asset-contract)
