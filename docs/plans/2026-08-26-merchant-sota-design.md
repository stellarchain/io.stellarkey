# Merchant SOTA Design

## Product contract

Merchant mode is a local-first, one-device Stellar point of sale. A feature shown as available must either perform its action, persist its result, and survive reload, or clearly explain the external capability that is unavailable. Production screens must never fall back to fixtures, fake rates, fake orders, fake devices, or "would do" success messages.

Horizon is the source of truth for incoming crypto settlement. The encrypted wallet remains the authority for signing refunds, trustlines, swaps, and transfers. Browser storage is the authority for till operations such as cash/card tenders, shifts, staff, invoices, counter codes, customers, adjustments, settlement preferences, and export history. These authorities are joined through immutable IDs and append-only audit facts rather than UI-only state.

The browser cannot honestly provide unattended wallet signing, direct ESC/POS or cash-drawer control across all supported devices, or multi-device synchronization without an external service. Those capabilities are represented as explicit handoffs or unavailable integrations. Browser print/AirPrint, downloadable exports, `mailto:`/`sms:` handoffs, keyboard-wedge scanners, and a same-device customer display are supported.

## Domain and persistence

`MerchantStore` moves from version 1 to version 2. Loading first attempts the v2 key, then validates and migrates the v1 key without losing existing settings, catalogue, orders, charges, refunds, unmatched payments, or watcher cursors. Every nested collection is decoded and reconciled with safe defaults. Corrupt or future data fails with an actionable recovery error; it is not silently overwritten.

The v2 store owns:

- merchant settings, catalogue, modifier groups, orders, charges, refunds, and unmatched payments;
- staff, active operator, salted owner/staff PIN credentials, permission roles, and pending refund approvals;
- shifts, cash counts, adjustments, terminal identity, peripherals, and till preferences;
- invoices and their immutable asset quotes;
- counter codes and reconciled counter-code payments;
- customer records, notes, loyalty balances, and payer/contact associations;
- settlement rules, tax/export records, and monotonic document counters.

Money remains integer minor units. Stellar amounts remain canonical decimal strings and are converted with the existing exact helpers. Floating-point parsing is not used for settlement or refund accounting. Orders retain every tender leg. `TenderKind` includes crypto, cash, and external card, with an optional external reference. Stock changes only when an order settles, and every reversal/refund retains an audit link instead of deleting history.

PINs are never stored in plaintext. A credential stores a random salt and a versioned PBKDF2 digest produced through Web Crypto. PIN verification is rate-limited in the session. Merchant setup is atomic: profile, receiving account, accepted assets, taxes, tips, terminal, owner staff member, and PIN credential are committed together only when validation succeeds. Cancelling setup leaves Merchant mode unconfigured.

## Settlement flows

A crypto ticket creates an awaiting order and charge with a unique memo/reference, exact requested asset amount, expiry, and quote identity. The watcher deduplicates by payment ID, matches account and memo, verifies asset identity and amount, and records underpayment, overpayment, late payment, duplicate memo, or unknown payment as inspectable facts. A duplicate is never silently treated as a new sale. Once matched, the order settles, stock decrements once, the active shift updates through derived data, and the payer can update a customer record.

Cash and external-card tenders settle immediately into a persisted order. Split tenders preserve completed cash/card legs and create a crypto charge only for the exact remainder. The order is paid only after all legs cover the total. Ticket-wide and line-level discounts, comps, voids, service charges, and manual corrections become persisted adjustments tied to the authorizing staff member.

Refunds use the existing wallet transaction path. If the active operator lacks permission or exceeds their ceiling, the action creates a pending refund request for approval. Approved refunds still require an unlocked vault and explicit review/signing. Partial refundable value is calculated exactly from prior refunds. No merchant rule can silently sign a transaction.

## Operational surfaces

Shifts open with an operator and float, derive X reports from settled orders/refunds/adjustments, require a blind closing count, and persist the Z report and variance. Closing is blocked by unresolved tender flows or pending till actions.

Invoices support draft, issue, partial/manual settlement, Horizon reconciliation, void, duplicate, print, email handoff, and export. An issued invoice stores exact asset quotes so its QR encodes destination, memo, asset, and amount; it never asks the payer to infer a fiat conversion. Counter codes are persisted and can be paused. Fixed-price codes store a quote-at-print; open/tip codes price a received payment using an attributable live quote or route the payment for review.

Customers are learned from settled payer addresses and may be matched to wallet contacts. Notes, consent-safe labels, loyalty changes, and forget actions persist locally. Forget removes customer-facing personal metadata while retaining pseudonymous accounting records needed for till integrity.

Tax periods and insights derive only from real persisted transactions. Empty accounts show an honest empty state. CSV and JSON exports are generated with stable columns, exact amounts, network/asset identity, and an export audit record. Named third-party formats are offered only when their schema is actually implemented.

Settlement rules are preferences, not background signing authority. When a rule triggers, the UI prepares a reviewed handoff to the existing Swap or Send flow with the amount, source, destination, and rule context. The user signs explicitly.

## Runtime states and interface quality

All merchant screens use live online state, vault state, watcher state, active network/account, and persisted domain data. Skeletons have bounded lifetimes and transition to data, empty, or error states with a retry. Offline-created crypto charges are visibly queued or blocked according to whether their quote/reference is still safe. Hardware and Horizon failures preserve context and offer recovery.

The merchant shell is mobile-first: safe-area padding applies once, controls use at least 44-point targets, form fields remain at least 16px to prevent iOS zoom, sheets fit the visual viewport, scrollbars are hidden without disabling scrolling, and focus/keyboard behavior is accessible. Reduced motion, high contrast, screen-reader labels, focus restoration, and topmost-dialog Escape behavior remain first-class.

The same-device customer display is a deliberate full-screen mode protected by operator re-entry. External displays are labeled unavailable until a real synchronized channel exists. Printer rows expose browser print/AirPrint as ready; direct ESC/POS, Bluetooth, and drawer controls report that a bridge is required and never claim a successful test.

## Verification and release invariants

Pure Node tests cover versioned migration, exact money, PIN credentials, permissions, order settlement, split tender, shift reports, invoice/counter-code reconciliation, customer retention, exports, and settlement handoffs. Component/browser tests cover setup, a complete cash sale, a complete watched crypto sale, split completion, refund approval, shift close, invoice/counter-code lifecycle, empty/error states, reload persistence, iPhone viewport/safe-area behavior, keyboard access, and dialogs.

Release gates are unit tests, typecheck, lint over source (excluding generated worktrees/build output), production build, dependency audit, and deterministic browser journeys with intercepted Horizon. A final mock audit must prove no production merchant component imports `merchant/mock.ts`, contains fixture fallbacks, or presents "would" actions as completed.
