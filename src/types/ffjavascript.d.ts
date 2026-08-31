declare module 'ffjavascript' {
  interface CurveGroup {
    F: { n8: number };
    fromRprCompressed(bytes: Uint8Array, offset: number): Uint8Array;
    toRprLEM(bytes: Uint8Array, offset: number, point: Uint8Array): void;
  }

  interface Bn128Curve {
    G1: CurveGroup;
    G2: CurveGroup;
    terminate?(): Promise<void>;
  }

  export function buildBn128(singleThread?: boolean): Promise<Bn128Curve>;
}
