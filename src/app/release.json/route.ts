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
    verification:
      "Compare this full commit SHA with the commit shown by the corresponding GitHub release.",
  });
}
