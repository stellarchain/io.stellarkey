import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

// Preserve the exact lock recorded by the existing Testnet deployment. Changes
// below are an explicit maintenance allowlist, not a general dependency filter.
const DEPLOYMENT_LOCK_SHA256 = '312a82fc6626f2bb66b1a24f351f8e13f95bde25fa4de350a8b10d2f4fe7a6b7';
const nobleRecords = {
  'node_modules/@noble/curves': {
    version: '2.3.0',
    resolved: 'https://registry.npmjs.org/@noble/curves/-/curves-2.3.0.tgz',
    integrity: 'sha512-v7cY+4oWYPQszRj6ZFGzTVL7uP2TaLo1xMhWHzYC5wj0ZhOXQ5x+sBre8rF3hi8cAoi0bh1qXoovoOkdFtvqEg==',
    license: 'MIT',
    dependencies: { '@noble/hashes': '2.3.0' },
    engines: { node: '>= 20.19.0' },
    funding: { url: 'https://paulmillr.com/funding/' },
  },
  'node_modules/@noble/curves/node_modules/@noble/hashes': {
    version: '2.3.0',
    resolved: 'https://registry.npmjs.org/@noble/hashes/-/hashes-2.3.0.tgz',
    integrity: 'sha512-oN+QwyX7VSHotibwubG3kpzbwKrfnyR6OOO+3Nk/53ADL7FmgHHz4TgrbaYKvvOw09u6QTx0oiH1cNCIOuN0CQ==',
    license: 'MIT',
    engines: { node: '>= 20.19.0' },
    funding: { url: 'https://paulmillr.com/funding/' },
  },
};

export function verifyHpkeLockMaintenance({
  baselineBytes, currentBytes, applicationLock, browserPackage,
}) {
  const digest = createHash('sha256').update(baselineBytes).digest('hex');
  if (digest !== DEPLOYMENT_LOCK_SHA256) {
    throw new Error('Historical HPKE deployment lock integrity does not match recorded evidence.');
  }

  // These records repair an omission for the dependency already declared by the
  // browser package and installed by the application; they cannot upgrade it.
  if (browserPackage.dependencies?.['@noble/curves'] !== '2.3.0') {
    throw new Error('Noble lock repair must retain the declared application dependency.');
  }
  for (const [path, record] of Object.entries(nobleRecords)) {
    if (!isDeepStrictEqual(applicationLock.packages?.[path], record)) {
      throw new Error('Noble lock repair does not match the reviewed application package.');
    }
  }

  const expected = JSON.parse(baselineBytes);
  expected.packages[''].dependencies['@noble/curves'] = '2.3.0';
  Object.assign(expected.packages, nobleRecords);
  Object.assign(expected.packages['node_modules/brace-expansion'], {
    version: '2.1.7',
    resolved: 'https://registry.npmjs.org/brace-expansion/-/brace-expansion-2.1.7.tgz',
    integrity: 'sha512-uZbew1NqdmPDTMJ8ah1y+b+9QEJrfkXFk3RcTQw3X0jW/xRUvFKsg1CfQdSYGdTbXZWExtU3J3ccxtnfw1Fi0g==',
  });
  const current = JSON.parse(currentBytes);
  if (!isDeepStrictEqual(current, expected)
    || !isDeepStrictEqual(current.packages[''].dependencies, browserPackage.dependencies)
    || !isDeepStrictEqual(current.packages[''].devDependencies, browserPackage.devDependencies)) {
    throw new Error('Browser lock changes exceed the reviewed maintenance of deployment provenance.');
  }
  return digest;
}
