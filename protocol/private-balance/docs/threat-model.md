# Threat Model and Security Invariants (V1)

## 1. Assets and Security Objectives
- **Conservation of Value**: Sum of inputs + deposit = sum of outputs + withdrawal.
- **Double-Spend Prevention**: Nullifiers are persistent and strictly unique.
- **Spend Authorization**: Only the preimage holder of `ask` and `nk` can construct valid spend proofs.
- **Confidentiality**: Recipient address, transferred amount, input-note selection, and sender-recipient linkage are hidden on-chain for internal transfers.
- **Deterministic Recovery**: Software-account seed plus on-chain archive transcript guarantees spendable balance recovery.

## 2. Explicit Boundaries
- Public Stellar account fee payer and timing are visible.
- Deposits and withdrawals reveal public amount and public endpoint.
