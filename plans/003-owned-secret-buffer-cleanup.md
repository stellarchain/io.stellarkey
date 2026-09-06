# Plan 003: Clear owned temporary secrets on every exit path

> **Executor instructions:** Read fully; use executing-plans and test-driven-development if available. Follow each gate/stop condition. Update the index with recorded results unless the reviewer owns it. No prior conversation needed.
>
> **Drift check:** Run `git diff --stat 3e8dca7d021767138bc21c790f7ef59cc2fce309..HEAD -- protocol/private-balance/packages/browser/src/keys.ts protocol/private-balance/packages/browser/dist/keys.js protocol/private-balance/packages/browser/dist/keys.d.ts protocol/private-balance/packages/browser/test/key-cleanup.test.mjs src/features/private-balance/worker/action-builder.ts tests/private-balance-output-cleanup.test.mjs tests/private-balance-worker-key-hygiene.test.mjs CHANGELOG.md plans/003-owned-secret-buffer-cleanup.md plans/README.md` and `git status --short`. Compare changed source with the excerpts; unexpected drift requires review.

**Goal:** Best-effort overwrite of owned, unreturned key/plaintext buffers on success and failure, without corrupting returned witnesses or caller-owned keys.

**Architecture:** Keep cleanup at allocation/ownership boundaries in SHA-512 expansion, expanded-key derivation and worker output construction. Start finalizers before the first throwing use of each buffer. Preserve cryptographic outputs and operations.

**Tech stack:** Existing TypeScript protocol package, HPKE/Noble primitives, worker action builder and Node tests. No new dependency, format or storage schema.

## Status

### Execution evidence — 2026-09-06

Implemented in the shared isolated executor branch, independently of 001/002. SHA-512 HKDF scratch blocks, scalar-expansion/rejected-scalar arrays, discarded default-address private material and partially built key bundles now have allocation-scoped cleanup. Worker output cleanup starts before recipient encryption; failed output rho is cleared and successful witness rho transfers to the caller.

Five new protocol tests and five new worker tests were first observed failing against the original implementation. All pass after implementation. A negative control removing only the note-plaintext overwrite reproduced the expected failure, then the overwrite was restored. No production observer hooks or test dependencies were added.

Fresh parent verification: protocol suite 49/49 passing, zero skips, including 1,000 Rust/TypeScript derivation comparisons; output/action-builder/outgoing-history selection 26/26 passing. Independent reviewers also passed the protocol and worker suites. Generated output changed only `dist/keys.js`; declarations, vectors, parameters, envelope bytes and dependencies are unchanged. `private:check-generated` passed. Integrated build/full-suite results are recorded in the final index.

Limits: JavaScript cannot guarantee physical erasure of immutable bigints/strings or opaque library/CryptoKey buffers. Cleanup covers owned arrays within the scoped functions, not all later lifetimes of successfully transferred witnesses. No transaction was signed, submitted or deployed.

- Priority: P2
- Effort: S–M
- Risk: MED — premature wiping can corrupt outputs; vectors mandatory
- Depends on: none; recommended after 001/002 for serial review
- Category: security / hygiene
- Planned at: `3e8dca7d021767138bc21c790f7ef59cc2fce309`, 2026-09-06
- Execution: IMPLEMENTED — independent spec/quality reviews passed; integrated release checks recorded in the final execution index

## Why this matters

Owned temporary arrays outlive their useful scope without explicit overwrite, especially after exceptions. Narrow cleanup reduces avoidable secret lifetime in application-owned memory. It cannot guarantee physical erasure in JavaScript, clear opaque CryptoKey/library internals, or make a compromised wallet safe.

## Current state

- `protocol/private-balance/packages/browser/src/keys.ts:83` leaves SHA-512 HKDF scratch output and previous blocks intact:

  ```ts
  const output = new Uint8Array(blocks * 64);
  let previous = new Uint8Array(0);
  for (let block = 1; block <= blocks; block += 1) {
    previous = new Uint8Array(hmacSha512(prk, previous, info, Uint8Array.of(block)));
    output.set(previous, (block - 1) * 64);
  }
  return output.slice(0, length);
  ```

  Adjacent `hkdfSha256Expand` wipes previous blocks and uses a finalizer. SHA-512 returns a separate slice, so scratch output can be wiped after making that copy.
- `keys.ts:290` derives `defaultAddress` but returns only its public/owner fields. The finalizer wipes `hpkeIkm` and `prk`, not discarded `defaultAddress.hpkePrivateKey`. Partial failures can strand unreturned derived arrays. Returned incoming viewing material must stay valid on success.
- `src/features/private-balance/worker/action-builder.ts:306` encodes a note, then awaits `createOutputPackage` before entering the later outgoing-envelope finalizer:

  ```ts
  } finally {
    noteBytes.fill(0);
    output.outputPackage.fill(0);
  }
  ```

  Recipient-encryption failure bypasses this block. Local memo/rho ownership also needs review; a successful witness owns its returned `rho`, which must not be wiped early.
- `packages/browser/src/encryption.ts:createOutputPackage` allocates a separate package and copies the recipient envelope into it. Preserve returned envelope usability when wiping the package.
- Exemplars: `worker/key-hygiene.ts` labels overwrite best effort; `worker/outgoing-envelope.ts` wipes owned plaintext/entropy in `finally`; `tests/private-balance-outgoing-history.test.mjs` retains synthetic plaintext references and checks zeroing while borrowed keys remain usable.
- The local protocol package exports tracked `dist/`; TypeScript-only edits do not change the root tests' runtime import.

## Commands you will need

Run from an isolated executor worktree with Node >=22.22.2 <27 and npm >=11.19.0 <13.

| Purpose | Command | Expected |
| --- | --- | --- |
| Rebuild package | `npm --prefix protocol/private-balance/packages/browser run build` | Exit 0; only relevant keys output changes |
| New protocol test | `node --no-warnings --test protocol/private-balance/packages/browser/test/key-cleanup.test.mjs` | Red before fix, green afterward |
| Protocol suite | `npm --prefix protocol/private-balance/packages/browser test` | Pass, unchanged vectors; report environment skips |
| Worker cleanup tests | `node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/private-balance-output-cleanup.test.mjs tests/private-balance-worker-key-hygiene.test.mjs tests/private-balance-outgoing-history.test.mjs` | All pass after implementation |
| Full unit suite | `npm test` | Exit 0 |
| Types/lint | `npm run typecheck && npm run lint` | Exit 0 |
| Artifacts | `npm run private:check-generated` | Exit 0 without regeneration |
| Build/budget | `npm run build && npm run test:bundle && npm run check:bundle` | Exit 0; no unexplained growth |
| Patch hygiene | `git diff --check && git status --short` | Scoped changes, no whitespace errors |

No test-only dependencies or experimental module-mocking flags. Rebuild before root tests. The package prebuild generator must leave unrelated parameters unchanged. Full release verification is separate and requires a clean worktree plus independent audit/browser gates; do not waive it.

## Scope

Only modify:

- `protocol/private-balance/packages/browser/src/keys.ts`
- Generated `protocol/private-balance/packages/browser/dist/keys.js` and `dist/keys.d.ts` if changed by the build.
- `protocol/private-balance/packages/browser/test/key-cleanup.test.mjs` — create.
- `src/features/private-balance/worker/action-builder.ts`
- `tests/private-balance-output-cleanup.test.mjs` — create.
- `tests/private-balance-worker-key-hygiene.test.mjs` for ownership assertions if needed.
- `CHANGELOG.md`, this plan and `plans/README.md`.

Out of scope: library internals, algorithm changes, production secret-observer hooks, arbitrary internal-key exports, generic cleanup frameworks, signature/envelope/plaintext layouts, circuit/prover changes, storage migration, outgoing-history policy changes, upgrades, signing or transactions.

## Git workflow

Use isolated branch `advisor/003-owned-secret-buffer-cleanup`; preserve dirty/untracked user work. Read `AGENTS.md` and `CONTRIBUTING.md`. No Next component edit is planned; stop if one becomes necessary. Keep source/generated keys/tests/Unreleased Security note in one logical commit, e.g. `security: clear temporary private key and note buffers`, signed off with the executor's own identity where required. No push, merge, release or deployment.

## Steps

### 1. Add behavioral red tests

Create the focused tests with deterministic synthetic inputs, retained array references and failures injected through existing callable dependencies. Exercise the worker through exported `preparePrivateAction`; model synthetic key/context/intent construction on `tests/private-balance-action-builder.test.mjs` without modifying that reference file. Follow stable `t.mock.method` usage in outgoing-history tests; instrumentation is serial, test-local and restored after each test. Never print captured arrays.

For HKDF, a test-local wrapper around `Uint8Array.prototype.set` can retain source/target references during derivation while calling the original unchanged. Filter and validate allocation lengths/call sequence; do not assume every captured array is a scratch secret. For encryption, reject the relevant synthetic WebCrypto encryption call and retain its data reference. Check whether the installed HPKE adapter copies that input: observing a copy does not establish zeroing of the worker's original note. Use additional test-local allocation capture if necessary; if safe observability needs a new production hook, stop for review instead.

Required red cases: HKDF scratch remains nonzero; recipient-encryption rejection leaves owned note plaintext nonzero. Add baseline successful derivation/output assertions to detect corruption. Document any unobservable buffer rather than presenting regex checks as behavioral erasure evidence.

**Verify:** Both new focused commands fail on intended cleanup assertions, not missing imports/hooks. Existing successful outputs/vectors pass.

### 2. Clean SHA-512 scratch space

Wrap expansion in `try/finally`. Compute the next block before wiping its predecessor, then install/copy it. Make the independent exact-length return copy before wiping final block and scratch output. Leave borrowed `prk`/`info`, labels, counters, lengths and error behavior unchanged. Throwing HMAC/copy operations still reach cleanup. Do not refactor unrelated SHA-256 derivation.

**Verify:** Rebuild and run protocol cleanup/suite commands. Captured scratch is zero, returned derivations match vectors and borrowed inputs are unchanged.

### 3. Dispose of unreturned derived keys

In `deriveExpandedSpendingKey`, track owned partial results and distinguish successful ownership transfer from failure. Always wipe discarded `defaultAddress.hpkePrivateKey`. On failure clear already-derived fields not being returned, including serialized incoming viewing material. Wipe a rejected scalar byte array before a retry replaces it. On success preserve every returned key/owner/public field; check aliases before zeroing anything.

**Verify:** Rebuild and run protocol tests. Add success and partial-failure cases; returned fields still derive/open identical synthetic addresses/envelopes. Record allocation ownership and any opaque library memory outside the tested guarantee.

### 4. Start worker cleanup before recipient encryption

Place note construction, recipient encryption, outgoing AAD/envelope and return preparation under an ownership-aware finalizer. Use a nullable `output` for failures before encryption returns. Dispose of owned note/memo whenever no longer needed and package whenever allocated. Dispose of unreturned `rho` on failure/rejected attempts, but transfer it intact to a successful witness. Keep returned envelopes/commitment valid. Do not mutate borrowed memo, recipient keys, diversifier, outgoing viewing key or context. Preserve minimized-history behavior that never constructs outgoing recovery plaintext.

**Verify:** Rebuild, then worker cleanup/full root tests pass recipient failure, outgoing failure, success, commitment retry and minimized-mode cases. Assert original error, zeroed owned buffers, usable returned witness and unchanged borrowed inputs. Temporarily remove the relevant finalizer in the isolated worktree: its regression must fail; restore immediately and record the negative control.

### 5. Document limits and complete gates

Add a factual Unreleased Security note. State best-effort overwrite, not physical erasure, forward secrecy or clearing immutable/library memory. Record actual observable buffers, coverage gaps, test results and unchanged vectors in this plan. Inspect source and generated diff before the commit.

**Verify:** Protocol/full root suites, types/lint, artifacts, build/budget and patch hygiene pass. Concrete environmental blockers leave status BLOCKED, not a false completed release.

## Test plan

Use outgoing-history/worker-hygiene behavioral examples. Cover scratch lifetime, partial derivation failure, discarded default private material where observable, early recipient failure, later outgoing failure, success ownership transfer, minimized mode and borrowed input integrity. Restore serial prototype/WebCrypto instrumentation automatically; never use it against real wallet data. Known-answer tests establish compatibility, not erasure—report separately.

## Done criteria

- [ ] New cleanup regressions red before fix and green after; negative control fails as expected.
- [ ] Tested owned scratch/plaintext disposed on success/error.
- [ ] Returned keys/witnesses/envelopes and borrowed inputs remain valid.
- [ ] Existing vectors and full root suite pass without changing expected crypto bytes.
- [ ] Types/lint, artifact, build and bundle gates pass.
- [ ] Scoped source/tests/generated diff, Unreleased note, coverage limits, results and index status recorded.

## STOP conditions

Stop for ownership-invalidating drift, a returned-data alias of a wipe target, observability requiring unsafe production hooks, two failed gate attempts, changed vectors, new dependency/export/format requirements or any change to proof retention/reservations/transaction semantics. Typed-array tests cannot establish physical-memory or garbage-collector guarantees.

## Maintenance notes

For new secret allocations document owner, last use, transfer and failure cleanup. Begin finalizers before the first throwing operation, not only the final encryption. Keep cleanup local and auditable. Third-party internals and immutable values require separate review and are not silently covered here.
