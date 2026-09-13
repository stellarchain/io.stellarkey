#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

console.log('Running backend-free policy scan...');

const FORBIDDEN_PATTERNS = [
  /express/i,
  /mongoose/i,
  /prisma/i,
  /relayerUrl/i,
  /remoteProver/i,
  /telemetryUrl/i,
  /mixpanel/i,
  /posthog/i,
  /google-analytics/i,
];

function scanDir(dir) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'target' || entry === '.git') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      scanDir(full);
    } else if (stat.isFile() && (full.endsWith('.ts') || full.endsWith('.rs') || full.endsWith('.js') || full.endsWith('.mjs'))) {
      const content = readFileSync(full, 'utf8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          // Check if it's check-no-backend.mjs itself
          if (full.endsWith('check-no-backend.mjs')) continue;
          console.error(`Violation in ${full}: matched ${pattern}`);
          process.exit(1);
        }
      }
    }
  }
}

scanDir(join(process.cwd(), 'protocol/private-balance'));
console.log('✓ No backend violations detected in protocol workspace.');
