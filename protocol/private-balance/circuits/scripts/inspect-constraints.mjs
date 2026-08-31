#!/usr/bin/env node
import * as snarkjs from 'snarkjs';
import { join } from 'node:path';

const r1csPath = join(import.meta.dirname, '../build/action.r1cs');

async function inspect() {
  console.log('Inspecting action.r1cs constraints...');
  const r1cs = await snarkjs.r1cs.info(r1csPath);
  console.log('R1CS Info:');
  console.log(`- Curve: ${r1cs.curve.name}`);
  console.log(`- Variables: ${r1cs.nVars}`);
  console.log(`- Constraints: ${r1cs.nConstraints}`);
  console.log(`- Public Inputs: ${r1cs.nPubInputs}`);
  console.log(`- Private Inputs: ${r1cs.nPrvInputs}`);
  console.log(`- Outputs: ${r1cs.nOutputs}`);

  if (r1cs.nPubInputs !== 13) {
    console.error(`Expected 13 public inputs, got ${r1cs.nPubInputs}`);
    process.exit(1);
  }
  if (typeof r1cs.curve.terminate === 'function') {
    await r1cs.curve.terminate();
  }
  console.log('✓ Constraints check passed.');
}

inspect().catch(err => {
  console.error('Inspection failed:', err);
  process.exit(1);
});
