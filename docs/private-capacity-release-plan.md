# StellarKey 1.5.1 release preparation

Requested scope: fix private commitment capacity, replace the Testnet pool with
fresh state, default to Dark, and restore/update an arXiv-style manuscript.
The original checkout is preserved. Review branch: `release/1.5.1-review`.
Implementation revision: `3db4acef58989f899c706a1fc256e33d5e65871c`.
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
- New sessions default to Dark; saved choices persist. Small negative text contrast
  is corrected on dark raised and tinted panels.
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
  and eight browser cases. Full application verification remains a distinct gate.
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

Run `npm run release:verify` from the clean review worktree. Record its commit,
exit status and complete output beside that worktree. This includes generated
artifacts, types, unit/protocol checks, lint, dependency audits, safe-reporter
verification, private UI, the full synthetic component matrix, fixture cleanup,
production build/bundle gates and public browser checks. A focused pass is not a
substitute for this command. No release tag or application deployment is implied.

Funded V2 lifecycle/fee evidence, independent circuit/contract audit, public
Phase 2 ceremony, physical-phone testing and human VoiceOver/NVDA evidence are
not supplied by the automated application gate. The live-wallet browser runner
correctly blocks usable-wallet sessions because it cannot disable failure DOM
snapshots. Do not bypass that policy to claim a funded browser result.

The capacity fix removes commitment saturation as the sole blocker for full-input
exits. It does not provide unlimited storage, constant-cost cold recovery,
change-producing withdrawals at a full tree, unconditional token redeemability,
or unconditional ledger availability. The deployment remains Testnet development
and is not approved for real value or Mainnet.
