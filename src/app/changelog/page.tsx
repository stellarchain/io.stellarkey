import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";

import { LegalPage } from "@/components/LegalPage";
import { DocCycle } from "@/components/marketing/DocIcons";
import {
  PUBLIC_OPEN_GRAPH_IMAGE,
  PUBLIC_ROUTES,
  SOURCE_REPOSITORY_URL,
} from "@/lib/brand";
import { parseChangelog, type ChangelogRelease } from "@/lib/changelog";

const description =
  "Source-controlled release notes for StellarKey features, fixes, security changes, and removals.";

const changelog = parseChangelog(
  readFileSync(path.join(process.cwd(), "CHANGELOG.md"), "utf8"),
);

const highlights = [
  "Release notes come from the tracked changelog in the public source repository.",
  "Published entries are retained as history; factual corrections are made transparently.",
  "Checksums, attestations, and the embedded commit remain the evidence for a deployed build.",
] as const;

function releaseId(release: ChangelogRelease): string {
  return `release-${release.version.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

const sections = changelog.releases.map((release) => ({
  id: releaseId(release),
  label: release.version,
}));

function formatReleaseDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Changelog",
  description,
  alternates: { canonical: PUBLIC_ROUTES.changelog },
  openGraph: {
    type: "article",
    url: PUBLIC_ROUTES.changelog,
    title: "StellarKey changelog",
    description,
    images: [PUBLIC_OPEN_GRAPH_IMAGE],
  },
};

export default function ChangelogPage() {
  return (
    <LegalPage
      current="changelog"
      eyebrow="source controlled // release history"
      title="Changelog"
      summary="A plain-language record of user-visible changes, security work, dependency updates, and removals in each StellarKey release."
      stamp="Tracked in source · verified builds retain their own checksums and commit"
      highlights={highlights}
      sections={sections}
    >
      <p className="changelog-intro">
        Read the canonical file and its history in the{" "}
        <a href={SOURCE_REPOSITORY_URL}>source repository</a>. This page is generated from that
        trusted file during the static build; it does not fetch release notes at runtime.
      </p>
      {changelog.releases.map((release) => (
        <section className="changelog-release" id={releaseId(release)} key={release.version}>
          <div className="changelog-release-heading">
            <h2><DocCycle />{release.version}</h2>
            {release.date && (
              <time dateTime={release.date}>{formatReleaseDate(release.date)}</time>
            )}
          </div>
          {release.categories.map((category) => (
            <div className="changelog-category" key={category.name}>
              <h3>{category.name}</h3>
              <ul className="prose-list">
                {category.entries.map((entry) => <li key={entry}>{entry}</li>)}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </LegalPage>
  );
}
