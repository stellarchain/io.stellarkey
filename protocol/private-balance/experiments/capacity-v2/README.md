# Capacity v2 prototype

Status: local research prototype, not an enabled wallet protocol or deployment.

The complete local gate passed on 2026-09-13 (London time): 12 JavaScript tests,
10 generated proofs, 22 rejected public-signal mutations, both zkey consistency
checks, the native Soroban state-transition harness, and 12 browser-generated
cross-subtree proofs. Existing published v1 artifacts remained unchanged.

| Full-depth measurement | Observed result |
| --- | --- |
| Circuit constraints | 40,594 |
| Development proving key | 26,308,892 bytes |
| Chromium, default workers, three samples | 1.466–1.530 seconds |
| WebKit iPhone emulation, default workers, three samples | 2.015–2.147 seconds |
| Chromium, single thread | 11.001–11.051 seconds |
| WebKit iPhone emulation, single thread | 12.007–12.438 seconds |
| Native host instructions, append actions | 127.5–128.7 million |
| Native host instructions, full-input exit | 34.7 million |

Browser runs used an Apple M3 Max and root snarkjs 0.7.5; the application browser
package declares snarkjs 0.7.6. The worker configuration follows the application's
default, but this is a standalone proving benchmark, not a measurement of the
integrated wallet worker or a physical iPhone. Raw samples and provenance are in
[results.json](results.json). The results support proceeding to a production
design and device validation; they do not establish release readiness.

## Outcome and boundaries

Evaluate a ternary hierarchy with 17 inner levels and 47 outer levels, one public
global anchor, private subtree selection, globally positioned nullifiers, and a
proof-bound full-input withdrawal mode (kind 4) that appends no commitments.
Depth 64 provides `3^64` leaves; this is finite. Counters use exact 128-bit-compatible
integers. Existing v1 artifacts, deployments, addresses and application behavior
remain unchanged. No migration is performed.

Baseline: application v1.5.0, HEAD `561f716627debab6e72c72c57b1966e572fc3456`, with
pre-existing uncommitted whitepaper, README, changelog, protocol documentation and
documentation-test changes on 2026-09-13. Preserve that work.

## Implementation and acceptance criteria

1. Specify and test a sparse private hierarchy, exact global coordinates, atomic
   appends and authenticated archive replay. Force rollover and total exhaustion
   using the same implementation with small test dimensions.
2. Derive an isolated action circuit from the existing reviewed constraints;
   explicitly compose inner and outer membership. Observe rejection of the new
   exit behavior before implementing it. Test ownership, balance, position,
   subtree/root substitution and exit-mode binding with real witnesses.
3. Generate local development proofs and verify them in snarkjs and the existing
   Soroban Groth16 verifier. Exercise append/spend/replay/exit state transitions
   in a local Soroban contract harness and record host resource estimates.
4. Measure the full-depth circuit in isolated Chromium and WebKit with synthetic
   inputs only. Record raw timing samples, artifact sizes and available memory
   evidence; emulator results are not physical-phone evidence.
5. Record findings, commands, artifact hashes, remaining production gates and
   migration implications. Run focused prototype checks and v1 artifact checks.

## Invariants

- Inner root membership and subtree position are constrained under the common
  global anchor, never accepted from an unverified registry or action hash.
- Global position is `subtree * 3^innerDepth + localPosition`, remains private,
  and enters the nullifier. Normal spends and exits share the same nullifier set.
- Rollover changes neither custody nor the identity of existing notes.
- Kind 4 proves every output value is zero and withdraws the entire selected
  input value. It must remain executable at full capacity without an append.
- Root history may expire; old notes must obtain fresh paths under the current
  global root. Finalized subtrees remain authenticated within that root.
- Archive action count and next leaf position are independent. A zero-append exit
  advances the archive but not the tree. Replay checks a trusted final checkpoint,
  positions, roots and transcript integrity before publishing recovered state.
- Proofs, setup material and synthetic private fixtures never enter public app
  assets, release manifests, logs, screenshots, traces or videos.

## Production gates

This prototype cannot establish audited cryptographic security, mobile suitability,
funded network transaction costs, availability of archived data, or safe migration.
Production requires independent review, a circuit ceremony, real-device evidence,
wallet/HPKE integration, bounded network ingress and storage restoration, and a
separately specified migration from the immutable v1 deployment. Existing v1
nullifiers must never be reinterpreted to make already exposed proofs replayable.

## Reproduce

From the repository root:

```sh
node protocol/private-balance/experiments/capacity-v2/verify.mjs
```

Requires installed root/circuit/browser dependencies, Circom 2.2.3, the pinned
Rust toolchain, Playwright Chromium/WebKit, and compatible prepared BN254
Powers-of-Tau transcripts. Defaults are the existing local
`circuits/build/pot14_final.ptau` and `pot17_final.ptau`; override their paths with
`CAPACITY_V2_PTAU_14` and `CAPACITY_V2_PTAU_17`. These large files are not committed.
Their SHA-256 hashes are recorded in the results. The local power-16 file was
incomplete and was not used. No existing ceremony file was modified.

The runner compiles both dimensions, runs JavaScript tests, generates development
proofs, rejects mutations of all eleven public signals, checks zkey consistency
against the R1CS/transcript, runs the native Soroban harness, and measures browser
proof generation. It then verifies existing v1 artifacts and checks that the
published v1 protocol directory is byte-for-byte unchanged. Results are written
to [results.json](results.json) only after every stage succeeds. Browser samples
run sequentially after CPU-intensive compilation/proof/contract checks.

The Rust harness is an explicitly ignored, opt-in test in the ordinary v1 suite
because it depends on locally generated experimental artifacts. The command
above explicitly runs it with `--ignored`; an ordinary `cargo test` does not
establish that this prototype passed. No existing CI/release gate was weakened.

All generated proof fixtures, proving keys, witness Wasm and transcripts remain
under ignored `build/`. Only aggregate metrics, source/artifact hashes, versions,
and test status enter `results.json`. The benchmark opens fresh browser contexts
and serves an explicit artifact allowlist on loopback, with no screenshots,
traces, videos or application sessions.

## What the prototype establishes

- Real Circom witnesses traverse separately constrained inner and outer trees.
  Subtree identifiers are private; the eleven public signals retain one global
  anchor. Global positions above `2^64` are exercised without numeric truncation.
- The same implementation uses a 1+1 hierarchy to force rollover and complete
  saturation in three appends. Contract tests verify Groth16 proofs, move
  synthetic SAC balances, reject altered proofs/replay, and execute a zero-append
  exit after the root-history window has elapsed.
- Normal transfers and exits use the same persistent nullifier namespace. An
  alternative valid exit proof cannot spend inputs consumed by a normal transfer.
  An archive action counter above `2^80` remains exact during an exit.
- Archive replay authenticates ciphertexts, ordering, positions, roots and a
  caller-supplied trusted checkpoint. A synthetic seed is rederived to decrypt
  outputs across rollover, discard spent notes and construct a fresh path.
- The full-depth browser benchmark spends two synthetic notes from distinct
  17-level subtrees. Three samples per engine/configuration include witness
  calculation and proof generation; artifact fetch and verification are separate.

The initial single-inner-tree model failed the rollover regression. The copied
v1 action constraints rejected kind 4 before the new mode was added. The native
contract harness rejected the full-tree exit before its append-only capacity
guard was fixed. A transcript test also failed before encrypted payloads were
included in the archive hash. These observed failures establish test sensitivity;
they do not establish general security.

## Limits of this evidence

This is a feasibility result and a local self-review, not an independent audit.
The full hierarchy has 40,594 constraints and a development proving key of
26,308,892 bytes. Its finite maximum remains `3^64` commitments, or `3^63`
three-output actions. Exit actions do not consume that capacity, but still need
storage writes, fees, available data and transferable backing assets.

The native Soroban harness fixes synthetic source/recipient/token configuration
and takes a local development VK at construction. Its context is a test constant;
it deliberately does not implement production deployment binding or arbitrary
recipient binding. It cannot be promoted to a funded deployment. Its archive is
a minimal public test record; the JavaScript encrypted transcript is a separate
reference model, not the final on-chain wire format. Recovery reuses the existing
v1 envelope codec for compatibility testing, not a finalized v2 seed/address
migration. It retains full synthetic history and does not implement production
pruning, checkpoint discovery, cold restoration, or bounded network ingestion.

Host costs include native crypto/storage/token operations but exclude Wasm
execution and instantiation, a complete encrypted archive, transaction size and
live network fees. Browser results run on the recorded Mac; iPhone WebKit is
emulation. JS heap sampling excludes worker heaps and is not total peak memory;
WebKit does not provide that measurement. Physical-phone timing, memory, thermal
behavior and download reliability remain required.

The existing BN254/Groth16 security assumptions remain. Development setup has no
production circuit ceremony, and successful verification of a zkey's consistency
does not establish sound setup provenance. Production must also specify immutable
context/domain binding, storage retention and migration before regenerating any
release artifacts. The deployed v1 capacity limitation remains unresolved by
this separate prototype.
