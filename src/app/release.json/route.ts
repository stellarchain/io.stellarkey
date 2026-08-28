import {
  APPLICATION_VERSION,
  BRAND_NAME,
  BUILD_COMMIT,
  BUILD_IS_DIRTY,
} from "@/lib/brand";

export const dynamic = "force-static";

export function GET() {
  return Response.json({
    schemaVersion: 1,
    product: BRAND_NAME,
    version: APPLICATION_VERSION,
    commit: BUILD_COMMIT,
    sourceTree: BUILD_IS_DIRTY ? "modified" : "clean",
    verifiable: !BUILD_IS_DIRTY,
    releaseArtifacts: {
      tag: `v${APPLICATION_VERSION}`,
      inventory: "release-files.json",
      checksums: "SHA256SUMS",
      digestAlgorithm: "SHA-256",
    },
    verification:
      "Compare this full commit SHA and the SHA-256 release-files.json inventory with the corresponding GitHub release.",
  });
}
