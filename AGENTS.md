<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# StellarKey release history rules

- Update `[Unreleased]` in `CHANGELOG.md` in the same commit for user-visible behavior, security posture, dependency changes, stored-data or deployment behavior, and removals.
- Use the Added/Changed/Deprecated/Removed/Fixed/Security categories. Keep entries factual, concise, and understandable without reading the diff.
- During release preparation, choose the next version by Semantic Versioning impact, move the accumulated entries into `[x.y.z] - YYYY-MM-DD`, and recreate an `[Unreleased]` section. Leave it empty instead of adding placeholder release notes when no later work exists.
- Update `package.json`, both root version fields in `package-lock.json`, `APPLICATION_VERSION` in `src/lib/brand.ts`, the current-release marker in `README.md`, the supported series in `SECURITY.md`, and exact version tests together.
- Never rewrite a published entry except to correct a factual error transparently.
- Keep one logical feature per commit and run its focused tests. Run `npm run release:verify` from a clean worktree before tagging a release.

# StellarKey interaction engineering rules

- Keep route chrome, dialog shells, headings, close controls, tab lists, focus ownership, inertness, and scroll locks outside lazy, Suspense, and asynchronous panel boundaries.
- Model overlay visibility, tab selection, request state, and animation presence independently. A tab or mode change must never close, key, remount, or replay the entrance animation of its containing overlay.
- Selection feedback is urgent and local. Scope loading/error UI to the panel or action that is waiting; never blank a page or dialog for local work.
- Use the shared `Modal`, `Tabs`, `Button`, motion tokens, and safe-error presenter before creating a new interaction primitive. New or touched shared components must not use `transition: all`.
- Give every `Tabs` and `SegmentedControl` an explicit `ariaLabel`; use `htmlFor` for native form labels and a text element—not an unbound `<label>`—for composite-control captions.
- Private panels load only after explicit intent. Do not prefetch, log, measure, screenshot, or retain secret keys, recovery phrases, private receive addresses, proof inputs, XDR, notes, addresses, amounts, or transaction hashes.
- Never represent RPC `PENDING`, Horizon acceptance, or a timeout as ledger confirmation. Preserve explicit preparing, signing, submitting, pending, confirmed, rejected, failed, and status-unknown states as applicable.
- Critical overlay changes require behavioral tests for shell/backdrop identity, inertness/scroll lock, pointer and keyboard focus, rapid switching, stale results, cleanup, intentional close, reduced motion, and iPhone WebKit.
- Run focused tests for touched interactions and the relevant accessibility checks. Before release, run the complete verification command from a clean worktree and record human VoiceOver/NVDA checks separately from automation.
- Use manual keyboard activation for lazy or private Tabs: Arrow/Home/End move focus; Enter/Space/pointer activate. Focus alone is not private-data intent.
- Bind asynchronous images, pages, and file reads to the current request/account/network/session; guard success, error, and final cleanup. A failed pagination sentinel requires explicit retry.
- Keep Select/menu portals in their owning modal; preserve logical Tab continuation and focus when a focused popup becomes disabled or disappears.
- Permit user zoom in viewport metadata and global touch CSS. Test 200% equivalent reflow separately from physical-device pinch and human assistive technology.
- Explicit subpage navigation owns destination scroll/focus initialization in the actual scroll container; data refreshes do not. Keep destination headings below sticky chrome and never move focus behind an active overlay.
- Disable wallet-test screenshots, traces, and video. If a runner cannot disable failure DOM snapshots, use isolated non-usable synthetic fixtures only, never a real wallet session. Report fixed labels and structural accessibility diagnostics, never serialized wallet text or node HTML.
- Relay approval waits only until the existing quote/payout expiry. Register exact signed authorization before publication (acknowledgement is not the delivery boundary), and retain once-per-quote submission attempts through uncertain RPC/reply outcomes until cleanup. Preserve recipient-diversifier and receive-address-reuse guards; preflight compatibility before peer discovery.
