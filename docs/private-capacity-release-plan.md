# StellarKey 1.5.1 release preparation

Requested scope: fix private commitment capacity, replace the Testnet pool with
fresh state, default to Dark, and restore/update an arXiv-style manuscript.
The original checkout is preserved. Review branch: `release/1.5.1-review`.
Implementation revision: `60dda388a71513724f664fdadcf92dabe5bb01c4`.
The original baseline is `561f716627debab6e72c72c57b1966e572fc3456`.

## Implemented

- Protocol V2 uses one depth-64 ternary root with a private 17+47 path, globally
  positioned nullifiers, exact u128/BigInt counters and canonical decimal storage.
- Proof-bound full-input exits consume one or two notes without appending leaves.
  Normal spends and exits share nullifiers. Archive actions advance independently
  of leaves. Exits remain available with paused deposits and ExitOnly assets.
- Multi-note full withdrawals use disjoint <=2-note exits with explicit per-step
  and cumulative fee approval, a 64-step/15-minute approval bound and canonical
  confirmation before the next step. Partial change still needs commitment slots.
- Scanner, recovery, cache and cross-tab paths preserve exact indices, authenticated
  checkpoints, overlap checks and prior proof-exposure reservations.
- New sessions default to Dark; saved choices persist. Small negative and secondary text contrast
  is corrected on dark raised, tinted and translucent panels.
- Application metadata and changelog prepare 1.5.1. Protocol format is V2; retained
  `v1` asset-directory/spec filenames are paths, not protocol-version assertions.
- The manuscript uses the requested draft attribution and contact, ten primary references,
  conditional security arguments, artifact hashes, raw browser samples and dated
  evidence. PDF and standalone LaTeX are generated from maintained Markdown.

## Fresh evidence (September 13, 2026)

- Gate A passes: 14 circuit tests, eight security mutations, Circomspect and CIVER
  negative controls, 20 CIVER components and 189,994 analysis constraints without
  failure or timeout. Optimized production circuit: 40,594 constraints, 11 public
  and 410 private inputs. Four real Groth16 proof vectors verify.
- Full Rust workspace passes with fresh controlled Stellar Core archive evidence.
  The actual pool test covers saturation, archive index 2^100, mode binding,
  pause/ExitOnly behavior, shared replay rejection and token-failure rollback.
- All 61 browser protocol tests pass, including 1,000 Rust/TypeScript differential
  key/address cases. The full-input multi-note network lifecycle and withdrawal
  driver suite pass 45 tests, including fresh seed-only recovery after exits.
- Focused Chromium/iPhone WebKit regression passes 26 checks after resolving theme
  assumptions and contrast failures. Earlier theme-specific checks passed 13 unit
  and eight browser cases. The six additional real withdrawal-control checks pass; full application verification remains a distinct gate.
- Twelve integrated browser proofs verify; raw samples and artifact hashes are in
  `protocol/private-balance/results/capacity-browser-v2.json`. These are descriptive
  M3 Max smoke measurements, not physical-phone or comparative performance claims.
- Full power-17 PSE Phase 1 transcript verification passes. Phase 2 remains a
  single-party development setup with no public ceremony or independent audit.
- Two fresh canonical macOS ARM64 builds reproduce the R1CS, witness Wasm and
  contract Wasm hashes byte-for-byte. Pool Wasm matches the shipped artifact.
- Fresh XLM/USDC Testnet pool:
  `CAYCV26VCDNUEM6HHKQYHKDJ3O43CK5DCBT3TMMHFVEXE7CIFVWRY4R7`.
  Deployment/registry ledgers 4,647,256 / 4,647,258. Public SDF/Ankr instance reads
  corroborate its Wasm hash at ledger 4,647,534. Historical V1 evidence is retained.

## Release gates and remaining external evidence

The initial clean run found a legacy key-domain constant in backup inspection; the implementation now uses Protocol V2 and 37 focused vault/backup checks pass. Run `npm run release:verify` again from the clean review worktree. Record its commit,
exit status and complete output beside that worktree. This includes generated
artifacts, types, unit/protocol checks, lint, dependency audits, safe-reporter
verification, private UI, the full synthetic component matrix, fixture cleanup,
production build/bundle gates and public browser checks. A focused pass is not a
substitute for this command. No release tag or application deployment is implied.

Broader funded multi-asset lifecycle/fee evidence, independent circuit/contract audit, public
Phase 2 ceremony, physical-phone testing and human VoiceOver/NVDA evidence are
not supplied by the automated application gate. The live-wallet browser runner
correctly blocks usable-wallet sessions because it cannot disable failure DOM
snapshots. Do not bypass that policy to claim a funded browser result.

The capacity fix removes commitment saturation as the sole blocker for full-input
exits. It does not provide unlimited storage, constant-cost cold recovery,
change-producing withdrawals at a full tree, unconditional token redeemability,
or unconditional ledger availability. The deployment remains Testnet development
and is not approved for real value or Mainnet.

A fresh isolated command-line XLM lifecycle confirmed deposit, self-transfer and
full-input exit at ledgers 4,647,770 / 4,647,776 / 4,647,785. Full archive scans
agreed after every transaction; the exit advanced one action with zero leaves
and unchanged root. The paper records the dated fee estimates and exact scope.
The maintained runner requires an explicit Testnet flag and never persists keys,
proof inputs, notes, XDR, wallet addresses or transaction hashes.

The next complete component run passed 631 of 632 tests; one contrast audit
sampled a menu entrance animation. The check now waits for finite entrance
animations; ten repeated Chromium/WebKit checks pass. Restart the complete clean
release command; do not count the interrupted run as a full pass.

The existing held-balance recovery control still constructs a self-transfer and
therefore needs free commitment slots. It does not offer a public full-input exit
for reserved notes; normal withdrawals exclude held inputs. The manuscript now
distinguishes this wallet limitation from the contract's no-append exit result.

A further full run passed all 1,939 application tests and 61 protocol tests, but
failed one recovery-panel contrast check among 632 component tests. Secondary
foreground colors are corrected; 30 repeated Chromium/WebKit recovery and menu
checks pass with no retries. The complete clean gate is being rerun.

## Complete application gate result

The clean `npm run release:verify` run at `9c87935c8fd2f920b286b0a4c0e7c81dd7d9275c`
exited **1** at `check:bundle`. Generated artifacts, typecheck, all 1,939
application tests, 61 protocol tests, lint (three existing warnings), dependency
audits, safe reporter checks, 16 private UI tests, all 632 synthetic component
tests, fixture cleanup, the production build and five bundle tests passed. The
component suite had no failures or retries. The audit reports ten low-severity
vulnerable packages attributable to one distinct advisory, GHSA-848j-6mx2-7j84.

The unchanged artifact gate measures 18,192,388 gzip bytes against 13,000,000 and
a two-version expanded-artifact cache estimate of 53,150,404 bytes against
50,000,000. The transport uses a smaller point-compressed key, but the application
artifact cache currently stores the expanded key. Correcting transport accounting
alone would not resolve the expanded-cache budget failure. This is an unresolved
release blocker; no threshold was raised and the release is not verified or tagged.
The remaining production browser matrix runs separately and cannot turn the
failed complete release command into a pass.

The separate production browser run completed 491 cases: 146 passed, 341
fixture-dependent or project-inapplicable skips, and four failures. Three failures
were the stale September 12 changelog date assertion in Chromium, iPhone WebKit
and iPad WebKit; the assertion now expects the actual September 13 release date.
The fourth was iPad settings-subpage navigation. Targeted repeated checks are
recorded separately; the failed original matrix is retained in the evidence.

All 14 targeted repeated production browser checks then passed with zero retries
and zero skips: the corrected changelog assertion across Chromium, iPhone and
iPad, plus wallet settings across light/dark Chromium, iPhone and iPad. The iPad
settings failure did not recur; its original failed run remains recorded and is
not reclassified as passing. The artifact budget remains unresolved.

## Artifact-cache budget follow-up

The loader and service worker now share one revisioned, hash-keyed cache of the
actual point-compressed transport, witness Wasm and verification-key JSON. The
expanded proving key is checked against its original hash and is no longer
stored in a second persistent cache. One verified public key is retained in RAM
to avoid repeated expansion on warm actions; callers receive independent,
transferable copies. This is a persistent-storage saving, not a claim of lower
peak process memory. No wallet key, proof input or transaction record belongs
to this public-artifact cache.

Only a complete, successfully stored replacement can retire the old public
artifact caches. Failed downloads or quota-denied writes preserve old entries;
superseded loads cannot prune newer revisions. Wallet records are outside these
cache namespaces. Current and previous managed revisions occupy 35,977,416
bytes; actual download files total 10,904,558 gzip bytes. The existing 50,000,000
cache and 13,000,000 gzip limits are unchanged. Legacy migration can temporarily
coexist with the new revision until that verified replacement is complete.
The earlier failed complete runs remain historical evidence; a new clean full
verification run is required for this change before integration.
