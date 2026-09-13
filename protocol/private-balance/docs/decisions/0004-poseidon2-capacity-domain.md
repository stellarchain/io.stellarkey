# ADR 0004: Retain the Poseidon2 Domain-Slot Convention

## Status
Rejected

## Context
The review correctly found that the Poseidon2 length IV separates arities only. It proposed putting
a Merkle-specific identifier in the sponge capacity cell, which is structurally cleaner and costs no
additional Circom constraints when the permutation implementation exposes that cell.

The deployed design must produce identical hashes in Circom, TypeScript, native Rust, and Soroban.
Soroban's native `soroban_p2_hash` host function fixes the capacity initialization to the input-length
IV and exposes no capacity-domain argument. A custom guest permutation would abandon the measured
host acceleration. Encoding a fourth rate input instead would require another permutation at every
Merkle level and would no longer fit the current degree-14 circuit budget.

## Decision
Reject capacity-domain separation for this replacement protocol. Retain raw ordered ternary Merkle
parents, the pinned length IV, and the enforceable rule that every other arity-three protocol hash
places a distinct domain constant in rate slot zero. Security additionally relies on Poseidon2
preimage and collision resistance, as stated in the threat model.

Reconsider if Stellar exposes a compatible capacity-domain host function or measurements show a
custom implementation retains the current circuit and Soroban resource budgets.

## Consequences
- All four implementations continue to use the same native-compatible primitive.
- The domain-slot call-site test remains a consensus-critical guard.
- This is a convention backed by cryptographic assumptions, not structural capacity separation.
