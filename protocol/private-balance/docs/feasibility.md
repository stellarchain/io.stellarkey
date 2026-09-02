# Gate 0 Feasibility Findings

**Updated:** 2026-09-02
**Decision:** HISTORICAL MVP EVIDENCE ONLY; FINAL GATE 0 PENDING

The measurements below predate the 11-public-input, 14,574-constraint replacement and its
one-record-per-entry archive. They are retained as historical feasibility evidence only and must not
be attributed to the current artifact set. They are insufficient for beta, production, or Mainnet
approval. The Private Balance manifest must remain development-only until the final candidate
satisfies every Gate 0 condition against one immutable artifact set.

## Superseded evidence completed on earlier artifacts

1. **Protocol 25 host verification:** the earlier live testnet fixture verified its pinned BN254
   Groth16 proof path and rejects a manifest whose minimum protocol is below 25.
2. **Poseidon2 parity:** width 4, rate 3, capacity 1, and the length IV of
   `input_count * 2^64` match the pinned Stellar implementation, Circom, Rust, TypeScript, and an
   independent native Arkworks test oracle.
3. **Archive sizing:** the retired 32-record frozen-page experiment measured approximately 23 KiB.
   The current design instead stores each archive record in one persistent entry, so this result no
   longer establishes the current restoration footprint or resource ceiling.
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
- `results/curve-benchmark.json`

## Superseded provisional Groth16 curve benchmark

The earlier 23,437-constraint action circuit was compiled independently for BN254 and BLS12-381
and proved against the same deterministic deposit corpus. These are three-sample Node.js desktop
smoke measurements on an Apple M3 Max, not browser or physical-phone evidence:

| Metric | BN254 | BLS12-381 |
| --- | ---: | ---: |
| Constraints | 23,437 | 23,437 |
| R1CS bytes | 11,039,180 | 11,039,180 |
| Witness Wasm bytes | 188,366 | 188,367 |
| Benchmark proving-key bytes | 14,739,008 | 19,522,128 |
| Canonical uncompressed proof bytes | 256 | 384 |
| Proving p50 / p95 | 1,060.819 / 1,061.431 ms | 835.427 / 862.149 ms |
| Peak process RSS | 1,483,735,040 bytes | 1,515,044,864 bytes |
| Local verification p50 / p95 | 22.696 / 38.836 ms | 12.459 / 14.373 ms |

These values are not performance projections for the current 14,574-constraint circuit. The
measurements were produced with SIMD, explicit Wasm threads, proving-key streaming, and a
native mobile prover disabled. Soroban instructions, ledger I/O, resource fee, and transaction
bytes are explicit pending fields because no curve-specific comparison verifier transaction was
built. iOS Safari and Android Chrome physical mid-range-phone rows also remain pending. Therefore
the evidence selects no curve; the apparent desktop speed advantage for BLS12-381 is not a release
decision. Its larger key/proof and missing on-chain/mobile measurements still have to be evaluated.

The BLS12-381 comparison reuses the exact frozen circuit corpus and existing round constants. A
production BLS12-381 design would additionally require curve-reviewed hash parameters, verifier
code, host-resource measurements, a fresh phase-2 ceremony, and the full security review. The
benchmark command creates disposable setup material outside the repository and never changes the
shipped BN254 artifacts:

```bash
node protocol/private-balance/spikes/scripts/run-curve-benchmark.mjs --iterations 3 --warmups 1
```

## Final Gate 0 still required

- Rebuild and rerun every measurement against the final circuit, verification key, contracts,
  manifest, and immutable testnet deployment produced after the phase-2 ceremony.
- Measure p95 proving time and peak memory on supported physical mid-range phones; browser emulation
  is not physical-device evidence.
- Prove final combined Wasm size, worst-action resource ceilings, contiguous-record restoration ceilings,
  and compressed proving-artifact size against the final bytes.
- Run the full 10,000-action recovery and archived-record restoration drill on the target testnet with
  events, mirrors, and indexers disabled, within the transaction/time limits in the plan.
- Complete production-browser load/prove/cancel/lock/restart and native-crypto checks on the supported
  physical browser/device matrix, including real Android Chrome.
- Complete the production phase-2 ceremony and the independent Gate A, B, and C reviews. Those are
  mandatory external controls and cannot be replaced by self-review or local test evidence.

Until those items pass, no beta or user funds should use this deployment and no mainnet approval is
implied.
