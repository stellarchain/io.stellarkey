# Gate 0 Feasibility Findings

**Updated:** 2026-08-30
**Decision:** LOCAL MVP EVIDENCE PASSED; FINAL GATE 0 PENDING

The available evidence is sufficient to continue development-only integration. It is not a beta,
production, or mainnet approval. The Private Balance manifest must remain development-only until the
final candidate satisfies every Gate 0 condition against one immutable artifact set.

## Evidence completed

1. **Protocol 25 host verification:** the live testnet fixture verifies the pinned ten-signal BN254
   Groth16 proof path and rejects a manifest whose minimum protocol is below 25.
2. **Poseidon2 parity:** width 4, rate 3, capacity 1, and the length IV of
   `input_count * 2^64` match the pinned Stellar implementation, Circom, Rust, TypeScript, and an
   independent native Arkworks test oracle.
3. **Archive sizing:** the provisional 32-record frozen page is approximately 23 KiB, below half of
   the current 64 KiB contract-data entry limit.
4. **RFC 9180 HPKE:** official and local DHKEM(X25519)/HKDF-SHA256/AES-128-GCM vectors pass,
   including one-shot-context misuse and malformed/tampered input cases.
5. **Backend-free scanner recovery:** 10,000 deterministic canonical records recover the exact owned
   balance and activity using the production scanner with events, mirrors, and indexers disabled.
   This was a local canonical dataset, not 10,000 submitted on-chain actions.
6. **Current Core archival semantics:** a controlled Protocol 27 Core/RPC network archived and
   restored page/nullifier entries, and rejected a nullifier replay after restoration.
7. **Independent model scale:** 100,000 seeded randomized deposit, transfer, and withdrawal records
   reproduce the exact tree, nullifier set, transcript head, public balance, and action history; a
   corrupted middle record fails closed.
8. **Integrated MVP path:** the live testnet/browser fixture covers setup, deposit, consolidation,
   recipient output plus sender change, withdrawal, ambiguity reconciliation, lock/unlock, encrypted
   backup, seed-only recovery, endpoint switching, manifest tamper rejection, and browser smoke tests.

Machine-readable evidence:

- `results/mvp-e2e.json`
- `results/archive-gate.json`
- `results/model-100k.json`
- `spikes/results/recovery-10k.json`

## Final Gate 0 still required

- Rebuild and rerun every measurement against the final circuit, verification key, contracts,
  manifest, and immutable testnet deployment produced after the phase-2 ceremony.
- Measure p95 proving time and peak memory on supported physical mid-range phones; browser emulation
  is not physical-device evidence.
- Prove final combined Wasm size, worst-action resource ceilings, four-page restoration ceilings,
  and compressed proving-artifact size against the final bytes.
- Run the full 10,000-action recovery and archived-page restoration drill on the target testnet with
  events, mirrors, and indexers disabled, within the transaction/time limits in the plan.
- Complete production-browser load/prove/cancel/lock/restart and native-crypto checks on the supported
  physical browser/device matrix, including real Android Chrome.
- Complete the production phase-2 ceremony and the independent Gate A, B, and C reviews. Those are
  mandatory external controls and cannot be replaced by self-review or local test evidence.

Until those items pass, no beta or user funds should use this deployment and no mainnet approval is
implied.
