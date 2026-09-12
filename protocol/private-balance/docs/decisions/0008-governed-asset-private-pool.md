# ADR 0008: Govern One Asset-Private Pool

## Status

Accepted

## Context

ADR 0003 rejected a shared tree while every action still published its asset.
That design combined recovery and spam domains without producing cross-asset
privacy. The replacement circuit changes the premise: a private transfer uses a
zero public asset sentinel while proving against a private full asset field.
Deposits and withdrawals necessarily retain the public token boundary.

The operator also needs to add supported assets later without redeploying the
contract, while old notes must never become unspendable or be reinterpreted as
another asset.

## Decision

Use one deployment and one ternary tree with an append-only, administrator-
curated asset registry. Assign each Stellar Asset Contract a permanent
contiguous index. Encrypt the index in recipient and outgoing plaintexts, bind
the full corresponding asset field into every real input and all three output
commitments, and publish the asset/index only for deposits and withdrawals.

The administrator may add an asset, change it between `Active` and `ExitOnly`,
and transfer administration through propose/accept authorization. Entries
cannot be deleted, replaced, or reindexed. `ExitOnly` blocks deposits but keeps
transfers and withdrawals available for existing notes.

The browser corroborates the full registry across independent RPCs. Static
metadata can label a registered contract but cannot override on-chain identity,
index, field, or status.

## Consequences

- XLM and USDC transfers contribute to one action set, and an observer cannot
  distinguish their asset from the transfer action itself.
- Boundary flows remain asset-, amount-, endpoint-, and timing-public.
- All registered assets share tree growth, scanning, restoration, and
  availability. Admission authority is therefore security-sensitive.
- Removing an asset means `ExitOnly`, never deletion. This preserves historical
  note meaning and an exit path.
- Changing the administrator does not change existing registry indices or note
  commitments.
