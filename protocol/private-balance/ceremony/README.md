# Private Balance Groth16 ceremony

## Current status

The replacement protocol is deployed in one explicitly enabled governed pool for XLM and USDC on
Testnet. It uses single-party development proving material. No file in this directory is
testnet-beta, audit, production, or mainnet approval. A public multi-contributor phase-2 ceremony and an
independent transcript verification are mandatory before a testnet beta can hold external funds.
Mainnet requires a separate go/no-go record and a newly approved ceremony; testnet artifacts are
never promoted automatically.

The current development candidate is:

| Field | Value |
| --- | --- |
| Circuit | `circuits/circom/action.circom` |
| Circom | `2.2.3` |
| R1CS constraints | 40,594 (machine value: `40594`) |
| Public inputs | 11 |
| R1CS SHA-256 | `b59eaddeb2ec6eac403d2c2adee693ea2446abb094edcdd6f309456e1d77ae2f` |
| Development zkey SHA-256 | `6082d74328d861e5a2247083ec9e83f642b61fa89aef8b297f235d43ec1f07f0` |
| Development verifying-key JSON SHA-256 | `960b480dd4a10580e9e55e284eabdae072a359623b7530dd3bf40a399d64accf` |
| Embedded verifying-key binary SHA-256 | `4c39e247db8e932695e881041e94337d28858208f04b477b32d51604bb3c03bc` |

These values identify the hash-pinned local candidate; they do not make its zkey suitable
for a beta. Regenerate this table from the shipped manifest and artifacts whenever the circuit changes.

The protocol-v2 circuit uses a 17+47 private membership path and proof-bound
full-input exits. Its Phase 1 input is the published PSE transcript
`ppot_0080_17.ptau` (151,088,274 bytes), SHA-256
`f807e065fde53f72f4bf4d57140fab85b26daa6cc95bdfec7cce93622b3a367c`.
Full `snarkjs powersoftau verify` succeeded on 2026-09-13. The freshly generated
Phase 2 remains a single-party development setup with no public ceremony.

## Invalidation rule

Freeze the circuit source and R1CS before accepting contributions. Any circuit, compiler, proof
parameter, verification-key export, verifier, or security-relevant build change after the ceremony
invalidates the affected evidence. Discard the phase-2 output, rebuild from the reviewed source,
repeat the ceremony, repeat the affected independent reviews, and redeploy. Never patch a signed
manifest in place.

## Roles

- The coordinator publishes the frozen inputs, commands, tool versions, hashes, contribution order,
  public beacon source, and append-only transcript.
- Each contributor verifies the incoming transcript and R1CS, contributes entropy on a machine they
  control, verifies the outgoing transcript, and publishes an attestation plus input/output hashes.
  Contributor entropy, seeds, shell history, and private machine data must never enter this repo.
- An independent verifier who did not coordinate the ceremony rebuilds the R1CS from the pinned
  commit, verifies every contribution and the final beacon, exports the verification key, and
  reproduces the final hashes from a clean environment.

At least two independent cryptography/protocol reviewers must also sign the written protocol and
threat model. Ceremony participation is not a substitute for the Gate A cryptographic review or the
Gate B/C contract, recovery, browser-crypto, vault/worker, and transaction-safety audits.

## Coordinator workflow

1. From a clean checkout, install locked dependencies and verify the candidate:

   ```sh
   npm ci
   npm --prefix protocol/private-balance/circuits ci
   npm --prefix protocol/private-balance/circuits run compile
   npm run private:gate-a
   ```

   Gate A runs two independent analysis stages before every proof vector and mutation:

   - Circom `--inspect --O2` plus Circomspect `0.9.0` for static diagnostics; and
   - CIVER at source commit `af7d4ed0325e6f7743d8a1ac0e415d0c69b8aae8` for modular
     weak-safety verification of the `--O2` circuit.

   Both stages must catch the intentionally under-constrained fixture. The CIVER stage requires
   every production component and constraint to verify with zero failures and zero timeouts. The
   runner parses those counters because CIVER itself exits zero after an unsafe or timed-out
   analysis.

   Install Circomspect with:

   ```sh
   cargo install circomspect --version 0.9.0 --locked
   ```

   Build the pinned CIVER executable in a separate tools directory:

   ```sh
   git clone https://github.com/costa-group/circom_civer.git
   cd circom_civer
   git checkout af7d4ed0325e6f7743d8a1ac0e415d0c69b8aae8
   cargo build --release -p civer_circom
   git rev-parse HEAD
   ```

   CIVER's pinned manifest enables its bundled Z3 4.8.12. On current macOS/Apple Clang, use the
   same CIVER commit with Homebrew Z3: install `z3`, remove only the `features = ["static-link-z3"]`
   portion from `dag/Cargo.toml`, and build with Homebrew's `include` and `lib` directories in
   `CPATH` and `LIBRARY_PATH`. This changes dependency linkage, not CIVER's analyzer source.

   Run the complete gate with the executable and source evidence made explicit:

   ```sh
   CIVER_CIRCOM=/absolute/path/to/circom_civer/target/release/civer_circom \
   CIVER_SOURCE_COMMIT=af7d4ed0325e6f7743d8a1ac0e415d0c69b8aae8 \
   npm run private:gate-a
   ```

2. Obtain a sufficiently large, independently verified BN254 Powers of Tau transcript. Record its
   origin, download URL, byte length, and SHA-256. Verify it before use. The development setup pins
   PSE's degree-14 Perpetual Powers of Tau artifact `ppot_0080_14.ptau` at SHA-256
   `3ca1149e9349b22b0ee0649399cfb787677129b7b1189d1899fc0d615d9583db`; the final coordinator must
   still revalidate the source and contribution chain rather than trusting a filename.

3. In `protocol/private-balance/circuits`, initialize phase 2 against the frozen R1CS:

   ```sh
   npx --no-install snarkjs groth16 setup build/action.r1cs <verified-pot14.ptau> ../ceremony/v1/action_0000.zkey
   ```

4. Pass each transcript to a contributor through an authenticated channel. Each contributor runs an
   interactive contribution locally and returns the result plus an attestation:

   ```sh
   npx --no-install snarkjs zkey verify build/action.r1cs <verified-pot14.ptau> ../ceremony/v1/action_0000.zkey
   npx --no-install snarkjs zkey contribute ../ceremony/v1/action_0000.zkey ../ceremony/v1/action_0001.zkey --name="<public contributor name>" -v
   ```

   Increment the output suffix for every contributor. Do not provide contribution entropy on a
   shared command line, in CI, or in a committed file.

5. After the announced contribution window, derive a public unpredictable beacon from a source that
   did not exist when contributions began. Record the source, retrieval time, exact bytes, and
   SHA-256 in `beacon.txt`, then apply it:

   ```sh
   npx --no-install snarkjs zkey beacon ../ceremony/v1/action_last.zkey ../ceremony/v1/action_final.zkey <beacon-hex> 10 --name="StellarKey Private Balance V1 final beacon"
   ```

6. Verify and export the final key:

   ```sh
   npx --no-install snarkjs zkey verify build/action.r1cs <verified-pot14.ptau> ../ceremony/v1/action_final.zkey
   npx --no-install snarkjs zkey export verificationkey ../ceremony/v1/action_final.zkey ../ceremony/v1/verification_key.json
   ```

## Required public evidence

Create `ceremony/v1/` only for the real ceremony. It must contain:

- `manifest.json`: frozen source commit, R1CS/tool/Powers-of-Tau hashes, commands, ordered
  contribution hashes, beacon hash, final zkey and verification-key hashes, dates, and coordinators;
- `contributors/`: one signed or otherwise authenticated public attestation per contribution;
- `beacon.txt`: beacon source, observation time, exact input, rounds, and hash; and
- `verification.txt`: clean-room commands, versions, hashes, proof-vector results, verifier identity,
  and an explicit pass/fail conclusion.

Never commit contributor entropy. Do not label the manifest `testnet-beta` until the independent
verifier and Gate A/B/C reviewers have approved the same final bytes.

## After independent verification

Replace the development zkey and verification key with the verified final artifacts, regenerate the
embedded verifier, build twice from clean pinned environments, and compare every hash. Then deploy
the exact manifest-pinned Stellar CLI-compatible Wasm, independently verify its append-only asset
registry, configuration, executable type, guardian, administrator, and transaction hashes, and rerun final Gate 0 plus the
complete Task 26 browser/recovery suite. Record all evidence in the immutable testnet manifest.
