export interface IdleClockSample {
  monotonicMs: number;
  wallMs: number;
}

function forwardElapsed(start: number, end: number): number {
  const elapsed = end - start;
  return Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
}

/**
 * Monotonic time resists wall-clock rollback; wall time continues across device
 * suspend. Taking the larger forward delta preserves both safety properties.
 */
export function idleElapsedMs(start: IdleClockSample, end: IdleClockSample): number {
  return Math.max(
    forwardElapsed(start.monotonicMs, end.monotonicMs),
    forwardElapsed(start.wallMs, end.wallMs),
  );
}
