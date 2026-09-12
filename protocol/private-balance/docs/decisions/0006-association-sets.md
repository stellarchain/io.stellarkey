# ADR 0006: Do Not Add Association Sets to the Current Circuit

## Status
Rejected

## Context
The review proposed a second membership proof against a curated association set. The repository had
neither an association-set curator nor rules for inclusion, exclusion, appeals, root publication,
availability, or user choice. Those policy decisions determine what the proof means; a second Merkle
path alone does not provide a compliance or privacy guarantee.

The constraint cost was validated instead of estimated. Compiling the standalone depth-17 ternary
path in `spikes/circom/association-path.circom` with Circom 2.2.3 and `--O2` produces 4,573
constraints, 53 private inputs, and one public input. Adding only that path to the current
15,114-constraint action projects 19,687 constraints, a 30.26% increase, before policy predicates or root-lifecycle
logic.

## Decision
Do not add association-set membership to the current circuit or ceremony. Reconsider only with a
concrete user requirement and a reviewed governance specification that defines the curator trust
model, root authentication and availability, update cadence, appeals, failure behaviour, and whether
users can select among sets without creating smaller identifiable cohorts.

Any future proposal must compile the complete policy circuit, benchmark physical-phone proving and
Soroban verification, and undergo a new ceremony and independent review. The standalone spike is
measurement evidence, not a production design.

## Consequences
- The current protocol makes no association-set or regulatory-screening claim.
- The proving key and contract avoid an unpriced 30.26% minimum circuit expansion.
- Adding this feature later is an explicit protocol replacement with new artifacts, not a manifest
  toggle.
