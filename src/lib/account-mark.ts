const FALLBACK_SEED = "stellarkey-account";

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 0x9e3779b9;
}

function nextState(value: number): number {
  let state = value >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}

/**
 * Creates a stable 5 by 5 mark from a public account key.
 *
 * Every cell is drawn independently rather than mirrored about the centre
 * column. Mirroring is the GitHub identicon convention and it costs a lot
 * here: it halves the pattern to 15 bits and gives every account the same
 * axis of symmetry, so at the 24px the sidebar actually renders, the marks
 * read as variations of one shape instead of twenty-five distinct bits.
 */
export function createAccountMark(seed: string): boolean[] {
  let state = hashSeed(seed || FALLBACK_SEED);
  const cells: boolean[] = [];

  for (let cell = 0; cell < 25; cell += 1) {
    state = nextState(state);
    cells.push((state & 1) === 1);
  }

  if (!cells.some(Boolean)) cells[12] = true;
  return cells;
}

/**
 * The account's tint, as a hue the component builds both the ground and the
 * cells from. A continuous hue rather than an index into five muted swatches:
 * when the pattern softens at small sizes colour carries the difference, and
 * five near-identical pastels could not carry it.
 */
export function createAccountMarkTint(seed: string): { hue: number } {
  const normalizedSeed = seed || FALLBACK_SEED;
  const state = nextState(hashSeed(`${normalizedSeed}:accent`));
  return { hue: state % 360 };
}
