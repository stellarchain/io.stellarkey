import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { arch, platform, cpus } from 'node:os';

const experiment = import.meta.dirname;
const project = join(experiment, '../../../..');
const protocol = join(experiment, '../..');
const startedAt = new Date().toISOString();
const run = (command, args, cwd = project) => execFileSync(command, args, { cwd, stdio: 'inherit' });
const node = file => run(process.execPath, [join(experiment, file)]);
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const list = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? list(path) : [path];
});
// Compare every shipped v1 protocol artifact before and after this experiment.
const published = list(join(project, 'public/protocol/private-balance/v1'));
const before = new Map(published.map(path => [path, digest(path)]));
node('compile.mjs');
run(process.execPath, ['--test', ...['tree', 'circuit', 'recovery'].map(name => join(experiment, `${name}.test.mjs`))]);
node('prove.mjs');
const cli = join(project, 'node_modules/snarkjs/build/cli.cjs');
for (const [name, power] of [['small', 14], ['full', 17]]) {
  const ptau = process.env[`CAPACITY_V2_PTAU_${power}`] ?? join(protocol, `circuits/build/pot${power}_final.ptau`);
  run(process.execPath, [cli, 'zkey', 'verify', join(experiment, `build/${name}/action.r1cs`), ptau, join(experiment, `build/${name}/action_dev.zkey`)]);
}
run('cargo', ['test', '-p', 'private-balance-pool', '--test', 'capacity_v2', '--locked', '--', '--ignored'], protocol);
// Run browser timing without other CPU-intensive verification commands.
node('browser-bench.mjs');
run(process.execPath, ['protocol/private-balance/scripts/verify-artifacts.mjs']);
for (const [path, hash] of before) if (digest(path) !== hash) throw new Error('published v1 artifact changed');
const sourcePaths = [
  ...readdirSync(experiment).filter(name => /\.(mjs|rs)$/.test(name)).map(name => join(experiment, name)),
  ...list(join(experiment, 'circom')),
  ...list(join(protocol, 'circuits/circom')),
  join(protocol, 'Cargo.lock'), join(protocol, 'contracts/pool/Cargo.toml'),
  join(protocol, 'crates/verifier/src/verify.rs'), join(protocol, 'crates/verifier/src/types.rs'),
];
const load = name => JSON.parse(readFileSync(join(experiment, `build/${name}.json`), 'utf8'));
const result = {
  startedAt, finishedAt: new Date().toISOString(),
  status: 'prototype local gate passed; not a production security or release gate',
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim(),
  dirtyPaths: execFileSync('git', ['status', '--short'], { cwd: project, encoding: 'utf8' }).trim().split('\n'),
  host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  versions: { node: process.version, circom: execFileSync('circom', ['--version'], { encoding: 'utf8' }).trim(),
    rustc: execFileSync('rustc', ['--version'], { cwd: protocol, encoding: 'utf8' }).trim(),
    snarkjs: JSON.parse(readFileSync(join(project, 'node_modules/snarkjs/package.json'))).version },
  sourceSha256: Object.fromEntries(sourcePaths.map(path => [relative(project, path), digest(path)])),
  compilation: load('compilation'), proving: load('proving'), browser: load('browser'), contract: load('contract-costs'),
  v1PublishedArtifactsUnchanged: true,
  exclusions: ['physical phone timing and peak memory', 'funded network/Wasm transaction cost', 'independent security audit',
    'production circuit ceremony', 'deployment-bound v2 context and arbitrary recipients', 'production scanner/codec/storage-restoration integration', 'migration'],
};
writeFileSync(join(experiment, 'results.json'), JSON.stringify(result, null, 2) + '\n');
console.log('Capacity prototype gate passed; published v1 artifacts are unchanged.');
