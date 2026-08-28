/**
 * Emits the five trust-centre route files from the converted documents.
 * Anything that has to track the build — release, commit, contact address —
 * is bound to the brand contract here rather than frozen into the copy.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SP = process.argv[2];
const doc = (r) => JSON.parse(readFileSync(`${SP}/legal-out/${r}.json`, "utf8"));

const DESCRIPTIONS = {
  about: "How StellarKey keeps Stellar keys and records under your control without an application backend.",
  privacy: "What stays on your device, what your browser sends to the Stellar services you pick, and what a public ledger reveals.",
  terms: "The terms for using StellarKey: self-custody, irreversible transactions, third parties, and the limits of the software.",
  security: "The threat model, the cryptography, the browser hardening, and how to report a vulnerability.",
  support: "How to get help, what is safe to send, and what nobody can do for you once a key is lost.",
};

/* every brand value a document may bind; imported only where it is used */
const BRAND_VALUES = [
  "APPLICATION_VERSION", "BUILD_COMMIT", "BUILD_IS_DIRTY",
  "SOURCE_COMMIT_URL", "SOURCE_RELEASE_URL", "SOURCE_REPOSITORY_URL",
];

/* copy the artifact froze that must instead follow the build */
const BINDINGS = [
  [/release 1\.0\.0/g, "release {APPLICATION_VERSION}"],
  [/StellarKey 1\.0\.0/g, "StellarKey {APPLICATION_VERSION}"],
  [/<p>Full build commit<\/p><p>e164e4f3e601eeb0c5e56a0c8a2df937e0bce830<\/p>/g,
    '<p className="doc-stamp">Full build commit</p>\n<code className="commit">{BUILD_COMMIT}</code>'],
  [/e164e4f3e601eeb0c5e56a0c8a2df937e0bce830/g, "{BUILD_COMMIT}"],
  [/Compare this full 40-character SHA with the published source commit and its corresponding GitHub release\. The same identity is available as machine-readable JSON at \/release\.json\. This local build contains tracked changes beyond that commit and is not source-verifiable\./g,
    'Compare this full 40-character SHA with the <a href={SOURCE_COMMIT_URL}>published source commit</a> and its <a href={SOURCE_RELEASE_URL}>corresponding GitHub release</a>. The same identity is available as machine-readable JSON at <a href="/release.json">/release.json</a>.{BUILD_IS_DIRTY ? " This local build carries tracked changes beyond that commit, so it is not source-verifiable." : " A clean manifest ties this build to that exact tracked source revision."}'],
  [/You can inspect the source repository/g, 'You can inspect the <a href={SOURCE_REPOSITORY_URL}>source repository</a>'],
  // the contact addresses are assembled on click, never written into the markup
  [/<p>Email the security team<\/p>/g, '<p><ContactAction channel="security">Email the security team</ContactAction></p>'],
  [/<p>Email the support team<\/p>/g, '<p><ContactAction channel="support">Email the support team</ContactAction></p>'],
  [/<p>Email support<\/p>/g, '<p><ContactAction channel="support">Email support</ContactAction></p>'],
];

const ROUTES = ["about", "privacy", "terms", "security", "support"];
const pascal = (r) => r[0].toUpperCase() + r.slice(1);

for (const route of ROUTES) {
  const d = doc(route);
  let prose = d.prose;
  for (const [re, to] of BINDINGS) prose = prose.replace(re, to);

  const usesContact = prose.includes("<ContactAction");
  const brand = ["PUBLIC_OPEN_GRAPH_IMAGE", "PUBLIC_ROUTES",
    ...BRAND_VALUES.filter((v) => new RegExp("\\b" + v + "\\b").test(prose))].sort();
  const icons = [...new Set(prose.match(/<Doc[A-Za-z]+ \/>/g) || [])]
    .map((t) => t.slice(1, -3).trim()).sort();

  const lines = prose.replace(/><section /g, ">\n\n<section ").replace(/<\/section>/g, "</section>")
    .split("\n").map((l) => (l.trim() ? "        " + l.trim() : "")).join("\n");

  writeFileSync(`src/app/${route}/page.tsx`,
`import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
${usesContact ? 'import { ContactAction } from "@/components/ContactAction";\n' : ""}import {
${brand.map((b) => `  ${b},`).join("\n")}
} from "@/lib/brand";
import {
${icons.map((i) => `  ${i},`).join("\n")}
} from "@/components/marketing/DocIcons";

const description =
  ${JSON.stringify(DESCRIPTIONS[route])};

const highlights = [
${d.highlights.map((h) => `  ${JSON.stringify(h)},`).join("\n")}
] as const;

const sections = [
${d.sections.map((s) => `  { id: ${JSON.stringify(s.id)}, label: ${JSON.stringify(s.label)} },`).join("\n")}
] as const;

export const metadata: Metadata = {
  title: ${JSON.stringify(d.title)},
  description,
  alternates: { canonical: PUBLIC_ROUTES.${route} },
  openGraph: {
    type: "article",
    url: PUBLIC_ROUTES.${route},
    title: ${JSON.stringify(d.title)},
    description,
    images: [PUBLIC_OPEN_GRAPH_IMAGE],
  },
};

export default function ${pascal(route)}Page() {
  return (
    <LegalPage
      current="${route}"
      eyebrow=${JSON.stringify(d.eyebrow)}
      title=${JSON.stringify(d.title)}
      summary=${JSON.stringify(d.lede)}
      highlights={highlights}
      sections={sections}
    >
${lines}
    </LegalPage>
  );
}
`);
  console.log(`${route.padEnd(9)} icons=${icons.length} hi=${d.highlights.length} toc=${d.sections.length} contact=${usesContact}`);
}
