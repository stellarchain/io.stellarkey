<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# StellarKey release history rules

- Update `[Unreleased]` in `CHANGELOG.md` in the same commit for user-visible behavior, security posture, dependency changes, stored-data or deployment behavior, and removals.
- Use the Added/Changed/Deprecated/Removed/Fixed/Security categories. Keep entries factual, concise, and understandable without reading the diff.
- During release preparation, choose the next version by Semantic Versioning impact, move the accumulated entries into `[x.y.z] - YYYY-MM-DD`, and recreate an `[Unreleased]` section. Leave it empty instead of adding placeholder release notes when no later work exists.
- Update `package.json`, both root version fields in `package-lock.json`, `APPLICATION_VERSION` in `src/lib/brand.ts`, the current-release marker in `README.md`, the supported series in `SECURITY.md`, and exact version tests together.
- Never rewrite a published entry except to correct a factual error transparently.
- Keep one logical feature per commit and run its focused tests. Run `npm run release:verify` from a clean worktree before tagging a release.
