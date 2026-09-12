# Release verification performance and build portability

Approved on 2026-09-12 after reviewing CI run 34703381132. The source baseline is
the clean `fix/release-browser-portability` checkout at `b6aa56cb`, based on the
release candidate `1b1512971ff2bc6e3f33fd4d8f135837ed3bd3a3`.

## Outcome and boundaries

Reduce verification time without removing tests, changing privacy safeguards,
accepting skipped required checks, or changing shipped contract/proving artifacts.
The measured bottlenecks were the serial synthetic component stage (36m 8s,
including failed retries), Stellar CLI compilation (10m 55s), and a duplicate
generated-file check (49s). These timings are not projected savings.

## Implementation slices

1. Resolve the remaining Linux WebKit regression cases with structural-only
   diagnostics. Preserve shell identity, close-time clearing, focus, scroll/inert
   ownership and real animation-observer fault-injection assertions.
2. Install Stellar CLI 27.0.0 from its official, exact-checksum release archives.
   Cache archives, not trusted executable output; validate cached/downloaded bytes
   before extraction and validate the expected CLI source revision before use.
   Keep Linux runtime dependencies and all hardware/application dependencies.
3. Pin exact contract reproduction to macOS ARM64 with Rust 1.97.1. Keep circuit
   analysis and Rust security on Linux. Preserve the required Gate A check as an
   aggregation that fails unless both Linux checks and canonical reproduction
   succeed. Keep two fresh builds and the exact shipped-hash comparison.
4. Benchmark two independent browser workers within the synthetic component
   runner, retaining one exclusive fixture owner and its global cleanup. Keep
   every existing test/project and the full shared verification command. Separate
   CI shards remain a follow-up option if worker parallelism is insufficient;
   concurrent fixture owners must never share a checkout or server.
5. Remove only the standalone duplicate generated-file workflow invocation;
   retain it in the complete shared application gate. Update release notes and
   focused workflow/tool-installation tests in the same logical commits.

## Acceptance and release handoff

- Installer tests reject unsupported hosts, wrong digests, unexpected archive
  members and the wrong CLI revision. A corrupt cache cannot become executable.
- Workflow tests retain every required gate and fail on failed, cancelled,
  skipped or missing dependencies. Canonical host checks reject a different host.
- Browser collection remains complete. Repeated targeted Linux Chromium and
  iPhone WebKit regressions pass, including normal and reduced motion.
- Run the complete shared application/release command from a clean candidate,
  record the actual duration and result, and compare unchanged public artifacts.
- Require fresh PR CI and CodeQL before the approved one-time review exception;
  restore review protection immediately after merge. Tag, publish and verify the
  exact deployed release only after all gates succeed. Manual device/accessibility
  evidence remains separate from automation.
