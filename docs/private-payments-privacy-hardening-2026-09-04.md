# Private Payments privacy hardening

Started 2026-09-04; implementation review continued 2026-09-05. This is client hardening of the existing Testnet development
protocol, not a new pool deployment, proving ceremony, or independent cryptographic audit.

## Implemented safeguards

- Account-authenticated relay negotiation: an encrypted, domain-separated Stellar
  account-key signature binds the complete public request and quote. Unverified
  offers never enter ranking or receive selection metadata. This proves key
  possession, not the account's transaction signing threshold. Helper opt-in
  authorizes these offers; transaction approval remains manual.
- Fixed-size encrypted relay payloads: all message classes use the same 24 KiB
  padded plaintext size. Bounds, expiry, authenticated peer checks and replay
  rejection still apply. Protocol v2 uses a new topic and excludes v1 helpers.
- Private relay preparation: the selected helper performs account lookup and
  proof-bearing simulation. The sender checks the returned unsigned envelope
  against its retained operation, source, time and fee bounds without a direct
  preparation fallback. The helper validates its fee before RPC and keeps manual
  signing, exact-envelope matching and a single expiring preparation lease.
- Less public discovery metadata: transfer/withdrawal kind travels only in the
  encrypted selection. Public requests contain no action kind, asset or amount.
- Durable routing: new actions record direct or relay mode in encrypted state.
  Signing/broadcast must match it. Restart only rebroadcasts explicitly direct
  actions; relay and legacy records never disclose a transaction hash through
  sender-RPC recovery. Canonical scans reconcile them without downgrading routes.
- Spend authorization before disclosure: the exact payment and fee bounds require
  explicit approval before proof-bearing helper or RPC preparation. Exposed inputs
  and any chain fee allowance are durably recorded before the network call.
- Proof-aware recovery: an exposed transfer/withdraw proof can be reused in a new
  envelope. Cancellation, envelope failure or expiry cannot release it. Unsigned
  exposed preparations show status unknown. Legacy possibly exposed reservations
  survive cleanup and backup restore, and canonical spends reconcile them.
- Relayed consolidation: a fixed fee-aware note trace, at most 64 transactions,
  separately bounded private and helper-paid XLM fees, a fresh verified own address
  per merge, fresh explicit helper selection per step, and canonical inclusion plus
  the exact owned spendable output before continuing. No automatic direct fallback
  or chain resume is introduced.
- Birthday-independent discovery: initial reusable-payment scans use the common
  retained-history floor. The unused exact-birthday binary search is removed;
  legacy cached bounds are normalized without discarding forward cursors.
- Local address-reuse prevention: encrypted issuance history rejects previously
  recorded diversifiers, including after a full-verification rebuild or failed
  verification rollback. The 65,536-entry bound fails closed. A seed alone cannot
  recover previously unused issued addresses or synchronize independent devices.
- Optional outgoing-history minimization: recovery remains on by default. An
  explicit account/deployment-local choice replaces all three future outgoing
  envelopes with random same-size fillers before hashing and proving. Incoming
  notes and spent-note recovery remain intact; older outgoing records remain
  readable. Pending safety metadata is retained until reconciliation, but
  minimized payments do not add recent recipients or promote outgoing details
  into permanent activity. Encrypted backups preserve the choice; a seed-only
  restore defaults it to recovery enabled.

The audit's original birthday claim was too broad: new caches already replaced
the supplied installation timestamp with zero. The change removes a latent
reader/legacy-caller risk; it does not claim a previously active new-wallet leak.

## Limits that these changes do not remove

The selected helper learns the asset, fee, action diversifier, proof and exact
transaction. Its account is the public source. Its supplied account sequence,
footprint and resource estimates can still affect liveness or public metadata;
the sender does not independently simulate them or use its simulation ledger as
chain evidence. Public Nostr services still see
IP addresses, event times, message count and the pseudonymous routing graph.
Padding hides payload length, not those other signals; NIP-44 itself does not
provide forward secrecy. See the [NIP-44 limitations](https://github.com/nostr-protocol/nips/blob/master/44.md#limitations).

Receive-address reuse still exposes a repeated four-byte on-chain diversifier.
Deposits and withdrawals still have transparent boundaries. A small or lightly
used pool, distinctive timing/amounts, a compromised browser, or colluding
infrastructure can defeat stronger anonymity expectations. Two RPC/relay origins
are not proof of independent ownership or an honest majority.

An absent disclosed spend can remain reserved indefinitely: this client does not
yet establish permanent anchor invalidation automatically. A current root can be
refreshed, so its old expiry cannot serve as a hard deadline. Seed-only recovery
cannot reconstruct unconfirmed shared proofs whose local journals were lost.
Manual helper signing is local policy, not a restriction on a dishonest helper.
Relayed chains also remain susceptible to timing and transaction-count correlation.

## Separate work before broader privacy claims

The [next-format migration contract](private-payments-next-format-migration.md)
defines versioning, compatibility, suite-review deliverables, acceptance evidence
and transport/fee-service requirements. It is not an enabled replacement suite.

1. Hidden diversifiers require a versioned note/address/key-agreement specification,
   independent cryptographic review, cross-language vectors, malicious-point and
   key-privacy tests, seed-only scanning tests, phone measurements, and new bound
   artifacts/deployment. Do not delete the clear bytes from the existing X25519
   envelope: they are currently needed before decryption. The existing
   [hidden-diversifier research](private-balance-hidden-diversifier-unified-pool-research-2026-09-04.md)
   explains the migration. The [Zcash protocol](https://zips.z.cash/protocol/protocol.pdf)
   is a design reference, not evidence that a custom adaptation is reviewed.
2. Proof-bound deadlines need a versioned contract/circuit change. A conservative
   common-head proof of permanent non-current-anchor invalidation could improve
   client recovery first, but is not implemented by this patch. The old direct
   consolidation driver's pending-disappearance continuation is pre-existing;
   the new relay driver does not use that weaker success predicate.
3. An independent transport/privacy layer and a common helper directory require
   operational services and explicit trust assumptions. The static browser app
   cannot create IP anonymity just by selecting another public RPC URL. Common
   archive keepers/sponsors would also avoid account-linked restoration, but need
   funding, operation and a reviewed compensation policy.
4. Hiding the asset from a selected helper requires fee separation, such as a
   separately reviewed common shielded fee asset or unlinkable vouchers. Removing
   the selection field alone cannot hide an asset the helper must recover in its
   fee note.

Outgoing-history minimization is not forward secrecy or retroactive deletion.
Recipients still know their own payments, self-payments can recover as incoming
information, and canonical activity can expose the wallet's net private-balance
debit to someone with its seed. Existing recovery-enabled records and old backups
are unaffected.

## Verification and handoff

Local checks on 2026-09-05 (Node 26.7.0):

- `npm test`: 1,367 passed, no failures or skips.
- `npx tsc --noEmit --incremental false`: passed.
- `npm run lint`: passed, with three existing marketing `<img>` warnings.
- `npm run build`, `npm run test:bundle` (five tests), and
  `npm run check:bundle`: passed. The synthetic fixture route was absent from the
  production export; production configuration also rejects a leftover fixture.
- `E2E_PORT=3293 node scripts/test-private-components.mjs`: ten synthetic
  real-component checks passed across Chromium and iPhone WebKit. Coverage
  includes proof consent ordering, repeated chain choices, stale account results,
  successful and failed preference writes, modal identity, focus, inertness,
  scroll lock, reduced motion and automated accessibility.
- Fifteen existing private continuity/overlay/manifest checks and four critical
  wallet accessibility checks passed across Chromium and iPhone WebKit. The
  wallet accessibility checks used the production static build. These runs
  disabled screenshots, video and traces.
- `npm run private:check-generated`: passed during this implementation; generated
  artifacts were unchanged. No new ceremony or deployment was performed.

The production dependency audit is **not clean**: `npm run audit:prod` reported
13 existing transitive findings (five high, eight low) through Trezor dependency
paths, with no automatic fix available. The high findings concern the nested
`toml` dependency; root dependency versions and lockfile are unchanged. This
blocks a green complete release verification and must not be described as a
release-ready security clearance.

No user secrets or live user payment transactions were used as test fixtures.
Live multi-wallet relayed-chain lifecycle testing, physical iPhone checks,
human VoiceOver/NVDA checks, independent contract/circuit review and a complete
clean-worktree release verification remain separate gates. WebKit emulation is
not a physical-device or human assistive-technology result.
