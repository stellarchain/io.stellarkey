#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const circuitsDir = join(dirname(fileURLToPath(import.meta.url)), '../circuits');

console.log('Compiling circuits...');
execSync('npm run compile', { cwd: circuitsDir, stdio: 'inherit' });

console.log('Running setup:dev...');
execSync('npm run setup:dev', { cwd: circuitsDir, stdio: 'inherit' });

console.log('Exporting verifier artifacts...');
execSync('npm run export:vk', { cwd: circuitsDir, stdio: 'inherit' });

console.log('✓ Circuit build complete.');
