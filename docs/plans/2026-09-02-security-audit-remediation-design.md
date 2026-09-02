# Security Audit Remediation Design

**Baseline:** `0d1806e`, which contains the post-`6e00568` hardening commits and the in-place
Private Payments protocol replacement through the provisional curve benchmark.

**Inputs:** `security-audit-2026-09-02-summary.md`, the full `571f5d1` report, the 2026-09-01 base
audit, and its remediation-verification report. The audit documents live in the parent worktree and
are treated as review input rather than current-state evidence.

## Decision rule

Every finding is rechecked against the current branch. A finding is implemented only when its
mechanism still exists, the proposed control belongs at a durable boundary, and the change does not
replace a working product feature with a weaker one. Baseline-specific line numbers and severities
are not trusted without reproduction. Already-fixed findings receive behavioral regression coverage
where the current coverage is only source-text matching.

## Architecture

The remediation has five boundaries:

1. **Vault and backup invariants.** A vault must validate before it is written. Non-key-bearing
   metadata such as transaction notes may be rejected or dropped per entry, but must not veto
   recovery of keys. Archived accounts remain valid key sources for backups, and account archival
   clears account-scoped private runtime data prospectively.
2. **Merchant record integrity and reconciliation.** Integrity digests use deterministic code-unit
   ordering with an explicit legacy-locale recovery path. A reconciliation row remains resolvable
   even when it is absent from the capped presentation tray; bounded operator actions resolve rows
   without falsifying shift reports.
3. **Authority and transaction review.** Security-authoritative account state comes from canonical
   Horizon at every multisig UI and builder boundary. New signer grants carry explicit in-session
   provenance, removals are shown in full, and submission records merge rather than discard expiry
   evidence.
4. **Recovery and lifecycle.** Break-glass merchant recovery authenticates with the wallet rather
   than an unreadable merchant session. Auto-lock measures both monotonic awake time and wall-clock
   suspend time. Private recovery and stealth scanning advance only across chain data actually
   observed and keep caches bounded without losing new receipts.
5. **Assurance.** Tests exercise behavior, not source strings. CI runs Rust contract/protocol tests,
   the fixture-independent Private Payments browser security spec, generated-artifact checks, and
   the existing web verification gates.

## Accepted current findings

The current code directly reproduces the audit mechanisms for account-label corruption, capped-tray
reconciliation eviction, locale-dependent merchant digests, archived-account private backup
rejection, `private:` transaction-note rejection, and custom-endpoint multisig form seeding. These
are the first remediation wave.

The second wave covers still-open transaction and lifecycle findings: muxed payer normalization,
durable submission expiry, merchant break-glass recovery, suspend-aware auto-lock, bounded stealth
discovery, root re-anchoring, shift-bound zero-value settlement, destination drift, and backup
identity/material correctness.

## Findings not applied as stated

- A second network provider is not added to ordinary merchant settlement solely to defend against
  compromise of canonical SDF Horizon. The post-audit branch already removed the configurable
  endpoint from this authority path. Long-lived invoice and counter-code identifiers are instead
  constrained by deterministic transaction identity, remaining balance, current destination, and
  explicit review where ambiguity exists.
- Existing Testnet Private Payments are not removed. Mainnet remains independently refused, and the
  single-party Groth16 setup remains development-only until a real phase-2 ceremony exists.
- JavaScript strings are not described as zeroizable, and timed clipboard clearing is not used when
  it could overwrite unrelated clipboard data.
- Source-text assertions are not treated as evidence that a security property works. They may remain
  as structural smoke tests only when paired with a behavioral test.

## Error handling and migration

All changes fail before mutation where possible. Legacy merchant digests receive a narrow,
deterministic recovery attempt and are resealed canonically only after authentication succeeds.
Malformed optional backup entries are reported and omitted; key-bearing vault failures remain fatal.
Existing durable pending transactions without expiry get a bounded manual-check fallback rather
than an infinite poll. No Mainnet or Testnet ledger mutation is part of this remediation branch.

## Verification

Each fix follows red-green-refactor and lands as one logical commit with a factual `[Unreleased]`
entry. Focused Node/Rust/browser tests run per commit. Final verification runs typecheck, lint, the
full Node suite, Private Payments browser and Rust workspaces, generated/provenance checks that do not
require a live deployment, production build, and relevant Playwright projects. Physical-device,
screen-reader, hardware-wallet, live-ledger, and fresh Testnet deployment evidence remain explicit
manual or consent-gated checks.
