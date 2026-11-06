# Audit review for the 1.1.1 replacement candidate

Reviewed on 2026-11-06 against the work in PR #40. The two audit reports
capture the a66a477 baseline and concurrent uncommitted work, not a verified
release artifact. Their original uncommitted files and source edits remain
preserved in the authoritative audit checkout. Selected changes were applied
to the isolated release branch; its version markers remain 1.1.1.

## Included

| Finding | Release disposition and observed focused checks |
| --- | --- |
| Friendbot wait | Reused the physical deadline across headers **and error-body consumption**, retaining at most 1 KiB of remote diagnostics and presenting at most 300 characters. The audit patch originally stopped its deadline after headers. All five synthetic Friendbot cases passed, including an error body that ignores cancellation. No funding request was made. |
| Artifact stalls | Included the no-progress deadline for headers, stream reads and no-body fallback. Cancellation cannot replace the timeout result, and oversized-reader cancellation cannot hold the failure open. Existing byte/hash checks remain required. The combined artifact, Friendbot and changelog suite passed 17 tests. |
| COR-01: stale refresh | Removed the three redundant delayed send refreshes. Refresh entry, publication, errors and final cleanup now require the captured account/network/session identity and endpoint revision. The stale account, network, ABA, unmount and endpoint regressions failed before the fix. The related ownership, refresh, submission and merchant suites passed 148 tests, with a further unchanged-owner control passing. |
| COR-02: signing ownership | Extended existing reviewed-context guards to batch payments, claims, merges, individual/batch trustlines, multisig configuration/disable, co-signing and reusable private payments. Guards run before API loading and approval, before software signing, after hardware approval and at prepared/final submission boundaries. The nine stale-entry regressions failed before the fix. The signing/adapter suites passed 335 tests; another 54 cases passed for delayed synthetic Trezor approval and queued pre-POST revocation. Already-submitted transactions retain canonical tracking. |
| COR-03: pending status latch | Import/lookup failure remains an unresolved status and releases only the owning generation's latch in `finally`. Existing bounded retry/expiry policy remains active; explicit retry can load the API again. Included in the ownership verification above. |
| COR-04: partial erasure | Revokes signing before cleanup. Vault, pending records, session storage, merchant/private records, service-worker and cache errors cannot claim successful erasure. A provider-owned recovery screen survives the original confirmation unmount and offers retry. Fault injection and storage/changelog coverage passed 43 tests; Chromium and iPhone WebKit each passed the synthetic keyboard/retry/accessibility check with no retries. No real wallet was erased. |
| COR-06: trustline activity | Exact zero limits produce `Trustline Removed`; nonzero or absent limits retain the existing addition label. Five mapping/export checks passed. CSV already uses the neutral `Trustline` label, so the report's broader export-mislabeling claim was not reproduced. |
| Narrow transitions | Included six explicit transition-property lists for onboarding/address-book controls. Typecheck and 15 onboarding/motion/changelog checks passed. No shell, lazy boundary or focus owner was moved. |
| Dependency maintenance | Next.js and matching lint configuration 16.4.5, app/Trezor reference SDK 17.4.0, and Tailwind 4.3.4. Installed-parent inspection confirmed one SDK shared by the app and `@trezor/connect-core` → `@trezor/network-stellar`. All 48 dependency/hardware/changelog checks passed against these installed versions. |

Focused numbers describe their specific runs and overlap; they must not be
added together as unique test coverage. Full clean-source application checks,
required PR CI, protocol gates and release-workflow verification remain required
for the final source. Earlier clean verification of 5856265 does not verify
these later source changes.

## Follow-up scope

- **COR-05:** Confirmed first-page-only claim discovery remains. Safe pagination
  needs validated cursors/IDs, account/network/endpoint request ownership,
  bounded retained results, and explicit continuation/retry controls. This
  release does not claim to fix discovery beyond the first 20 balances.
- **PERF-01:** Domain-context migration and removal of the merchant compatibility
  aggregate remain deferred. The reports provide no measured rendering benefit;
  a broad provider refactor is not necessary for these correctness fixes.
- **TEST-01:** The audit recorded one abandoned-backup-read failure and five
  isolated passes. The cause is unconfirmed. Preserve the full production case
  and its assertions; a passing isolated repetition does not erase that result.
  Investigate structural readiness/ownership diagnostics if it recurs.
- React Compiler, stricter global TypeScript flags, TypeScript/ESLint majors,
  circuit-toolchain updates and file-size refactors are outside this curation.
  No bundle budget is raised and no hardware support is removed.

## Evidence corrections and release limits

The first report's claim that no other lockfiles exist was corrected in its
release-branch copy: nested npm and Cargo lockfiles exist and remain distinct
verification inputs. Its root lock/provenance hashes and bundle numbers describe
that dirty audit snapshot, not this candidate's later 1.1.1 lockfile. Preserve
historical deployment/HPKE bindings and independently verify current provenance.

The manual/device/assistive-technology deferral and the exact
RUSTSEC-2026-0387 exception remain as explicitly authorized for this release task.
They are not passes or fixes. The inactive optional Rust research prototype
failure remains separately documented; no gate is weakened to accommodate it.
