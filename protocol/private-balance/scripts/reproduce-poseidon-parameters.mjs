#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const paramsPath = join(process.cwd(), 'protocol/private-balance/parameters/poseidon2-bn254-t4-v1.json');
const raw = readFileSync(paramsPath, 'utf8');
const params = JSON.parse(raw);

if (params.width !== 4 || params.rate !== 3 || params.full_rounds !== 8 || params.partial_rounds !== 56) {
  console.error('Invalid parameter configuration');
  process.exit(1);
}

if (!Array.isArray(params.m_diag) || params.m_diag.length !== 4) {
  console.error('Invalid m_diag length');
  process.exit(1);
}

if (!Array.isArray(params.rc) || params.rc.length !== 256) {
  console.error('Invalid rc length: expected 256, got', params.rc.length);
  process.exit(1);
}

console.log('✓ Poseidon2 BN254 t=4 parameters verified successfully (4 diag elements, 256 round constants).');
