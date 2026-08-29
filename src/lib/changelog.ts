export const CHANGELOG_CATEGORIES = Object.freeze([
  "Added",
  "Changed",
  "Deprecated",
  "Removed",
  "Fixed",
  "Security",
] as const);

export type ChangelogCategoryName = (typeof CHANGELOG_CATEGORIES)[number];

export interface ChangelogCategory {
  readonly name: ChangelogCategoryName;
  readonly entries: readonly string[];
}

export interface ChangelogRelease {
  readonly version: string;
  readonly date: string | null;
  readonly categories: readonly ChangelogCategory[];
}

export interface ChangelogDocument {
  readonly title: "Changelog";
  readonly releases: readonly ChangelogRelease[];
}

interface MutableCategory {
  name: ChangelogCategoryName;
  entries: string[];
}

interface MutableRelease {
  version: string;
  date: string | null;
  categories: MutableCategory[];
}

const SEMVER = "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)";
const RELEASE_HEADING = new RegExp(`^## \\[(Unreleased|${SEMVER})\\](?: - (\\d{4}-\\d{2}-\\d{2}))?$`);
const CATEGORY_NAMES = new Set<string>(CHANGELOG_CATEGORIES);

function fail(lineNumber: number, message: string): never {
  throw new Error(`Invalid changelog at line ${lineNumber}: ${message}`);
}

function validIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateRelease(release: MutableRelease, lineNumber: number): void {
  if (release.categories.length === 0) {
    if (release.version === "Unreleased") return;
    fail(lineNumber, `release ${release.version} is empty`);
  }
  for (const category of release.categories) {
    if (category.entries.length === 0) {
      fail(lineNumber, `category ${category.name} in ${release.version} is empty`);
    }
  }
}

export function parseChangelog(source: string): ChangelogDocument {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError("Changelog source must be a non-empty string.");
  }
  if (source.includes("<") || source.includes(">")) {
    throw new Error("Changelog raw HTML is not supported.");
  }

  const lines = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] !== "# Changelog") {
    fail(1, "the document must begin with # Changelog");
  }

  const releases: MutableRelease[] = [];
  const versions = new Set<string>();
  let release: MutableRelease | null = null;
  let category: MutableCategory | null = null;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (line === "") continue;

    const releaseMatch = RELEASE_HEADING.exec(line);
    if (releaseMatch) {
      if (release) validateRelease(release, lineNumber - 1);
      const [, version, dateValue] = releaseMatch;
      const date = dateValue ?? null;
      if ((version === "Unreleased") !== (date === null)) {
        fail(lineNumber, version === "Unreleased" ? "Unreleased cannot have a date" : "a release date is required");
      }
      if (date && !validIsoDate(date)) fail(lineNumber, `invalid release date ${date}`);
      if (versions.has(version)) fail(lineNumber, `duplicate release ${version}`);
      versions.add(version);
      release = { version, date, categories: [] };
      releases.push(release);
      category = null;
      continue;
    }

    if (line.startsWith("## ")) fail(lineNumber, "malformed release heading");

    if (line.startsWith("### ")) {
      if (!release) fail(lineNumber, "category appears before a release");
      const name = line.slice(4);
      if (!CATEGORY_NAMES.has(name)) fail(lineNumber, `unsupported category ${name}`);
      if (release.categories.some((candidate) => candidate.name === name)) {
        fail(lineNumber, `duplicate category ${name} in ${release.version}`);
      }
      category = { name: name as ChangelogCategoryName, entries: [] };
      release.categories.push(category);
      continue;
    }

    if (line.startsWith("- ")) {
      if (!category) fail(lineNumber, "bullet appears before a category");
      const entry = line.slice(2).trim();
      if (!entry) fail(lineNumber, "empty bullet");
      category.entries.push(entry);
      continue;
    }

    if (!release) {
      if (line.startsWith("#") || line.startsWith("-")) {
        fail(lineNumber, "unsupported introductory structure");
      }
      continue;
    }
    fail(lineNumber, "only category headings and plain bullet entries are supported inside a release");
  }

  if (!release || releases.length === 0) {
    fail(lines.length, "at least one release is required");
  }
  validateRelease(release, lines.length);

  const immutableReleases = Object.freeze(releases.map((item) => Object.freeze({
    version: item.version,
    date: item.date,
    categories: Object.freeze(item.categories.map((group) => Object.freeze({
      name: group.name,
      entries: Object.freeze([...group.entries]),
    }))),
  })));

  return Object.freeze({ title: "Changelog", releases: immutableReleases });
}
