# Private Balance recovery

Private Balance has two local-first recovery paths. Neither requires an
application backend.

## Encrypted backup restore

A full StellarKey encrypted backup includes deployment-bound sensitive Private
Balance records but excludes the disposable public cache. Restore authenticates
the complete archive in staging, derives the storage key again from the restored
wallet account, rejects swapped or incompatible deployment records, and rolls
back every browser store if any record fails. Restored notes remain locked until
the current manifest and canonical chain head reconcile.

An encrypted backup preserves local activity metadata, the outgoing-recovery
preference, and possibly exposed proof reservations. Store it separately from
the password, verify it in a fresh browser profile, and never send it to support.

## Seed-only network recovery

The wallet seed can derive the same deployment-bound viewing key. Seed-only
recovery reads the canonical on-chain archive from record zero, verifies every
record hash, rebuilds the authenticated incremental Merkle store,
opens owned ciphertext, authenticates outgoing envelopes, and checks public
nullifiers. It restores spendable value and exact owned amounts. For outgoing
transfers with outgoing recovery enabled when built, it also restores the
external recipient fingerprint and memo from seed plus chain data; the full
reusable private address is intentionally not retained as activity metadata.

If outgoing recovery was explicitly disabled, future outgoing lanes contain
random fixed-size fillers. Owned balances, spent notes and incoming payments
still recover, but those outgoing lanes cannot recover sent recipient or memo
details. Older recovery-enabled records still work regardless of the current
preference. Turning recovery off does not erase old archives or backups. The
preference is local encrypted state: a seed-only restore defaults it to enabled.

Evicted persistent archive records may need a normal Stellar restore-footprint
transaction. The wallet freshly simulates contiguous exact keys and selects the
largest safe prefix within the simulated footprint and an 80%-of-cap
resource-fee budget,
shows the restoration fee separately, applies a cumulative fee ceiling,
waits for final status, rereads each record directly, and reports confirmed-batch
progress in memory. Only the following canonical sync persists the encrypted
scan checkpoint; interruption before that sync safely rescans restored records.
The wallet never restores temporary known-root entries.

## Interrupted actions

Chain transcript and nullifiers are authoritative. Before sharing a spend proof
with a helper or RPC provider, the wallet requires explicit authorization and
durably reserves its inputs. A shared proof is not bound to the later envelope's
source, signature or expiry, and can be reused in a new transaction. Cancellation,
rejection, timeout and an absent nullifier do not make those inputs safe to retry.
Canonical inclusion or a conflicting canonical spend reconciles the reservation;
otherwise it may remain unavailable indefinitely. An unsigned shared preparation
therefore displays status unknown, not a failed or cancelled payment.

Never retry a private spend blindly. Seed-only recovery cannot reconstruct an
unconfirmed shared proof whose local journal was lost. Preserve the encrypted
backup and pending records when recovering an interrupted action. Local work
known never to have disclosed a spend proof can be cancelled safely; legacy
records without that evidence remain conservative.
