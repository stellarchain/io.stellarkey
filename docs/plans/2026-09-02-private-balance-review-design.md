# Private Balance Review Validation Design

## Goal

Validate every recommendation in `docs/private-balance-protocol-review-2026-09-02.md` with reproducible measurements or executable security tests, then implement only changes whose benefit and safety are demonstrated. The protocol may change incompatibly and fresh Testnet deployments may replace the current pools, as already authorized.

## Decision model

The review is an input, not an oracle. Each proposal receives an evidence gate recorded in `protocol/private-balance/results/review-validation.json`. PKCS#8 X25519 must produce byte-identical shared secrets across native and portable paths and materially reduce warm native latency. Circuit reductions must be measured from freshly compiled R1CS metadata. The ternary tree proceeds only if it keeps 13 public inputs, falls below the 2^14 Groth16 domain, and passes cross-language root/path/frontier tests plus proof mutation tests. Outgoing recovery proceeds only if a seed-restored sender reconstructs exact recipients, amounts, and memos without importing recipient-owned notes. Deposit storage optimization must retain a durable replay key.

The proposed Sapling-style variable-base X25519 construction does not proceed from a microbenchmark. It would replace registered RFC 9180 DHKEM semantics and therefore requires a complete KEM specification, cofactor/low-order analysis, independent vectors, and cryptographic review. The experiment will measure the current diversification cost and record this item as deferred unless those prerequisites exist.

## Architecture

Accepted protocol changes replace the existing Testnet protocol in place. A ternary depth-17 tree uses one raw three-field Poseidon2 sponge invocation per node; length-domain separation and the loss of an explicit node tag are documented as a deliberate tradeoff. Rust is the consensus reference, the contract imports its tree hash primitive, and TypeScript plus Circom must match fixed vectors. The frontier stores two partial children per level, while a Merkle witness carries two siblings and a position trit per level.

Operationally, generated circuit, proving, verifier, contract, manifest, catalogue, and Testnet fixture artifacts move together. No production ceremony claim is added: proving material remains development-only and Mainnet remains refused. Completed planning scaffolds are removed before the release gate, while the review, decision evidence, protocol specification, threat model, and changelog remain tracked.

## Verification

Focused red/green tests precede each production change. Final verification includes browser-package vectors, circuit tests and mutation tests, Rust workspace tests, the 100k model gate, deterministic artifact rebuilds, fresh Testnet fixture checks, TypeScript/unit/lint/build/bundle checks, and the browser matrix. Physical-phone and human assistive-technology checks remain separately reported manual gates.
