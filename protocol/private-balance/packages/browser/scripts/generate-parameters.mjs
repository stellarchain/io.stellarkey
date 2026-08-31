import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const parametersPath = join(packageRoot, '../../parameters/poseidon2-bn254-t4-v1.json');
const outputPath = join(packageRoot, 'src/generated/poseidon2-parameters.ts');
const parameters = JSON.parse(readFileSync(parametersPath, 'utf8'));

if (
  parameters.curve !== 'BN254'
  || parameters.width !== 4
  || parameters.rate !== 3
  || parameters.capacity !== 1
  || parameters.sbox_degree !== 5
  || parameters.full_rounds !== 8
  || parameters.partial_rounds !== 56
  || parameters.m_diag.length !== 4
  || parameters.rc.length !== 256
) {
  throw new Error('Unexpected Poseidon2 parameter schema');
}

const source = `// Generated from parameters/poseidon2-bn254-t4-v1.json. Do not edit.\n`
  + `export const POSEIDON2_DIAGONAL = ${JSON.stringify(parameters.m_diag, null, 2)}.map(BigInt) as readonly bigint[];\n`
  + `export const POSEIDON2_ROUND_CONSTANTS = ${JSON.stringify(parameters.rc, null, 2)}.map(BigInt) as readonly bigint[];\n`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, source);
