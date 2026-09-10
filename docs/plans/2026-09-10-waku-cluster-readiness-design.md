# Waku cluster-aware relay readiness

## Approved scope

Fix the falsely successful Waku connection followed by indefinite “Reconnecting”, and verify the complete settings-to-helper flow with isolated end-to-end tests. The user approved implementation after the diagnostic findings, including E2E verification.

## Evidence

The two configured local service nodes run cluster 3. The latest user connection announced cluster 1. An isolated run of the installed application adapter reported two services connected at 1,182 ms, lost both connections at 1,189 ms, and then excluded both nodes as incompatible after its dial cooldown expired. A cluster-3 synthetic subscription and Store-backfill run remained connected for 71 seconds. The reason the live Chrome session used cluster 1 has not yet been established; tests must exercise the saved setting through the actual controls and manager rather than assume the setting reaches the transport.

## Design

The adapter must verify the configured peers’ authenticated Waku metadata and advertised service protocols before treating a connection as ready. A successful SDK wait alone is not proof of compatibility. Unconfirmed or malformed metadata must not count as ready. A disconnected peer must not count as connected, and a compatible peer must not inherit service readiness from an incompatible one.

If every configured service peer is known to run a different cluster, return a typed configuration error containing only bounded numeric cluster IDs. Preserve this error through readiness and expose a distinct “Check connections” state in the real Earn controls. Do not retry a terminal configuration error as though it were a temporary network outage. Normal outages keep the SDK’s existing automatic recovery.

Saving corrected settings must recreate the helper with the newly saved network. Start/Stop, private-runtime intent, unrelated settings changes, late asynchronous results, modal identity, focus and scroll ownership retain their existing contracts. Where the settings-to-session test exposes a stale configuration race, fix that race at its source.

Alternatives rejected: forcing redials cannot repair incompatible clusters; silently choosing another cluster could join an unintended network; increasing keepalive does not affect metadata rejection.

## Verification and privacy

Add failing unit regressions before implementation. Cover mismatch, missing metadata, actual compatible services, mixed peers, retry classification, cancellation, and saved network propagation. Use the project’s isolated synthetic browser fixture runner on desktop Chromium and iPhone WebKit for actual controls, lazy gate, manager and adapter integration. Include accessibility, shell/focus identity, cleanup, and stale-result checks. Add an opt-in local-node browser integration check with the real SDK, synthetic topic, no wallet keys or payment publication, and a measured stable-connection interval. Never access the user’s Chrome storage or usable wallet, capture screenshots/traces/video, change the running nodes, or publish payment messages.

Update the changelog in the implementation commit. Run focused tests, type checking, lint, relevant E2E suites, fixture cleanup, and production build verification. Request independent code review before handoff. No release tag or remote publication is authorized.
