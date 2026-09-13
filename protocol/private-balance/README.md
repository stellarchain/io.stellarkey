# StellarKey Private Balance Protocol

Greenfield shielded note pool implementation for StellarKey on Soroban with BN254 Groth16 and Poseidon2.
No backend, no relayer, no indexer, no third-party database.
All cryptographic scanning, witness generation, proof generation, and signing remain in the browser.

## Reproducing release artifacts

Run `npm run private:check-reproducible` from the application root on native
macOS ARM64 with Rust 1.97.1 (`aarch64-apple-darwin`), Circom 2.2.3, and Stellar
CLI 27.0.0. This canonical host is required for byte-for-byte contract reproduction:
the same Rust version on Linux produces different contract bytes. Normal
development generation remains available on other supported hosts, but those
outputs must not silently replace release artifacts.

CI and tagged releases use the pinned `macos-15` ARM64 runner label and verify the
actual Rust host, including rejection of an Intel/Rosetta toolchain. Each run
builds twice with separate fresh Cargo targets, compares both outputs, and
requires the rebuilt pool to match the shipped Wasm hash. No target cache is used
for this gate. Linux still runs circuit analysis, proving-key checks, and Rust
security checks. The required **Private Balance Gate A** aggregates circuit and
canonical-artifact jobs and fails for any failure, cancellation, skip, or missing
result. Application verification still checks generated files on Linux.
