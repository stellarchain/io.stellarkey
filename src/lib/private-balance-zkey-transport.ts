const MAGIC = 'SKZPC001';
const MAGIC_BYTES = 8;
const ENTRY_BYTES = 14;
const MAX_SEGMENTS = 16;
const MAX_ZKEY_BYTES = 64 * 1024 * 1024;

interface PointSegment {
  outputOffset: number;
  outputByteLength: number;
  kind: 1 | 2;
  count: number;
}

function readMagic(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes.subarray(0, MAGIC_BYTES));
}

export async function expandPointCompressedZkeyTransport(
  transportBuffer: ArrayBuffer,
  expectedRawByteLength: number,
): Promise<ArrayBuffer> {
  const transport = new Uint8Array(transportBuffer);
  if (transport.byteLength < MAGIC_BYTES + 6 || readMagic(transport) !== MAGIC) {
    throw new Error('Point-compressed proving file has an invalid header.');
  }
  const view = new DataView(transport.buffer, transport.byteOffset, transport.byteLength);
  const rawByteLength = view.getUint32(MAGIC_BYTES, true);
  const segmentCount = view.getUint16(MAGIC_BYTES + 4, true);
  if (
    rawByteLength !== expectedRawByteLength ||
    rawByteLength < 1 ||
    rawByteLength > MAX_ZKEY_BYTES
  ) {
    throw new Error('Point-compressed proving file has an invalid expanded size.');
  }
  if (segmentCount < 1 || segmentCount > MAX_SEGMENTS) {
    throw new Error('Point-compressed proving file has an invalid segment count.');
  }
  const headerByteLength = MAGIC_BYTES + 6 + segmentCount * ENTRY_BYTES;
  if (headerByteLength > transport.byteLength) {
    throw new Error('Point-compressed proving file has a truncated segment table.');
  }

  const segments: PointSegment[] = [];
  let entryOffset = MAGIC_BYTES + 6;
  let previousEnd = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    const outputOffset = view.getUint32(entryOffset, true);
    const outputByteLength = view.getUint32(entryOffset + 4, true);
    const kind = view.getUint8(entryOffset + 8);
    const reserved = view.getUint8(entryOffset + 9);
    const count = view.getUint32(entryOffset + 10, true);
    const rawPointBytes = kind === 1 ? 64 : kind === 2 ? 128 : 0;
    if (
      reserved !== 0 ||
      rawPointBytes === 0 ||
      count < 1 ||
      outputByteLength !== count * rawPointBytes ||
      outputOffset < previousEnd ||
      outputOffset + outputByteLength > rawByteLength
    ) {
      throw new Error('Point-compressed proving file has an invalid segment.');
    }
    segments.push({
      outputOffset,
      outputByteLength,
      kind: kind as 1 | 2,
      count,
    });
    previousEnd = outputOffset + outputByteLength;
    entryOffset += ENTRY_BYTES;
  }

  const { buildBn128 } = await import('ffjavascript');
  const curve = await buildBn128(true);
  try {
    const output = new Uint8Array(rawByteLength);
    let inputOffset = headerByteLength;
    let outputCursor = 0;
    for (const segment of segments) {
      const rawGap = segment.outputOffset - outputCursor;
      if (inputOffset + rawGap > transport.byteLength) {
        throw new Error('Point-compressed proving file is truncated.');
      }
      output.set(transport.subarray(inputOffset, inputOffset + rawGap), outputCursor);
      inputOffset += rawGap;

      const group = segment.kind === 1 ? curve.G1 : curve.G2;
      const compressedPointBytes = group.F.n8;
      const compressedByteLength = segment.count * compressedPointBytes;
      if (inputOffset + compressedByteLength > transport.byteLength) {
        throw new Error('Point-compressed proving file has truncated points.');
      }
      for (let index = 0; index < segment.count; index += 1) {
        const point = group.fromRprCompressed(
          transport,
          inputOffset + index * compressedPointBytes,
        );
        group.toRprLEM(
          output,
          segment.outputOffset + index * compressedPointBytes * 2,
          point,
        );
      }
      inputOffset += compressedByteLength;
      outputCursor = segment.outputOffset + segment.outputByteLength;
    }

    const trailingBytes = rawByteLength - outputCursor;
    if (inputOffset + trailingBytes !== transport.byteLength) {
      throw new Error('Point-compressed proving file has an invalid payload length.');
    }
    output.set(transport.subarray(inputOffset), outputCursor);
    return output.buffer;
  } finally {
    if (typeof curve.terminate === 'function') await curve.terminate();
  }
}
