# Held private balance recovery

Implement the requested fix on `test/relay-payment-recovery`. The reproduced failure is a disclosed relay proof leaving an entire input note reserved, not evidence that the note was deleted or lost on-chain. The live helper failure itself remains unidentified.

## Safety design

- Never release an exposed input on quote expiry, cancellation, signing rejection, RPC error, or timeout.
- Offer an explicit direct self-transfer of exactly the held inputs, for their full value, with no private relay fee and no change. Derive a fresh self address in the authenticated worker and record its diversifier at disclosure.
- Keep the original pending action unchanged while building locally. At explicit proof-sharing consent, atomically replace that exact pending action with the exposed recovery action. Validate revision, input identity, asset, value, and shared real nullifiers. Concurrent preparation or canonical sync must invalidate stale disclosure.
- Explain before consent: the original payment can still confirm first; recovery uses the public account for network fees and discloses the self-transfer proof to the selected RPC. No automatic fallback or network funding.
- Canonical scans alone resolve the hold. Persist bounded recovery lineage and classify recovery confirmation, original payment confirmation, or another canonical conflicting spend. Submission acceptance is only pending.
- Reuse the existing Recovery modal shell, shared buttons, proof consent, review and safe error presentation. Guard cancellation, wallet/account/network replacement, stale async results and unmount.

## Implementation sequence

1. Add failing regression tests to the synthetic three-wallet fixture for self-recovery, exact input conservation, original/recovery races and cancellation.
2. Add the storage CAS, bounded lineage validation and canonical outcome reconciliation; integrate the recovery mode with the existing preparation and signing pipeline.
3. Expose a provider recovery action and add explicit Recovery controls without moving the modal shell into async boundaries.
4. Add browser tests on Chromium and iPhone WebKit for real controls, durable reload, race outcomes, focus/close behavior and accessibility. Extend Node coverage for concurrency, invalid worker results and retry/uncertain outcomes.
5. Update `[Unreleased]`, run focused and full relevant checks, obtain independent review, and commit the logical fix on this branch. Do not merge, push, release, deploy, or use funded wallets.

## Verification boundaries

Synthetic tests run the real builder, encrypted storage, action flow, signing classification and canonical scanner. Proving, ledger/archive and RPC transport are controlled and cannot establish live network success. Keep screenshots, tracing and video disabled. Human assistive technology and physical-device checks must be reported separately.

## Delivered behavior

- Private asset cards with an exposed pending spend now offer **Recover held balance**. The existing Recovery dialog keeps the history check and adds explicit self-recovery preparation, proof-sharing consent, password authorization and signing.
- Recovery uses exactly the original held inputs, a fresh worker-derived self address, the entire private input value and no private helper fee. The public account must pay its network fee. Nothing is automatically funded, signed or submitted.
- A disclosure-time encrypted-storage compare-and-set preserves the original hold until the replacement is committed. Cancelling before disclosure preserves the original journal; cancellation or failure after disclosure never makes the inputs spendable prematurely.
- Canonical activity resolves the winner and persists the outcome across reload/backup. Bounded recovery-attempt metadata does not disable future attempts.
- Preparation and signing are bound to the vault generation, wallet account/network, selected RPC, deployment/storage scope and live private provider. Provider retirement is checked inside the wallet signer after password approval and chunk loading, before the actual signature. Delayed cleanup rechecks ownership before publishing private state.

## Verification evidence — 2026-09-07

- `npm test`: **1,765 passed**, zero failures/skips/todos. Final log: `/tmp/stellarkey-held-recovery-all-node-final-20260907.log`.
- `E2E_PORT=3297 npm run test:e2e:private-components -- relay-recovery.spec.ts private-components.spec.ts --grep 'held balance recovery|three-wallet relay|relay|helper|proof sharing'`: **70 passed**, zero failures/skips; 35 each on Chromium and iPhone WebKit. This includes 52 three-wallet/recovery checks and 18 existing relay/helper/consent checks. Final log: `/tmp/stellarkey-held-recovery-browser-verified-20260907.log`.
- Focused recovery/automation/UI Node suite: **54 passed**. It covers full-value recovery, one/two inputs, unrelated notes, both winners, stale/concurrent disclosure, cancellation, proof failure, rejected/uncertain submission, legacy records, backup restore, bounded lineage, tampered replacement fields and stale cleanup publication.
- Real-wallet/provider browser cases run the actual worker thread, encrypted vault, signing API and canonical scanner. They verify both winners, password approval, session replacement, network roundtrip and provider retirement. Other browser cases exercise real Recovery/review controls with controlled runtime transport, stable shell/backdrop identity, inertness, scroll locks, keyboard/pointer cancellation, repeated preparation, focus restoration, reduced-motion settings, sanitized axe checks and IndexedDB reload.
- The retired-provider signing and delayed-cleanup regressions were observed failing before their fixes, then passed. Full-suite source-contract assertions were updated for the linked abort signal and the additional signing dismissal lock; behavioral constraints remain covered.
- Application and fixture TypeScript checks passed. Full lint passed with zero errors and three existing image warnings in unchanged marketing components; final touched-file lint passed without warnings. Fixture cleanup and `git diff --check` passed.
- Independent review found no remaining important issues after the signing and cleanup guards were added.
- Production static build passed; all five build/bundle tests and the bundle budget check passed. The fixture cleanup gate passed again against the export. The existing main development server remained available and unrelated worktrees were left untouched.

## Remaining boundaries

The original live helper failure is still unidentified. This fixes the reproduced stuck-balance recovery path, not a demonstrated live relay transport fault. No funded wallet, valid spend proof or live ledger execution was used: canonical records and proof/RPC transport remain synthetic, so these tests do not prove that the user's funds have been recovered. No contracts, deployments, release versions or dependencies changed. No merge, push or release is part of this work. Human VoiceOver/NVDA, physical-device pinch zoom and live Testnet checks were not run; screenshots, traces and video remain disabled.
