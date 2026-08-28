# Security Hardening Implementation Plan

**Goal:** Close the issuer-metadata phishing and resource-exhaustion gaps, encrypt contacts at rest, minimize paper-wallet secret lifetime, and make accepted client-only security boundaries explicit.

**Architecture:** Treat Horizon and issuer-hosted metadata as untrusted input at both fetch and presentation boundaries. Store contacts in the existing encrypted vault rather than a parallel plaintext store, migrating legacy records only after durable encrypted persistence. Keep unavoidable browser-only limitations visible in the product and release documentation.

**Tech stack:** Next.js, React, TypeScript, Web Crypto, Node test runner.

### Task 1: Issuer metadata boundary

- Add a strict bare-hostname normalizer and reject userinfo, URL syntax, whitespace, IP literals, and invalid DNS labels.
- Stream `stellar.toml` with the SEP-1 100 KiB maximum instead of calling unbounded `Response.text()`.
- Present curated and issuer-self-declared assets as different trust signals.
- Add regression coverage for deceptive domains, normalization, and oversized bodies.

### Task 2: Encrypted contacts

- Add an authenticated contacts envelope protected by the vault v3 master key.
- Migrate `stellarkey.contacts.v1` after master-key recovery, persist encrypted data first, then remove plaintext.
- Make contact storage APIs asynchronous and available only while unlocked.
- Preserve encrypted backup/restore behavior and add locked-state, ciphertext, and migration tests.

### Task 3: Paper-wallet URL lifetime

- Revoke the generated blob URL as soon as the print document loads.
- Revoke immediately when the popup is blocked.
- Add lifecycle regression tests.

### Task 4: Explicit security boundaries

- State the broad HTTPS connection policy, locked public metadata exposure, per-window PIN limits, and issuer-logo privacy tradeoff.
- Record the current Trezor-only low-severity transitive advisory boundary without weakening the release gate.
- Add documentation contract tests for these disclosures.

### Task 5: Verification

- Run focused tests after each task.
- Run lint, typecheck, the full test suite, production build, and production dependency audit before completion.
