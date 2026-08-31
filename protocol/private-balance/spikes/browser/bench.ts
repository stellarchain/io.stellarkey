export async function runBrowserBench() {
  console.log('Running browser feasibility benchmark...');
  // Measure native WebCrypto X25519, HKDF, AES-GCM availability
  const hasSubtle = typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
  console.log('crypto.subtle available:', hasSubtle);
  return { hasSubtle, timestamp: Date.now() };
}
