import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = import.meta.dirname;
const results = [];
for (const [name, inner, outer] of [['small', 1, 1], ['full', 17, 47]]) {
  const out = join(root, 'build', name);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'action.circom'), `pragma circom 2.1.6;\ninclude "../../circom/action.circom";\ncomponent main {public [contextField, assetField, actionKindField, anchorRoot, publicValueField, actionField, nullifier, outputCommitment]} = CapacityAction(${inner}, ${outer});\n`);
  const output = execFileSync('circom', [join(out, 'action.circom'), '--r1cs', '--wasm', '--O2', '-o', out], { encoding: 'utf8' });
  const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  results.push({ name, inner, outer, constraints: Number(output.match(/non-linear constraints: (\d+)/)[1]), r1csSha256: digest(join(out, 'action.r1cs')), wasmSha256: digest(join(out, 'action_js/action.wasm')) });
}
writeFileSync(join(root, 'build', 'compilation.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results));
