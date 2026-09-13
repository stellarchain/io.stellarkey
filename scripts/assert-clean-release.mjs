import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, "..");
const fullCommitPattern = /^[0-9a-f]{40}$/;

function gitOutput(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function validateReleaseState({ head, status, expectedCommit }) {
  const normalizedHead = head.trim().toLowerCase();
  const normalizedExpected = expectedCommit?.trim().toLowerCase();
  if (!fullCommitPattern.test(normalizedHead)) {
    throw new Error("Release preflight could not resolve a full 40-character HEAD commit.");
  }
  if (status.trim()) {
    throw new Error(
      `Release verification requires a clean Git worktree, including no untracked files:\n${status}`,
    );
  }
  if (normalizedExpected && !fullCommitPattern.test(normalizedExpected)) {
    throw new Error("The supplied release commit is not a full 40-character Git SHA.");
  }
  if (normalizedExpected && normalizedExpected !== normalizedHead) {
    throw new Error(
      `The supplied release commit ${normalizedExpected} does not match HEAD ${normalizedHead}.`,
    );
  }
  return normalizedHead;
}

export function assertCleanRelease({ cwd = defaultRoot, expectedCommit, tag } = {}) {
  const head = gitOutput(["rev-parse", "HEAD"], cwd);
  const status = gitOutput(["status", "--porcelain", "--untracked-files=all"], cwd);
  const commit = validateReleaseState({ head, status, expectedCommit });
  const version = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")).version;
  if (tag && tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} does not match package version v${version}.`);
  }
  return { commit, version };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  const result = assertCleanRelease({
    expectedCommit: argumentValue("--commit") ?? process.env.GITHUB_SHA,
    tag: argumentValue("--tag") ?? process.env.GITHUB_REF_NAME,
  });
  process.stdout.write(`Release preflight passed for v${result.version} at ${result.commit}.\n`);
}
