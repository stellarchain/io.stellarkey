# Merchant Muxed Routing Design

## Decision

StellarKey merchant payment requests use one immutable unsigned 64-bit routing ID per payable record. The routing ID, not the human-facing order or invoice reference, is the accounting identity.

The preferred transport is a CAP-27/SEP-23 muxed `M...` destination derived from the merchant's underlying `G...` receiving account and the routing ID. Preferred SEP-7 requests carry no memo.

For signers that cannot submit classic payments to muxed destinations, including the currently supported Trezor path, StellarKey also produces a compatibility request addressed to the underlying `G...` account with the exact same routing ID in a `MEMO_ID`.

Human labels such as `MC-O-1042` remain visible in the interface, receipt, and SEP-7 `msg`, but are never required for settlement matching.

## Invariants

- Routing IDs are canonical base-10 strings in the range `1...18446744073709551615`.
- A charge, issued invoice, or reusable counter code keeps its routing ID for its full lifetime.
- Preferred and compatibility payment requests resolve to the same routing ID.
- A payment watcher normalizes `to_muxed_id` and transaction `MEMO_ID` into one `routingId` field.
- If both transports appear on one payment, their IDs must agree. A conflict is never amount-matched automatically.
- Only the underlying `G...` account is queried from Horizon for existence and trustlines. A classic payment operation may still target the original `M...` address.
- A muxed destination cannot activate a missing account. Account creation continues to require a `G...` address.
- Merchant receiving accounts remain ordinary `G...` accounts in settings.
- No server, hosted lookup, or external routing database is introduced.

## Compatibility

StellarKey software wallets send directly to the preferred muxed destination. The merchant payment UI exposes a clearly labelled compatibility request for hardware wallets that cannot sign a classic payment to an `M...` destination. That request uses the base destination plus `MEMO_ID`; it does not ask the customer to copy a human memo.

Incoming payments are accepted through either transport. Existing amount-only matching remains a guarded manual-confirmation lane for payments that contain no routing identity, but routing conflicts are isolated for review.

## Persisted model

- `Charge.routingId`
- `Invoice.routingId`
- `CounterCode.routingId`
- observed and matched payments store `routingId` and `routingConflict`
- the matching lane is named `routing`, not `memo`

The current product has not been publicly released, so the merchant store schema advances as a clean current schema rather than retaining the proof-of-concept memo schema.

