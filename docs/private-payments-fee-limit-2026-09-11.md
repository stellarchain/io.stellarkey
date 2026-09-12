# Private Payments Testnet fee-limit recovery — 2026-09-11

## Cause and operational recovery

Both the primary and independent witness RPC reported the deployed pool's shared
code and instance as archived. A `deposits_paused` simulation required
50,514,133 stroops (5.0514133 Testnet XLM), above the unchanged 10,000,000-stroop
action resource-fee cap. The read-only restoration compatibility fix allowed
getters to decode virtually restored storage; it did not restore live ledger
entries or remove that cost from a later payment.

Following approval for a separate, faucet-funded Testnet maintenance account
and a total fee ceiling of 6 Testnet XLM:

- Verified the pinned deployment, network, code hash, and matching public code
  and instance data through both RPCs.
- Simulated and submitted one restore-footprint operation for those two exact
  entries, with a total transaction fee of 5.0504104 Testnet XLM. It invoked no
  pool action and did not use a wallet account or change the action fee cap.
- Required ledger `SUCCESS`, then corroborated live entries and unchanged
  code/instance contents through both RPCs. The fresh getter simulation fee
  fell to 13,017 stroops (0.0013017 Testnet XLM).
- Kept the maintenance key and transaction identifier in memory only; neither
  is retained in this record. No user payment was signed, retried, or submitted.

The returned lifetime was 120,959 ledgers, approximately seven days. This is not
a permanent keepalive service. The public-entry maintenance procedure and
spending-approval boundaries are in [the support runbook](private-balance-support.md).
No further restoration or TTL-extension spending was performed.

## Application change

Fee-limit preparation failures now explain that preparation stopped at the
approved network-fee limit. They direct the user to check private activity rather
than inventing a payment outcome. A surrounding shared-proof error still takes
precedence and keeps its unknown-status/reserved-input warning.

The new copy regression failed against the previous generic error and passed
after the change. Existing cap enforcement and shared-proof safety were also
characterized without altering their behavior. `[Unreleased]` was updated.

## Verification

Evidence applies to the working tree based on `ac0dc4c2`, including the existing
uncommitted receive, action-context, read-compatibility, and footer changes.
Checks below completed on 2026-09-11, with exit code 0 unless noted otherwise.

- Focused fee-limit, transaction-builder, proof-exposure, action-context, and
  restored-read tests: 69 passed; no failures or skips.
- `npm test`: 1,786 passed; no failures or skips.
- `npm run typecheck` and
  `npx tsc --noEmit -p e2e/tsconfig.private-recovery.json`: passed.
- Scoped ESLint and `git diff --check`: passed.
- `npm run private:check-generated`: passed.
- `E2E_PORT=3196 npm run test:e2e:private-components -- e2e/private-recovery.spec.ts --grep 'Add funds actual provider'`:
  final run passed all 10 Chromium/iPhone WebKit cases, with no failed attempts
  or skips. Fee-limit cases cover initial review and an expired review followed
  by Confirm; no signatures/submissions, retained shell/backdrop, focus,
  inertness, scroll lock, explicit discard, cleanup, and automated accessibility
  are checked. All wallets/transports are isolated, non-usable fixtures;
  screenshots, traces, and video are disabled.
- The browser run's 15 changed source/fixture files were verified byte-identical
  to the main workspace. Its temporary route and server were cleaned up. The
  original development server on port 3000 remains running.
- Production build and pre/post fixture-clean checks: passed. Five bundle tests
  and `npm run check:bundle`: passed.

Separately, the real action builder, published hash-verified proving artifacts,
local proof verifier, SDK simulation, and exact transaction reviewer prepared a
synthetic XLM deposit against the live restored deployment on both RPCs. Both
reviews passed with a resource fee of 7,250,947 stroops (0.7250947 Testnet XLM),
below the unchanged cap. Signing/submission were disabled; synthetic private
material remained in memory and was discarded when the process exited.

That multi-asset diagnostic exited 1 on its subsequent USDC simulation with
contract error 13. The USDC proof verified locally. A separate Horizon check
confirmed the public deployment fixture source has no USDC trustline, so that
source cannot exercise an ordinary-account USDC deposit. No live USDC deposit
success is claimed.
Initial standalone proving attempts could not start Node worker threads with the
stdin-only module flag; rerunning without that flag allowed proof generation.

This is not ledger confirmation of the user's payment, a complete live-wallet
end-to-end test, an independent review, or release approval. No commit, tag,
deployment, full `release:verify`, new Rust/circuit gate run, human screen-reader
check, or physical-device test is claimed.
