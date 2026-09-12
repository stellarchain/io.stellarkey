# ADR 0003: Retain Asset-Pinned Pools

## Status
Superseded on 2026-09-04 by
[`0008-governed-asset-private-pool.md`](0008-governed-asset-private-pool.md).

## Context
The review proposed making the asset field private for transfers and replacing each immutable
asset-pinned pool with one guardian-curated multi-asset registry. The intended benefit was a larger
shared anonymity set.

Every accepted action currently publishes its pool address, and each pool binds one immutable
Stellar asset contract. A shared tree would hide the transferred asset only for internal transfers;
deposits and withdrawals would still reveal the public token movement. It would also make unrelated
assets share tree growth, archive restoration, recovery scanning, state rent, admission policy, and
malicious-token spam exposure. A public registry update would introduce guardian policy into a
currently immutable value boundary.

## Decision
Reject the shared multi-asset registry and retain immutable asset-pinned pools. Cross-asset privacy
is not claimed. Pool discovery remains an authenticated catalogue concern, while conservation,
recovery, and operational failure domains remain isolated per asset.

## Consequences
- Users of different assets do not share one anonymity set.
- A malicious or high-volume asset cannot inflate another asset's tree or restoration workload.
- Asset admission does not become a mutable contract-governance surface.
