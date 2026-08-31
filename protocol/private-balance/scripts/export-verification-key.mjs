#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const circuitsDir = join(process.cwd(), 'protocol/private-balance/circuits');
execSync('npm run export:vk', { cwd: circuitsDir, stdio: 'inherit' });
