# Audit Remediation Design

## Scope and priorities

This program implements every actionable code-audit finding except mobile pinch zoom, which remains intentionally disabled by product decision. The work is ordered so that user-visible correctness is repaired before broader architecture changes: bounded partial wallet refreshes; explicit recovery for unreadable local data; durable merchant commits; a live reporting clock; multi-tab coordination; privacy and retention; request coalescing; narrower React subscriptions; durable browser tests; strict production security headers; and an offline installed-app shell. Optional hosted multi-terminal synchronization remains outside this repository because it requires a service and a new custody/privacy contract.

Each slice is test-driven, independently verified, and committed separately. Existing exact-money, signing, canonical-hash, and hardware behavior remains authoritative. Migrations must preserve recoverable raw data, never silently reset it, and never claim persistence before storage succeeds. The existing no-pinch viewport remains unchanged while form controls retain their iOS focus-zoom protections.

## Runtime and recovery architecture

Wallet refresh becomes a resource pipeline rather than one `Promise.all` barrier. Account data, minimum reserve, claims, activity, market price, chart, and fiat rates settle independently. Every request has a deadline, last-known-good values remain visible, and only the affected surface reports an error. The account resource is fetched once per cycle and reused for balances, reserve calculation, and aggregate account totals. Market data receives a substantially slower cache cadence than Horizon account data.

Vault and merchant boot loaders return discriminated outcomes: `absent`, `ready`, `corrupt`, or `future`. Corrupt/future payloads remain untouched and writes are blocked until the user explicitly exports the raw record or resets it. The wallet gets a dedicated recovery phase instead of routing to onboarding. Merchant Mode exposes a recovery banner and cannot mutate an unreadable store. All merchant mutations use one durable-first transaction function: derive from the latest committed snapshot, save, then update refs and React state. Storage failures are typed separately from Horizon failures.

## Merchant persistence, time, and privacy

Merchant persistence keeps the current schema readable while adding an encrypted versioned envelope. Encryption uses the unlocked vault session through an intentionally narrow vault helper; the merchant provider cannot access wallet secrets directly. Existing plaintext v2 data migrates only after successful decryption-key availability and a verified encrypted write. Full encrypted wallet backups include the encrypted merchant envelope and restore it atomically with other satellite stores. A standalone encrypted merchant export remains available for operational archives.

The persisted envelope carries a monotonic revision and writer identifier. Web Locks serialize writes when available; a storage/BroadcastChannel notification invalidates other tabs, which reload the committed revision. If locking is unavailable, revision comparison rejects stale writes instead of applying last-write-wins. Only one tab polls Horizon at a time through a renewable watcher lease.

Retention removes expired customer notes, expired loyalty/provenance events, and customer records with no retained operational relationship while preserving unresolved financial graphs. A shared visibility-aware clock publishes minute, local-day, and local-month tokens so “today,” history comparisons, tax periods, and settlement prompts cross time boundaries without unrelated store changes.

## Performance, boundaries, and security

Polling is split by resource: Horizon account state refreshes after relevant SSE events, focus, manual refresh, and a conservative fallback interval; base reserve and market data are cached; account snapshots are deduplicated across active and aggregate views. Abort controllers cancel obsolete cycles. Merchant polling keeps its active/idle cadence but only the elected watcher tab performs it.

React boundaries are narrowed without a rewrite. Wallet and merchant providers expose stable memoized value groups, while frequently changing runtime data is separated from commands and configuration. Large orchestrators begin moving into focused hooks/modules, and render-count tests protect the stable boundaries. Existing dynamic imports remain in place.

Production CSP uses the installed Next 16 nonce-based Proxy pattern because this wallet handles sensitive data. Development retains the directives required by React debugging. `connect-src` is reduced to the configured Stellar, Trezor, and pricing origins. The service worker receives strict, non-cacheable headers and caches only immutable application-shell assets; it never caches Horizon responses, secrets, wallet HTML containing user data, or transaction submissions. Updates activate through an explicit, reload-safe flow.

## Verification

Pure tests cover partial refresh settlement, request deadlines, recovery outcomes, migration preservation, durable commit failure, clock boundaries, revision conflicts, retention, encryption vectors, backup restore, and CSP construction. Browser tests are split into wallet onboarding/recovery, hardware/watch-only, payments/swap, merchant operations, multi-tab behavior, installed-app/offline launch, and accessibility. Existing one-off scripts are either promoted to Playwright or removed only after equivalent coverage exists.

Every feature runs its focused red/green test, the full unit suite, typecheck, and lint before commit. The final gate adds a production build, all Playwright projects, dependency audit, clean worktree verification, and a review of every commit against this design.
