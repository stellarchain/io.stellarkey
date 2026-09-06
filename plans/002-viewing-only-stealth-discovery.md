# Plan 002: Use viewing-only keys for reusable-payment discovery

> **Executor instructions:** Read fully; use executing-plans and test-driven-development if available. Follow every gate/stop condition. Update `plans/README.md` with verified results unless a reviewer maintains it. No conversation context is needed.
>
> **Drift check:** Run `git diff --stat 3e8dca7d021767138bc21c790f7ef59cc2fce309..HEAD -- protocol/private-balance/packages/browser/src/stealth.ts protocol/private-balance/packages/browser/dist/stealth.js protocol/private-balance/packages/browser/dist/stealth.d.ts protocol/private-balance/packages/browser/test/stealth.test.mjs src/features/private-balance/runtime/provider.tsx src/features/private-balance/runtime/stealth-runtime.ts src/features/private-balance/runtime/stealth-sync.ts tests/private-balance-stealth-runtime.test.mjs tests/private-balance-stealth-sync.test.mjs tests/private-balance-stealth-revocation.test.mjs tests/private-balance-vault.test.mjs CHANGELOG.md plans/002-viewing-only-stealth-discovery.md plans/README.md` and inspect `git status --short`. Reviewed Plan 001 lifecycle changes are expected; read its landed diff/tests. Other mismatches require review.

**Goal:** Match announcements without retaining spending roots/scalars/nonces throughout network discovery.

**Architecture:** Introduce a narrowly shaped viewing-key object and public-recipient derivation using the existing transcript. Derive scan material in a short vault callback that disposes of spending roots before transport; run discovery under Plan 001's revocable scope. Explicit sweep/signing retains its separate spending derivation.

**Tech stack:** Existing TypeScript browser protocol package, Noble Ed25519/X25519, React runtime and Node tests. Preserve protocol bytes and dependencies.

## Status

- Priority: P2
- Effort: M
- Risk: HIGH — derivation refactor; unchanged vectors mandatory
- Depends on: Plan 001, including real persistence-race coverage
- Category: security / least privilege
- Planned at: `3e8dca7d021767138bc21c790f7ef59cc2fce309`, 2026-09-06
- Execution: DONE — independently reviewed; all scoped implementation gates passed; separate release-audit blocker recorded in the execution index

## Why this matters

Scanning needs to recognize a public destination, not sign for it. Today it holds full stealth spending keys and derives each child's scalar/nonce merely to compare the public key. Removing that authority from long-lived network work reduces unnecessary secret exposure. Viewing keys remain sensitive, and this is not protection against an actively compromised unlocked browser.

## Current state

- `protocol/private-balance/packages/browser/src/stealth.ts` defines:

  ```ts
  export interface StealthMetaKeys extends StealthMetaAddress {
    scanPrivateKey: Uint8Array;
    spendScalar: bigint;
    nonceKey: Uint8Array;
    network: StealthNetwork;
  }
  ```

  `StealthMetaAddress` contains deployment binding and scan/spend public keys. `deriveStealthRecipientKey` returns a child scalar and HMAC-derived nonce. The same file's `deriveOneTimePublicKey` already supplies the public operation:

  ```ts
  const point = ed25519.Point.fromBytes(spendPublicKey, false)
    .add(ed25519.Point.BASE.multiply(tweak));
  ```

  Preserve its identity-point rejection. `deriveTweak` binds shared secret, ephemeral public key, deployment, scan/spend public keys and network. Reuse it exactly, including byte order, domain separation and existing point/low-order validation.
- `runtime/stealth-sync.ts:154` calls full `deriveStealthRecipientKey` but only uses `recovered.publicKey`; the nonce is not needed.
- `runtime/stealth-runtime.ts:82` retains full keys across `await syncStealthAnnouncements`. Its finalizer wipes arrays but cannot overwrite a bigint.
- `runtime/provider.tsx:466` places the whole scan inside `withPrivacySessionRoot`. Narrowing only the inner TypeScript type leaves the outer callback holding spending roots. Shorten the callback too.
- `packages/browser/src/index.ts` already exports `*` from `stealth.js`. The local package is a symlink with runtime exports in tracked `dist/`, not source TypeScript. Build before testing.
- Existing `packages/browser/test/stealth.test.mjs` supplies sender/receiver, validation and raw-scalar signature vectors. `tests/private-balance-stealth-runtime.test.mjs` requires identity publication before scan completion. Preserve those contracts.

## Commands you will need

Run from the executor worktree root with Node >=22.22.2 <27 and npm >=11.19.0 <13.

| Purpose | Command | Expected |
| --- | --- | --- |
| Rebuild protocol package | `npm --prefix protocol/private-balance/packages/browser run build` | Exit 0; only intended stealth output changes |
| Stealth protocol tests | `node --no-warnings --test protocol/private-balance/packages/browser/test/stealth.test.mjs protocol/private-balance/packages/browser/test/x25519-view-tag.test.mjs` | Pass after implementation |
| Protocol suite | `npm --prefix protocol/private-balance/packages/browser test` | Pass; record environment skips |
| Runtime suite | `node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/private-balance-stealth-*.test.mjs tests/private-balance-vault.test.mjs` | Pass, including Plan 001 |
| Types/lint | `npm run typecheck && npm run lint` | Exit 0 |
| Full unit suite | `npm test` | Exit 0 |
| Artifacts | `npm run private:check-generated` | Exit 0 without regeneration |
| Build/budget | `npm run build && npm run test:bundle && npm run check:bundle` | Exit 0; no unexplained growth |
| Synthetic browser regression | `E2E_PORT=3217 node scripts/test-private-components.mjs` | Required Chromium/WebKit cases pass |
| Patch hygiene | `git diff --check && git status --short` | Scoped changes, no whitespace errors |

The nested prebuild parameter generator must leave unrelated generated parameters unchanged. Never run `private:generate` to resolve drift. Use an unused fixture port and isolated worktree; retain screenshot/trace restrictions. Full release verification separately requires a clean tree and all dependency/browser gates.

## Scope

Only modify:

- `protocol/private-balance/packages/browser/src/stealth.ts`
- Generated `protocol/private-balance/packages/browser/dist/stealth.js` and `dist/stealth.d.ts`, via the package build only.
- `protocol/private-balance/packages/browser/test/stealth.test.mjs`
- `src/features/private-balance/runtime/provider.tsx`
- `src/features/private-balance/runtime/stealth-runtime.ts`
- `src/features/private-balance/runtime/stealth-sync.ts`
- `tests/private-balance-stealth-runtime.test.mjs`, `tests/private-balance-stealth-sync.test.mjs`, `tests/private-balance-stealth-revocation.test.mjs`, `tests/private-balance-vault.test.mjs`.
- `CHANGELOG.md`, this plan and `plans/README.md`.

Out of scope: changing full spending API signatures/behavior; signing/sweep source; viewing-key export UI or persistence; new addresses; curve/transcript/domain/network changes; SDK upgrades; circuit/proof/contract/artifact manifest changes; envelope layout; seed recovery; transactions/deployment.

## Git workflow

Use isolated branch `advisor/002-viewing-only-stealth-discovery` based on reviewed Plan 001, preserving the dirty main checkout. Read `AGENTS.md`, `CONTRIBUTING.md` and installed Next guides `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` and `node_modules/next/dist/docs/01-app/02-guides/static-exports.md` before provider code. Keep source/generated output/tests/Unreleased note in one logical signed-off commit using the executor's own identity, e.g. `security: limit reusable payment discovery to viewing keys`. No push, merge, release or deployment.

## Steps

### 1. Specify the failing viewing-key contract

Add protocol tests for this API shape:

  ```ts
  interface StealthViewingKeys extends StealthMetaAddress {
    scanPrivateKey: Uint8Array;
    network: StealthNetwork;
  }
  // deriveStealthViewingKeys(root, network, deploymentBindingHash)
  // deriveStealthRecipientPublicKey(viewingKeys, ephemeralPublicKey, network, implementation?)
  ```

Inspect actual own properties: no scalar, nonce, root, callback or full-key object. Compare sender, existing full-recipient and viewing-only public keys over multiple synthetic roots/ephemerals/networks/deployments. No usable real secrets or wallet data in fixtures or output.

**Verify:** Run stealth protocol tests. New API assertions fail on baseline while existing vectors pass. Do not update expected vector bytes.

### 2. Implement viewing derivation with the existing transcript

Add the interface and two functions in `stealth.ts`. Return a newly constructed narrow object, never a cast/spread of full spending keys. Reuse existing root/point derivation labels to preserve addresses. Do not derive a spend nonce for the viewing bundle. Computing its initial spend public point still requires a transient scalar; document bigint erasure limitations.

Matching performs X25519 with the scan private key, derives the existing tweak and uses `deriveOneTimePublicKey(spendPublicKey, tweak)`. Dispose of owned shared-secret/temporary arrays in `finally`. Preserve validation and native/portable selection. Leave full spending derivation and signing unchanged.

**Verify:** Rebuild, then run stealth tests. Agreement, invalid/low-order/identity points, network/deployment separation and existing signature/address vectors pass. Generated changes stay within `stealth.js` and declarations.

### 3. Release spending roots before transport

Change the sync key type and use `deriveStealthRecipientPublicKey`. Preserve comparisons, invalid-announcement skipping and revocation checks.

Shorten the provider's `withPrivacySessionRoot` callback: derive stealth root, build the narrow viewing bundle and copy only the storage encryption key required by this scan, then wipe the owned stealth root in `finally`. Return only viewing material plus the owned storage-key copy. Let the vault callback settle and dispose of its root before invoking a reader. Dispose of partial results if preparation or scope validation fails.

Make `syncStealthRuntime` receive viewing material rather than a root. Assign one explicit disposal owner: the provider outer `finally` wipes prepared viewing/storage buffers after scoped work drains; standalone synchronous identity derivation cleans its own bundle. Do not zero borrowed caller buffers or leave root-capturing closures across network awaits.

**Verify:** Runtime suite and types/lint pass. In a controlled first-page callback, assert captured owned preparation roots are already zero, actual scan payload contains no spending fields, and necessary viewing/storage buffers remain usable until completion. Success/revocation/error dispose of owned copies without changing another live session.

### 4. Prove compatibility and lifecycle together

Extend runtime tests for owned/foreign receipts, empty/repeated pages, malformed ephemerals, abort during derivation, lock between preparation and first read, and rejected transport cleanup. Preserve Plan 001 stale success/error/finally and IDB tests. Existing sweep/signing tests continue exercising full authority. Actual shape and public-key agreement assertions are required; grep alone is insufficient.

**Verify:** Rebuild, then run protocol/runtime/full unit suites, synthetic browser regression and artifact check. No changed vectors, newly skipped critical cases, export capability or migration.

### 5. Document limits and verification

Add an Unreleased Security note describing reduced retained spending authority during discovery. Do not call this anonymous transport, forward secrecy or protection from active-session compromise. Record actual command/count/skip results and generated-file review in this plan.

**Verify:** Types/lint, build/budget and patch hygiene pass. Report independent clean-release/audit blockers rather than waiving them.

## Test plan

Protocol: public-key agreement, deterministic addresses/signatures, native/portable implementations where supported, point validation, network/deployment separation, actual object shape and unmodified borrowed inputs. Runtime: roots disposed before first read, viewing-only payload, matching/cursor equivalence, late/aborted requests and cleanup. Regression: explicit sweep/signing and all Plan 001 lifecycle behavior.

## Done criteria

### Execution record — 2026-09-06

Started only after 001 independent approval and 54/54 real-provider/IndexedDB browser cases passed. Kept ordered feature commits on the existing isolated executor branch; main and user servers remain untouched.

Implemented the exact five-field viewing object and public-only recipient derivation using existing HKDF labels, X25519 shared secret, tweak transcript and Edwards point addition. No spending nonce is derived for the viewing bundle. The transient public-point scalar cannot be reliably erased as a JavaScript bigint; its owned byte expansion is cleared. Review additionally found the shared tweak helper's owned SHA-512 digest needed a finalizer: success/zero-scalar failure tests reproduced the omission and pass after the minimal cleanup, with unchanged output bytes.

The short vault callback lives in `prepareStealthRuntimeMaterial`, called and awaited by the provider before reader construction. This makes the real production preparation boundary testable without exporting roots or adding observer hooks. It returns only viewing material and an owned storage-key copy. The provider's outer finalizer disposes those copies after discovery drains. Standalone identity derivation cleans its own viewing bundle; sync never overwrites borrowed caller material.

Protocol verification: 58/58 tests, zero skips, including native/portable/auto public-key agreement, strict point and identity-sum validation, unchanged full signing/address/proof vectors and 1,000 Rust/TypeScript derivation comparisons. Nine added protocol tests cover viewing authority/shape and owned cleanup. Four initial runtime preparation tests were observed red on missing APIs; six preparation/ownership/network-deployment tests pass after implementation. Existing identity-before-network and Plan001 revocation tests are preserved, with the late-vault-page test migrated to the actual preparation/disposal API.

A deliberate negative control removing only the preparation root overwrite failed at the first network page with the fixed-label root-lifetime assertion; restored code passed. Additional viewing sync tests skip malformed ephemeral spam, deduplicate repeated receipts under advancing paging tokens and refuse a repeated page without replacing the authenticated checkpoint. An observer initially attempted to replace a frozen Noble method; it was corrected to retain the original scalar at the existing typed-array copy boundary, without inspecting private values or adding a production hook.

Parent runtime/sync selection: 13/13 passing. Independent final review passed 22 protocol/X25519 cases and 65 stealth/runtime/sync/revocation/vault cases, including the final dedup extension, and approved the ownership boundary. Final integrated counts and build/artifact/budget evidence are in [the index](README.md). This plan's generated changes are limited to `dist/stealth.js` and `dist/stealth.d.ts`. No address, envelope, schema, dependency, signing, proof or deployment migration.

Limits: viewing material is still sensitive; this is least-privilege lifetime reduction, not anonymous transport, forward secrecy or protection from an actively compromised unlocked browser. Opaque library/CryptoKey memory and immutable strings/bigints are not guaranteed erasable.

- [x] New tests red before implementation and green after rebuilding.
- [x] Viewing objects contain no scalar/nonce/root/full-key reference.
- [x] Network reads begin after owned preparation-root disposal.
- [x] `rg -n 'deriveStealthRecipientKey|StealthMetaKeys|spendScalar|nonceKey' src/features/private-balance/runtime/stealth-sync.ts` has no implementation matches.
- [x] Existing address/signature vectors unchanged and passing.
- [x] Protocol/runtime/full unit, types/lint, required browser, artifact and build/budget gates pass.
- [x] Only scoped generated outputs change; Unreleased note, evidence and verified index status present.

## STOP conditions

Stop for missing/unreviewed Plan 001, unexpected drift, two failed attempts, required out-of-scope edits, any key/vector mismatch, weakened point validation, retained spending root during first-page work, or a protocol/artifact/address migration requirement. Never update snapshots to legitimize changed cryptographic bytes. Report unavailable native/browser coverage explicitly.

## Maintenance notes

Viewing material is private: do not persist/export/prefetch/log/measure it. New scan fields must pass the runtime shape test. Signing derives authority only after explicit intent and cannot add it back to background discovery. Root-to-public-key scalar calculation is transient, not magically erasable in JavaScript.
