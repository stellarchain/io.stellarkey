# StellarKey Shielded Balance Protocol Specification (V1)

## 1. Overview
StellarKey Shielded Balance V1 is an opt-in zero-knowledge private payments protocol for the Stellar network using Soroban smart contracts, Groth16 zk-SNARKs over BN254, width-4 Poseidon2 hashing, and RFC 9180 HPKE.

## 2. Cryptographic Parameters
- **Curve & Field**: BN254 with scalar field $Fr$ ($r = 21888242871839275222246405745257275088548364400416034343698204186575808495617$).
- **Hash**: Poseidon2 over BN254 $Fr$, width $t = 4$, rate 3, capacity 1, $x^5$ S-box, 8 full rounds, 56 partial rounds, capacity IV $N \cdot 2^{64}$.
- **Encryption**: RFC 9180 base mode DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-128-GCM.
- **Tree**: 32-level incremental binary Merkle tree.
- **Action Shape**: 2 inputs, 2 outputs with constrained zero dummy slots.
