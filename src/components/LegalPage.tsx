import type { ReactNode } from "react";
import { PUBLIC_ROUTES } from "@/lib/brand";
import {
  DocBook,
  DocCheck,
  DocCompass,
  DocCycle,
  DocEyeOff,
  DocFile,
  DocScales,
  DocShield,
} from "./marketing/DocIcons";
import { MarketingFooter, MarketingHeader } from "./marketing/MarketingChrome";
import "./marketing/marketing.css";
import "./marketing/docs.css";

/*
 * The shell every trust-centre document sits in. It shares the marketing
 * layer with the landing page rather than the wallet's iOS system: these are
 * pages you read, not an app you operate.
 */

const navigation = [
  ["about", "About", PUBLIC_ROUTES.about, DocCompass],
  ["privacy", "Privacy", PUBLIC_ROUTES.privacy, DocEyeOff],
  ["terms", "Terms", PUBLIC_ROUTES.terms, DocScales],
  ["security", "Security", PUBLIC_ROUTES.security, DocShield],
  ["support", "Support", PUBLIC_ROUTES.support, DocBook],
  ["changelog", "Changelog", PUBLIC_ROUTES.changelog, DocCycle],
] as const;

export type LegalRoute = (typeof navigation)[number][0];

export interface LegalSectionLink {
  id: string;
  label: string;
}

export function LegalPage({
  current,
  eyebrow,
  title,
  summary,
  highlights,
  sections,
  stamp = "Effective 28 August 2026 · Legal text version 1.1",
  children,
}: {
  current: LegalRoute;
  eyebrow: string;
  title: string;
  summary: string;
  highlights: readonly string[];
  sections: readonly LegalSectionLink[];
  stamp?: string;
  children: ReactNode;
}) {
  const RouteIcon = navigation.find(([id]) => id === current)?.[3] ?? DocFile;

  return (
    <div className="mk">
      <MarketingHeader />

      <main id="app-content">
        <article className="doc">
          <div className="sheet">
            <div className="head legal-hero">
              <p className="mono-label">{eyebrow}</p>
              <h1 className="display-sm doc-title">
                <span className="legal-route-icon" aria-hidden="true">
                  <RouteIcon />
                </span>
                {title}
              </h1>
              <p className="lede">{summary}</p>
              <p className="doc-stamp">{stamp}</p>
            </div>

            <nav aria-label="Trust center navigation" className="doc-tabs">
              {navigation.map(([id, label, href, NavIcon]) => (
                <a key={id} href={href} aria-current={current === id ? "page" : undefined}>
                  <span className="legal-nav-icon" aria-hidden="true">
                    <NavIcon />
                  </span>
                  <span className="legal-nav-label">{label}</span>
                </a>
              ))}
            </nav>

            <ul className="hilite" aria-label="At a glance">
              {highlights.map((highlight) => (
                <li key={highlight}>
                  <span className="legal-highlight-icon" aria-hidden="true">
                    <DocCheck />
                  </span>
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>

            <div className="doc-grid">
              <nav className="toc" aria-label="On this page">
                <h4>On this page</h4>
                {sections.map((section) => (
                  <a key={section.id} href={`#${section.id}`}>{section.label}</a>
                ))}
              </nav>
              <div className="prose">{children}</div>
            </div>
          </div>
        </article>
      </main>

      <MarketingFooter />
    </div>
  );
}
