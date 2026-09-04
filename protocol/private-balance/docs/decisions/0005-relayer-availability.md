# ADR 0005: Disclose Self-Submission Until a Relayer Exists

## Status
Superseded on 2026-09-04 by
[`0009-browser-peer-relay.md`](0009-browser-peer-relay.md).

## Context
The pool already supports third-party submission. Transfer and withdrawal are authorized by the
proof, not by `require_auth`, and the action binds a relayer address and optional relayer fee. The
current browser does not use that capability: it puts the user's public account in the relayer field,
builds an inner transaction from that account, signs it, and submits it directly.

That source account is public transaction metadata and can link a shielded spend to the user's
Stellar identity. A fee-bump wrapper does not solve the problem. It changes and exposes the outer fee
source while preserving the public inner transaction source and its signature.

A privacy-preserving relay would instead receive the already reviewed action and proof, use the
relay's account as transaction source and bound relayer, submit the transaction, and optionally earn
the proof-bound fee. Auth-entry fee-sponsorship patterns demonstrate that third-party assembly is
possible, but they do not create an operated, abuse-resistant, privacy-reviewed relay service.

## Decision
Accept and prominently document self-submission deanonymisation for the development deployment. Do
not describe fee bumping as a privacy fix and do not add a nominal relay endpoint that the project
does not operate.

Before beta, either ship a separately specified and tested relay service or keep Private Balance out
of beta. A relay design must cover request minimisation and retention, proof/action size limits,
simulation and fee policy, replay and denial-of-service controls, multi-operator availability,
submission-status recovery, and a client fallback that never silently self-submits.

## Consequences
- The current development client needs public XLM and exposes its transaction source on every
  transfer and withdrawal.
- The contract and circuit retain the bound relayer and fee path, so a future relay does not require
  another proving ceremony.
- A fee sponsor may improve availability, but it is not credited as a privacy improvement unless the
  user's inner source is also removed.
