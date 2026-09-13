import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import * as snarkjs from 'snarkjs';
import { scenario } from './fixtures.mjs';

const root = import.meta.dirname;
const cli = join(root, '../../../../node_modules/snarkjs/build/cli.cjs');
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const results = [];
for (const [name, inner, outer, power] of [['small', 1, 1, 14], ['full', 17, 47, 17]]) {
  const out = join(root, 'build', name);
  const ptau = process.env[`CAPACITY_V2_PTAU_${power}`] ?? join(root, `../../circuits/build/pot${power}_final.ptau`);
  // Existing local research transcripts only. Hash provenance is recorded, not
  // represented as a verified multiparty ceremony. NEVER deploy these zkeys.
  execFileSync(process.execPath, [cli, 'groth16', 'setup', join(out, 'action.r1cs'), ptau, join(out, 'action_dev.zkey')], { stdio: 'pipe' });
  const vk = await snarkjs.zKey.exportVerificationKey(join(out, 'action_dev.zkey'));
  writeFileSync(join(out, 'verification_key.json'), JSON.stringify(vk));
  const { frames, alternateExit } = scenario(inner, outer);
  const vectors = [];
  const samples = [];
  for (const frame of frames) {
    const start = performance.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(frame.input, join(out, 'action_js/action.wasm'), join(out, 'action_dev.zkey'));
    samples.push({ name: frame.name, fullProveMs: performance.now() - start });
    if (!await snarkjs.groth16.verify(vk, publicSignals, proof)) throw new Error('prototype proof rejected');
    // Every public signal must be bound, including mode and the externally
    // computed action digest. Mutation never logs the signal or proof content.
    if (frame.name === 'full-input-exit') {
      for (let i = 0; i < publicSignals.length; i++) {
        const bad = [...publicSignals]; bad[i] = String(BigInt(bad[i]) + 1n);
        if (await snarkjs.groth16.verify(vk, bad, proof)) throw new Error(`unbound public signal ${i}`);
      }
    }
    vectors.push({ name: frame.name, proof, publicSignals, checkpoint: frame.checkpoint });
  }
  writeFileSync(join(out, 'vectors.json'), JSON.stringify(vectors));
  const alternate = await snarkjs.groth16.fullProve(alternateExit, join(out, 'action_js/action.wasm'), join(out, 'action_dev.zkey'));
  if (!await snarkjs.groth16.verify(vk, alternate.publicSignals, alternate.proof)) throw new Error('alternate exit proof rejected');
  writeFileSync(join(out, 'alternate-exit.json'), JSON.stringify(alternate));
  results.push({ name, samples, verified: true, publicSignalMutationsRejected: 11,
    setup: 'local development only; not a production ceremony', ptauSha256: sha256(ptau),
    zkeySha256: sha256(join(out, 'action_dev.zkey')), zkeyBytes: statSync(join(out, 'action_dev.zkey')).size,
    wasmBytes: statSync(join(out, 'action_js/action.wasm')).size });
  console.log(`${name}: five proofs verified; eleven public-signal mutations rejected`);
}
writeFileSync(join(root, 'build', 'proving.json'), JSON.stringify(results, null, 2) + '\n');
// snarkjs worker pools otherwise keep the local CLI alive.
process.exit(0);
