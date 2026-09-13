# ADR 0002: Retain RFC 9180 Private Note Key Agreement

## Status
Rejected

## Context
The review proposed replacing DHKEM(X25519, HKDF-SHA256) with a Sapling-shaped variable-base
construction so the four-byte address diversifier could move inside the recipient ciphertext. That
would hide address reuse on chain and could let a scanner reuse one private-key handle.

The review-validation harness instead found a material standards-preserving improvement: RFC 9180
key derivation through WebCrypto plus view-tag-first rejection accelerates foreign-envelope scans
without moving any conformance vector. The replacement KEM has no independent specification,
interoperability suite, or audit in this repository. Its hashed-base-point and cofactor handling
would become new cryptographic protocol surface.

## Decision
Reject the custom variable-base KEM and retain RFC 9180 base mode with
DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, and AES-128-GCM. Retain the four-byte plaintext
diversifier in the fixed recipient envelope and document that it permits correlation when one
private address is reused.

Reconsider only against a stable, independently reviewed construction with cross-language vectors,
low-order-point tests, recovery tests, and physical-device scan measurements that materially exceed
the standards-preserving implementation.

## Consequences
- Existing RFC 9180 provenance and Rust/TypeScript interoperability remain intact.
- Address reuse can be correlated through the public diversifier even though note contents remain
  encrypted; wallets should continue issuing fresh private addresses.
- No proving key, contract binding, address encoding, or recovery transcript changes for this item.
