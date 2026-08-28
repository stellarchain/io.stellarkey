import type { ReactNode } from "react";
import { BRAND_NAME, PUBLIC_ROUTES } from "@/lib/brand";
import {
  IconBook,
  IconCheck,
  IconChevronDown,
  IconCompass,
  IconEyeOff,
  IconFileText,
  IconFingerprint,
  IconList,
  LogoMark,
} from "./icons";
import { PublicFooter } from "./PublicFooter";

const navigation = [
  ["about", "About", PUBLIC_ROUTES.about, IconCompass],
  ["privacy", "Privacy", PUBLIC_ROUTES.privacy, IconEyeOff],
  ["terms", "Terms", PUBLIC_ROUTES.terms, IconFileText],
  ["security", "Security", PUBLIC_ROUTES.security, IconFingerprint],
  ["support", "Support", PUBLIC_ROUTES.support, IconBook],
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
  children,
}: {
  current: LegalRoute;
  eyebrow: string;
  title: string;
  summary: string;
  highlights: readonly string[];
  sections: readonly LegalSectionLink[];
  children: ReactNode;
}) {
  const ActiveRouteIcon = navigation.find(([id]) => id === current)?.[3] ?? IconFileText;

  return (
    <div className="legal-shell app-safe-top min-h-screen">
      <header className="legal-header border-b border-white/[0.08] bg-black/80 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[72px] w-full max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
          <a
            className="flex min-h-11 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0A84FF]/40"
            href={PUBLIC_ROUTES.home}
            aria-label={`${BRAND_NAME} home`}
          >
            <LogoMark size={36} />
            <span className="display-h text-[18px] text-white">{BRAND_NAME}</span>
          </a>
          <a className="btn btn-ghost btn-sm min-h-11" href={PUBLIC_ROUTES.home}>
            Open wallet
          </a>
        </div>
      </header>

      <main id="app-content" className="mx-auto w-full max-w-5xl px-5 pb-8 pt-10 sm:px-8 sm:pt-16">
        <div className="legal-hero">
          <div className="legal-route-icon" aria-hidden="true">
            <ActiveRouteIcon size={29} />
          </div>
          <div className="min-w-0">
            <p className="eyebrow">{eyebrow}</p>
            <h1 className="display-h mt-3 text-[36px] text-white sm:text-[52px]">{title}</h1>
            <p className="mt-5 max-w-[65ch] text-[16px] leading-7 text-neutral-300">{summary}</p>
            <p className="mt-4 text-[12px] text-neutral-500">
              Effective 28 August 2026 · Legal text version 1.1
            </p>
          </div>
        </div>

        <nav
          aria-label="Legal navigation"
          className="mt-9 grid grid-cols-2 gap-2 rounded-2xl bg-white/[0.05] p-1.5 sm:inline-grid sm:grid-cols-5"
        >
          {navigation.map(([id, label, href, RouteIcon]) => (
            <a
              key={id}
              href={href}
              aria-current={current === id ? "page" : undefined}
              className={`flex min-h-11 items-center justify-center rounded-xl px-4 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0A84FF]/40 ${
                current === id
                  ? "bg-white/[0.12] text-white"
                  : "text-neutral-400 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              <span className="legal-nav-icon" aria-hidden="true">
                <RouteIcon size={16} />
              </span>
              <span className="legal-nav-label">{label}</span>
            </a>
          ))}
        </nav>

        <div className="mt-10 max-w-3xl">
          <aside aria-label="At a glance" className="legal-highlights">
            <div className="legal-block-heading">
              <span aria-hidden="true">
                <IconCheck size={16} />
              </span>
              <p>At a glance</p>
            </div>
            <ul>
              {highlights.map((highlight) => (
                <li key={highlight}>
                  <span className="legal-highlight-icon" aria-hidden="true">
                    <IconCheck size={14} />
                  </span>
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          </aside>

          <nav aria-label="On this page" className="legal-contents">
            <div className="legal-block-heading">
              <span aria-hidden="true">
                <IconList size={16} />
              </span>
              <p>On this page</p>
            </div>
            <ol>
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    <span className="legal-section-number" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="legal-section-label">{section.label}</span>
                    <span className="legal-link-chevron" aria-hidden="true">
                      <IconChevronDown size={14} />
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <article className="legal-prose mt-12">{children}</article>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
