# ADR 0001: Greenfield Shielded Note Pool

## Status
Accepted

## Context
StellarKey requires opt-in private payments without introducing a hosted backend, relayer, indexer, or centralized server.

## Decision
Build a greenfield fixed-asset shielded note pool on Soroban using Protocol 25 BN254 Groth16 host functions, width-4 Poseidon2, RFC 9180 HPKE, and persistent on-chain archive pages for disaster recovery.

## Consequences
- No external server dependencies or telemetry.
- Recovery is deterministic from seed and on-chain persistent storage.
- Nethermind codebase is not imported.
