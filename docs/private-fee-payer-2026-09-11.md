# Account values and Private Payments fee-account selection

## Scope and baseline

Requested on 2026-09-11: show a fiat value for every sidebar account and let a
private transaction use another wallet account for network fees, defaulting to
the currently selected wallet account. Implementation is in the authoritative
working tree based on `ac0dc4c2`, with the existing uncommitted receive,
action-context, getter-restoration, fee-error, footer, and whitepaper changes.
Those changes and the user's untracked audit/planning documents are preserved.
No live wallet inspection, signing, submission, deployment, or commit is part
of this work.

## Selected behavior and invariants

- Follow-up confirmed on 2026-09-12: every sidebar row and the all-account total
  must include public and private balances, independently of selection. The
  initial implementation mixed selected public/private totals with unselected
  public-only totals, causing apparent balance changes on account switches.
  Load each software account's saved, verified private balances from encrypted
  local state; never start inactive private runtimes or archive scans. Retain
  only balance/asset summaries for this unlocked session and network, clear on
  revocation, and ignore superseded reads after live/durable updates. Unknown
  or unreadable balances remain unavailable, not public-only or fabricated zero.
  Keep representative Testnet pricing, issued assets and privacy masking.
- Add a per-action fee-account selector to shielded Add funds, Send, Withdraw,
  held-balance recovery, and multi-step balance preparation. It defaults to the
  active account for each opening and does not change the active wallet,
  deposit source, private keys, selected notes, asset, or recipient.
- The current account keeps the ordinary direct envelope. Another software
  account pays through a locally constructed Stellar fee-bump envelope.
  Display both the original public transaction source and the public fee payer;
  this is not identity hiding or peer relaying.
- Show all wallet accounts, but disable watch-only and unsupported hardware
  accounts with specific reasons. Do not add blind hardware signing or remove
  existing hardware support to implement this feature.
- Bind the alternate payer's account ID and public key before proof disclosure.
  Freeze it into the disclosure, prepared review, encrypted journal and chained
  approval. A missing/deleted/changed payer or wallet/network/session change
  fails closed; never silently fall back to charging the active account.
- The resource cap stays 10,000,000 stroops. A fee bump adds its additional
  inclusion-fee operation, not another copy of the Soroban resource fee.
  Preflight the chosen payer's spendable public XLM and include the actual fee
  in all per-step/cumulative limits. A sponsored native deposit preserves its
  source reserve without deducting the other account's fee twice.
- Review the exact unsigned inner transaction, payer and maximum outer fee.
  Only after signing consent, sign the inner envelope and construct, validate
  and sign the exact fee bump. Its final hash depends on the inner signature;
  atomically persist the submitted outer hash and reviewed inner hash before
  broadcast. Receipts, polling, resume and reconciliation track the actual
  submitted envelope, not the earlier unsigned-inner review hash.
- Preserve canonical confirmation, proof-exposure holds, immutable disclosure,
  one-shot chain consent, legacy route restrictions, session revocation, and
  cancellation behavior. New journal fields are optional for old ordinary
  direct records, not permission to reinterpret old relayed/unknown routes.
- Keep shells, tabs, focus ownership and loading boundaries unchanged. Payer
  selection is local to the form and requires a fresh review after changes.

## Implementation sequence and verification

Follow-up correction: first reproduce A → B → A value changes using the actual
sidebar rendering, then add session/network/account-scoped summary loading and
revocable publication with per-account write ordering. Feed the same totals to
every row and include every account's private subtotal in the aggregate. Test
pending/error reads, active updates overtaking disk reads, clearing and stale
publication, unsupported accounts, native/issued assets, masking and lazy gates.
Run focused application tests, typecheck/lint and synthetic browser interaction
checks; earlier full-gate evidence below does not cover this correction.

1. Add failing account-valuation tests; implement shared representative
   portfolio calculation and wire every sidebar row. Check Testnet/Mainnet,
   multiple assets/accounts, missing prices, loading/errors, zero and masking.
2. Add failing real-SDK fee-payer review/signing tests. Implement exact inner
   review plus constrained sponsorship, wallet-account selection/authorization,
   fee arithmetic and encrypted journal validation. Cover altered payer, inner
   call, network, signatures, fees, hash and revocation.
3. Thread the payer through preparation, disclosure, chained approval, recovery,
   submission, receipts and resume. Cover both accounts' reserve/liability
   accounting and original-vs-recovery canonical outcomes with synthetic data.
4. Add the shared selector to the relevant private forms and review. Exercise
   real controls with isolated non-usable synthetic wallets in Chromium and
   iPhone WebKit, keeping screenshots, traces and video disabled. Check defaults,
   alternate choice, persistence within the action, fee totals, shell/backdrop
   identity, focus, inertness/scroll lock, cancellation and accessibility.
5. Run focused tests, typechecks, lint, the application/protocol gates, and a
   fixture-clean build with bundle checks. Review the completed diff directly;
   no delegation is authorized. Update the whitepaper and `[Unreleased]` for
   the implemented signing and public-visibility boundary. Report unrun live,
   physical-device, human assistive-technology and release checks separately.

## References checked

- Installed `@stellar/stellar-sdk` fee-bump builder and RPC types: the builder
  separates the inner Soroban resource fee from its per-operation inclusion fee.
- [Stellar fees](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering)
  describe a fee-bump account paying transaction fees instead of the inner source.
- Current private transaction review and signer reject arbitrary fee bumps; the
  new path must be explicitly constrained, not a removal of those checks.

## Implementation and verification record

### Account-switch correction — 2026-09-12

Implemented the confirmed public-plus-private policy for every sidebar row and
the combined portfolio. Values use authenticated, locally saved private state;
unselected accounts are not scanned and no private worker starts for valuation.
Refresh reloads these summaries, and unknown/error data remains unavailable.
Only asset/balance fields are retained, scoped to account membership, network
and unlocked session. Active updates invalidate older reads; lock/revocation
clears summaries and prevents late publication. Display masking is preserved.

At 00:02 UTC, in the same dirty checkout at `ac0dc4c2`, verification passed:

- Observed the production sidebar regression fail before changing its value
  source, then pass for A → B → A, full XLM/fiat values, masking and unknowns.
- `npm test`: 1,833 passed, zero failed/skipped. New store tests cover obsolete
  reads, minimal retained fields, unreadable/absent state, removed accounts,
  revocation and generation restart.
- `npm run test:e2e:private-components -- --grep 'account values include saved private'`:
  2/2 passed in Chromium and iPhone WebKit, using real encrypted synthetic
  checkpoints, wallet boundary and dashboard. Checks include preselection
  totals, switching, aggregate totals, local checkpoint refresh, network
  isolation, masking, lock cleanup, zero workers/submissions and sidebar axe.
  Network-switch checks explicitly refresh market data before asserting fiat.
- Typecheck, production build, fixture-clean checks before/after the build,
  five bundle tests and every bundle limit passed. Lint has zero errors and
  the same three existing marketing-image warnings. `git diff --check` passed.
- Fixed an observed runner cleanup error: it was checking `.next-dev` instead
  of its owned `.next-e2e` generated route types. The regression failed before
  correction; final browser verification and cleanup both exit zero.

The 16 correction source/test/changelog files, including new files but excluding
this record, hash to `cbf9edb41604ffb7e18ab88af6df3a9e84be22be09f1d05a5b0036108b2b7049`
using sorted paths, NUL, file bytes and NUL. The complete release command was
not rerun; these checks do not replace protocol/Rust/circuit, live-wallet,
physical-device or human assistive-technology verification. No commit or
deployment was made. The development server answered HTTP 200 on port 3000.

### Original fee-account implementation — 2026-09-11

Implemented in the authoritative dirty checkout based on
`ac0dc4c2fbb2cf63e4083bbd3cd651b127249335`. No commit, deployment, live wallet
inspection or live transaction was performed. Verification below was completed
on 2026-09-11, with final checks at 22:57 UTC, on macOS arm64 / Node v26.7.0.

The tested source snapshot includes 63 changed or untracked application,
test, fixture, configuration, changelog and Private Payments documentation files.
Its SHA-256 is
`033e29765e1ef0b7f5107da404d46f676978a6efda00a7df455d5a1a1775c88b`,
computed over sorted paths followed by NUL, file bytes, and NUL. This verification
record and unrelated planning documents are excluded. The fingerprint was
unchanged after the isolated iPad reruns.

- Account-value tests cover complete multi-asset snapshots, Testnet reference
  pricing, unavailable values, and the privacy-masked sidebar wiring.
- The focused action-context, fee-payer and chained-send command passed all
  66 tests. Coverage includes source preservation, default/alternate payer,
  fee arithmetic, invalid signatures/network/fees, immutable consent, removal
  during asynchronous work, the signed outer hash, journal reload/resume, and
  fresh spendable XLM for the whole chain.
- The focused real-provider fee-payer browser command passed 12/12 cases in
  Chromium and iPhone WebKit. It uses non-usable synthetic wallets and proof
  transport, with screenshots, video and traces disabled. It covers actual
  selection/password/signing controls, default restoration, Max/reserve and
  liability accounting, Back, a narrow viewport, keyboard navigation, modal
  identity/inertness, accessibility, unavailable payers and canonical recovery.
- Direct working-tree review included the unsigned-inner/signature boundary,
  fee caps, encrypted journal transitions, runtime/wallet revocation and UI
  bindings. Review found and corrected default-chain reserve accounting and
  recovery fee-account selection after an error, with observed failing tests
  before both corrections. This was not an independent security review.
- Browser verification now uses its own generated development directory. The
  first application run exposed a missing lint ignore for that directory;
  the added regression test checks both generated-output exclusion and that
  the real fee-selector source remains linted.

The final `npm run verify:application` run exited **1**, not zero. Every stage
before the last general browser run passed:

- Generated artifacts and proof vectors; TypeScript; all **1,828 application
  tests**; all **58 browser-protocol tests**.
- Lint: zero errors, three existing marketing-image warnings. Production audit:
  its high-severity gate passed, with 10 low-severity vulnerable package entries
  remaining; this is not a count of distinct advisories.
- Safe reporter: 2/2; required private UI: 16/16; required synthetic components:
  **604/604**, with no failures or skips.
- Fixture cleanup before and after the production build; production build;
  bundle tests 5/5 and all existing size budgets, without raising limits.

The final general browser run completed 451 cases: 127 passed, one failed and
323 were skipped by existing fixture, network or platform gates. Fixture-only
cases had already run in the required 604-case suite. The failure was
`e2e/accessibility.spec.ts:412`, iPad WebKit settings navigation, at the settings
row click in `visitSettingsSubpage`. The settings component, shared UI primitive
and accessibility test were unchanged. Re-running that exact case twice against
the unchanged production export passed 2/2 (exit zero). Its initial failure is
recorded as intermittent, with the cause unresolved; the full application
command is **not** claimed clean. Final fixture cleanup and `git diff --check`
also passed.

`release:verify` was not run from this intentionally dirty checkout. Human
VoiceOver/NVDA, physical-device zoom, live ledger submission, and separate
Rust/circuit release jobs are not established by these application checks.
