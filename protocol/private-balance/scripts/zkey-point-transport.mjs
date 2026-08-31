import { buildBn128 } from 'ffjavascript';

const MAGIC = Buffer.from('SKZPC001', 'ascii');
const POINT_SECTIONS = new Map([
  [3, 1],
  [5, 1],
  [6, 1],
  [7, 2],
  [8, 1],
  [9, 1],
]);
const ENTRY_BYTES = 14;

function parseSections(raw) {
  if (raw.byteLength < 12 || raw.subarray(0, 4).toString('ascii') !== 'zkey') {
    throw new Error('Point-compressed transport input is not a zkey file');
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const sectionCount = view.getUint32(8, true);
  if (sectionCount < 1 || sectionCount > 64) throw new Error('Invalid zkey section count');
  const sections = new Map();
  let offset = 12;
  for (let index = 0; index < sectionCount; index += 1) {
    if (offset + 12 > raw.byteLength) throw new Error('Truncated zkey section header');
    const id = view.getUint32(offset, true);
    const sizeBig = view.getBigUint64(offset + 4, true);
    if (sizeBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Oversized zkey section');
    const size = Number(sizeBig);
    const payloadOffset = offset + 12;
    if (size < 0 || payloadOffset + size > raw.byteLength) {
      throw new Error('Truncated zkey section payload');
    }
    if (sections.has(id)) throw new Error(`Duplicate zkey section ${id}`);
    sections.set(id, { id, offset: payloadOffset, size });
    offset = payloadOffset + size;
  }
  if (offset !== raw.byteLength) throw new Error('Unexpected bytes after zkey sections');
  return sections;
}

export async function encodePointCompressedZkey(input) {
  const raw = Buffer.isBuffer(input)
    ? input
    : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (raw.byteLength > 0xffff_ffff) throw new Error('Zkey exceeds the transport size limit');
  const sections = parseSections(raw);
  const segments = [...POINT_SECTIONS]
    .map(([id, kind]) => {
      const section = sections.get(id);
      if (!section) throw new Error(`Zkey point section ${id} is missing`);
      const pointBytes = kind === 1 ? 64 : 128;
      if (section.size === 0 || section.size % pointBytes !== 0) {
        throw new Error(`Zkey point section ${id} has an invalid size`);
      }
      return { ...section, kind, count: section.size / pointBytes };
    })
    .sort((left, right) => left.offset - right.offset);

  const header = Buffer.alloc(MAGIC.byteLength + 4 + 2 + segments.length * ENTRY_BYTES);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(raw.byteLength, MAGIC.byteLength);
  header.writeUInt16LE(segments.length, MAGIC.byteLength + 4);
  let entryOffset = MAGIC.byteLength + 6;
  for (const segment of segments) {
    header.writeUInt32LE(segment.offset, entryOffset);
    header.writeUInt32LE(segment.size, entryOffset + 4);
    header.writeUInt8(segment.kind, entryOffset + 8);
    header.writeUInt8(0, entryOffset + 9);
    header.writeUInt32LE(segment.count, entryOffset + 10);
    entryOffset += ENTRY_BYTES;
  }

  const curve = await buildBn128(true);
  try {
    const payload = [];
    let rawOffset = 0;
    for (const segment of segments) {
      payload.push(raw.subarray(rawOffset, segment.offset));
      const group = segment.kind === 1 ? curve.G1 : curve.G2;
      const rawPointBytes = group.F.n8 * 2;
      const compressedPointBytes = group.F.n8;
      const compressed = Buffer.alloc(segment.count * compressedPointBytes);
      for (let index = 0; index < segment.count; index += 1) {
        const point = group.fromRprLEM(raw, segment.offset + index * rawPointBytes);
        group.toRprCompressed(compressed, index * compressedPointBytes, point);
      }
      payload.push(compressed);
      rawOffset = segment.offset + segment.size;
    }
    payload.push(raw.subarray(rawOffset));
    return Buffer.concat([header, ...payload]);
  } finally {
    if (typeof curve.terminate === 'function') await curve.terminate();
  }
}
