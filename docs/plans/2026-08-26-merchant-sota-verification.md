# Merchant SOTA verification

Verified on 26 August 2026 from branch `feature/merchant-sota` after implementation and release-hardening commits `fd8be63` through `5ce7905`.

## Release gates

| Gate | Evidence |
| --- | --- |
| Unit and source-contract tests | `npm test`: 344 passed, 0 failed. |
| Type safety | `npm run typecheck`: passed. |
| Static analysis | `npm run lint`: passed. |
| Production build | Next.js 16.3.3 build passed; `/`, icons, and manifest routes prerendered. |
| Deterministic browser journey | `npm run test:e2e:merchant`: 1 passed, 0 failed against a production build. It covers setup, reload, staff switching, cash, crypto, split tender, approval refund, customer/loyalty, invoice, counter code, export, install handoff, offline recovery, and blind Z close. It also rejects console/page errors and mobile overflow. |
| Production dependency audit | `npm run audit:prod` exits successfully with no high or critical advisory. Ten low-severity findings remain in the latest Trezor Connect transitive Bitcoin/elliptic tree; npm reports no fixed Trezor release. |
| Production mock audit | `tests/merchant-no-mocks.test.mjs`, source scan, and built-chunk scan found no fixture module, runtime fixture import, or simulated-success phrase. `src/lib/merchant/mock.ts` is absent. |
| Live pubnet read | Read-only Horizon checks returned the public-network passphrase, ledger `64134160`, base reserve `5000000` stroops, the exact Circle USDC asset/issuer record, and one direct strict-send XLM→USDC route (`1 XLM` quoted as `0.1813823 USDC` at check time). Live rates and ledgers are observations, not test constants. |

CI installs Chromium and enforces typecheck, all unit tests, lint, the production dependency threshold, production build, and the merchant browser journey on pushes and pull requests.

## Requirement evidence

| Contract / task | Implementation evidence | Verification evidence |
| --- | --- | --- |
| 1. Versioned operational persistence | Validated v2 store, v1 migration, nested reconciliation, bounded graph-aware pruning, and future-version fail-closed behavior. Commit `fd8be63`. | `tests/merchant-storage.test.mjs`. |
| 2. Atomic secure setup | One validated setup commit; versioned salted PBKDF2 PINs; real trustline handoff. Commit `4ca9444`. | `tests/merchant-pin.test.mjs`, `tests/merchant-setup.test.mjs`, E2E setup. |
| 3. Staff and approvals | Least-privilege roles, session PIN switching/lockout, owner controls, refund ceilings, immutable approval decisions. Commit `f3fe85f`. | `tests/merchant-permissions.test.mjs`, E2E server switch and approval. |
| 4. Complete tender flows | Exact cash/change, external references, split remainder, adjustments, stock-once settlement, persisted receipts. Commit `589f51e`. | `tests/merchant-orders.test.mjs`, E2E cash and split sales. |
| 5. Crypto reconciliation | Exact asset identity, memo and amount outcomes, durable cursor, idempotent replay, explicit ambiguous/duplicate actions. Commit `fab13b0`. | `tests/merchant-match.test.mjs`, `tests/merchant-watch.test.mjs`, intercepted-Horizon E2E. |
| 6. Shifts and X/Z reports | Operator/terminal-bound open, derived readings, unresolved-work guard, blind count, immutable close. Commit `e94c9ce`. | `tests/merchant-shifts.test.mjs`, E2E open and Z close. |
| 7. Invoices | Durable numbering, draft/issue/partial/manual/void/duplicate lifecycle, immutable exact SEP-7 quotes. Commit `918d002`. | `tests/merchant-invoices.test.mjs`, E2E draft through paid. |
| 8. Counter codes | Stable identity, fixed publication quotes, open-code reconciliation, pause/expiry, real poster/print paths. Commit `d49df7c`. | `tests/merchant-counter-codes.test.mjs`, E2E publication. |
| 9. Customers and loyalty | Idempotent payer visits, local contact/note data, audited loyalty, privacy-preserving forget, real order history. Commit `3020ab7`. | `tests/merchant-customers.test.mjs`, E2E profile/note/card. |
| 10. Reporting and exports | Persisted-order tax/insight derivation, exact CSV/JSON output, audited supported downloads, truthful unavailable formats. Commit `2bbc6a5`. | `tests/merchant-reporting.test.mjs`, E2E CSV download. |
| 11. Settlement handoffs | Persisted validated rules and exact due swap/send intents; no background signing. Commit `420aa82`. | `tests/merchant-settlement.test.mjs`. |
| 12. Runtime and peripherals | Browser online/vault/Horizon state, bounded pending work, print/scanner/customer-display paths, truthful hardware bridge limits. Commit `3192dcb`. | `tests/merchant-runtime.test.mjs`, E2E offline/reconnect/install. |
| 13. No mocks and mobile/accessibility quality | Fixture system removed; shared visual-viewport modal/dropdown focus behavior; 44px coarse targets; safe-area, no-zoom, scrollbar, reduced-motion rules. Commits `5a4d514`, `e476096`, `f980344`. | `tests/merchant-no-mocks.test.mjs`, `tests/merchant-accessibility.test.mjs`, `tests/mobile-ui.test.mjs`, E2E viewport/error assertions. |
| 14. Release verification | CI browser gate, user operations guide, source/bundle audit, live read-only pubnet probe, and this evidence matrix. Commits `2f4a8b6` and final documentation commit. | All release gates above. |

## Product-boundary evidence

| Product contract | Result |
| --- | --- |
| Local-first authority | Browser storage owns till records; Horizon owns incoming crypto facts; the encrypted wallet owns transaction signatures. IDs and audit facts join the three. |
| Exact financial identity | Fiat stays in integer minor units; Stellar values remain canonical decimals; assets are `(network, code, issuer)` identities. |
| No silent signing | Refund, trustline, swap, and sweep paths require the unlocked wallet and reviewed signing flow. |
| Honest capabilities | Cash/card records describe local bookkeeping; unsupported bridges and third-party exports are unavailable rather than simulated. |
| Bounded runtime states | Storage readiness, QR rendering, online/Horizon state, and retry/error branches terminate in content, an empty state, or actionable failure. |
| Mobile and accessibility | One safe-area owner, no mobile zoom, hidden scrollbar chrome without disabled scrolling, 44px pointer targets, visual-viewport sheets, keyboard menus, accessible dialog names, and focus restoration. |

## Accepted external boundary

The only dependency finding is upstream: `@trezor/connect-web@9.7.3` is the current published release and pulls Bitcoin-support packages that npm maps to ten low-severity `elliptic` findings. There is no available fixed Trezor version. The application uses Trezor Connect only for Stellar address discovery/signing, retains its high/critical audit failure threshold, and must re-evaluate this boundary when Trezor publishes a remediated tree.
