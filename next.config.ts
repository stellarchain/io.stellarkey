import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const fullCommitPattern = /^[0-9a-f]{40}$/;

function gitOutput(args: string[], cwd = projectRoot): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function resolveBuildCommit(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_BUILD_COMMIT,
    process.env.GITHUB_SHA,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.CF_PAGES_COMMIT_SHA,
  ];
  for (const candidate of candidates) {
    const normalized = candidate?.trim().toLowerCase();
    if (normalized && fullCommitPattern.test(normalized)) return normalized;
  }
  const commit = gitOutput(["rev-parse", "HEAD"]).toLowerCase();
  if (!fullCommitPattern.test(commit)) throw new Error("Unable to derive a full Git build commit.");
  return commit;
}

export function sourceTreeIsDirty(cwd = projectRoot): boolean {
  return gitOutput(["status", "--porcelain", "--untracked-files=all"], cwd) !== "";
}

const buildCommit = resolveBuildCommit();
const buildDirty = sourceTreeIsDirty();
const developmentAssetPrefix = "/__stellarkey-dev-v2";

const nextConfig: NextConfig = {
  output: "export",
  assetPrefix: process.env.NODE_ENV === "production" ? undefined : developmentAssetPrefix,
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: buildCommit,
    NEXT_PUBLIC_BUILD_DIRTY: String(buildDirty),
  },
  experimental: {
    sri: { algorithm: "sha256" },
  },
  // Next 16 blocks dev chunks requested through a LAN hostname unless it is
  // explicitly trusted. Allow this private /24 and the exact local HTTPS name
  // used for phone/tablet testing without trusting arbitrary .local hosts.
  allowedDevOrigins: ["192.168.0.*", "stellarkey.local"],
  turbopack: {
    root: projectRoot,
  },
  poweredByHeader: false,
};

export default nextConfig;
