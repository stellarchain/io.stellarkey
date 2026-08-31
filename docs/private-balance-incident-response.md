# Private Balance incident response

This playbook supplements the general production runbook. Preserve the last
trusted source commit, release archive, manifest, artifact hashes, RPC evidence,
and timestamps. Never request or collect user secrets.

## Guardian deposit pause

If a credible contract, circuit, artifact, or deployment issue could affect new
funds, the authorized guardian may pause new deposits using the documented,
reviewed contract method. A pause must not block valid transfers or withdrawals.
Publish the exact transaction hash, reason, affected deployment binding, and
recovery guidance through independently controlled channels.

## Manifest or proving-artifact compromise

Stop releases, remove the suspect manifest/artifact set from distribution,
preserve hashes and access logs, revoke affected publishing credentials, and
identify the last reproducible trusted set. Do not silently replace bytes at an
existing artifact version. A correction needs a new artifact version, hashes,
evidence, and wallet release.

## Contract or circuit issue

Disable wallet activation and spend construction for the affected deployment.
Determine whether the issue affects deposits, transfers, withdrawals, proof
soundness, recovery, or only availability. Do not promise reversals. Coordinate
an independent review and publish a migration or withdrawal plan only after its
authorization and privacy consequences are understood.

## RPC inconsistency

Fail closed, retain the last encrypted verified checkpoint, and compare the same
ledger keys and archive head through another network-matched RPC. Never merge
conflicting transcripts or mark a balance current from an event feed alone.

## Lost local state

Direct the user to an encrypted backup restore or seed-only recovery. Explain
restoration fees before signing. Support may use public hashes and error codes to
help diagnose progress, but cannot reconstruct notes from screenshots, private
addresses, viewing keys, plaintext notes, or backups.
