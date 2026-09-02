export interface BrowserProverDevice {
  class: 'desktop' | 'phone' | 'emulator';
  manufacturer: string;
  model: string;
}

export interface BrowserProverCapabilities {
  wasmSimd: boolean;
  wasmThreads: boolean;
  crossOriginIsolated: boolean;
  provingKeyStreaming: boolean;
  nativeMobileProver: boolean;
}

export interface BrowserContractMetrics {
  status: 'measured' | 'pending';
  instructions: number | null;
  readBytes: number | null;
  writeBytes: number | null;
  resourceFeeStroops: string | null;
  transactionBytes: number | null;
  reason: string;
}

export interface BrowserProverBenchmarkInput {
  curve: 'bn254' | 'bls12-381';
  iterations: number;
  physicalDevice: boolean;
  device: BrowserProverDevice;
  capabilities: BrowserProverCapabilities;
  physicalAttestation?: {
    operator: string;
    observedAt: string;
    evidenceSha256: string;
  };
  prove(): Promise<{ proofJsonBytes: number; canonicalUncompressedBytes: number }>;
  verify(): Promise<boolean>;
  contract: BrowserContractMetrics;
}

export interface BrowserProverBenchmarkResult {
  curve: 'bn254' | 'bls12-381';
  evidenceKind: 'browser-smoke' | 'physical-device';
  physicalDevice: boolean;
  physicalAttestation: {
    operator: string;
    observedAt: string;
    evidenceSha256: string;
  } | null;
  device: BrowserProverDevice & {
    browser: { name: string; version: string; userAgent: string };
  };
  capabilities: BrowserProverCapabilities;
  proving: {
    samplesMs: number[];
    p50Ms: number;
    p95Ms: number;
    peakMemoryBytes: number;
  };
  verification: {
    samplesMs: number[];
    p50Ms: number;
    p95Ms: number;
  };
  proof: {
    jsonBytes: number;
    canonicalUncompressedBytes: number;
    verified: true;
  };
  contract: BrowserContractMetrics;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new Error(`${name} must be an integer from 1 through 100.`);
  }
  return value;
}

function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) throw new Error('Browser proving samples are empty.');
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return Number(sorted[index].toFixed(3));
}

function browserIdentity(): { name: string; version: string; userAgent: string } {
  const userAgent = navigator.userAgent;
  const candidates: Array<[string, RegExp]> = [
    ['Edge', /Edg\/([0-9.]+)/],
    ['Chrome', /(?:Chrome|CriOS)\/([0-9.]+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/([0-9.]+)/],
    ['Safari', /Version\/([0-9.]+).*Safari/],
  ];
  for (const [name, pattern] of candidates) {
    const match = userAgent.match(pattern);
    if (match) return { name, version: match[1], userAgent };
  }
  return { name: 'Unknown browser', version: 'unknown', userAgent };
}

function usedHeapBytes(): number {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  }).memory;
  return Number.isSafeInteger(memory?.usedJSHeapSize) ? memory!.usedJSHeapSize! : 1;
}

function validatePhysicalClaim(input: BrowserProverBenchmarkInput): void {
  if (!input.physicalDevice) {
    if (input.device.class === 'phone') {
      throw new Error('A non-physical phone run must be labelled as an emulator.');
    }
    return;
  }
  if (
    input.device.class !== 'phone' ||
    !input.device.manufacturer.trim() ||
    !input.device.model.trim() ||
    !input.physicalAttestation?.operator.trim() ||
    !Number.isFinite(Date.parse(input.physicalAttestation.observedAt)) ||
    !/^[0-9a-f]{64}$/.test(input.physicalAttestation.evidenceSha256) ||
    !/(Android|iPhone|iPad|Mobile)/i.test(navigator.userAgent)
  ) {
    throw new Error('Physical-device evidence requires an attested physical phone and mobile browser.');
  }
}

export async function benchmarkBrowserProver(
  input: BrowserProverBenchmarkInput,
): Promise<BrowserProverBenchmarkResult> {
  const iterations = positiveInteger(input.iterations, 'Browser benchmark iterations');
  validatePhysicalClaim(input);
  const provingSamples: number[] = [];
  const verificationSamples: number[] = [];
  let peakMemoryBytes = usedHeapBytes();
  let proofJsonBytes = 0;
  let canonicalUncompressedBytes = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const proveStarted = performance.now();
    const proof = await input.prove();
    const proveFinished = performance.now();
    provingSamples.push(proveFinished - proveStarted);
    peakMemoryBytes = Math.max(peakMemoryBytes, usedHeapBytes());
    proofJsonBytes = proof.proofJsonBytes;
    canonicalUncompressedBytes = proof.canonicalUncompressedBytes;

    const verifyStarted = performance.now();
    const verified = await input.verify();
    const verifyFinished = performance.now();
    if (!verified) throw new Error('Browser curve benchmark produced an invalid proof.');
    verificationSamples.push(verifyFinished - verifyStarted);
  }

  return {
    curve: input.curve,
    evidenceKind: input.physicalDevice ? 'physical-device' : 'browser-smoke',
    physicalDevice: input.physicalDevice,
    physicalAttestation: input.physicalDevice ? { ...input.physicalAttestation! } : null,
    device: { ...input.device, browser: browserIdentity() },
    capabilities: { ...input.capabilities },
    proving: {
      samplesMs: provingSamples.map(value => Number(value.toFixed(3))),
      p50Ms: percentile(provingSamples, 0.5),
      p95Ms: percentile(provingSamples, 0.95),
      peakMemoryBytes,
    },
    verification: {
      samplesMs: verificationSamples.map(value => Number(value.toFixed(3))),
      p50Ms: percentile(verificationSamples, 0.5),
      p95Ms: percentile(verificationSamples, 0.95),
    },
    proof: {
      jsonBytes: proofJsonBytes,
      canonicalUncompressedBytes,
      verified: true,
    },
    contract: { ...input.contract },
  };
}
