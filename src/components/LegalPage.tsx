import type { ReactNode } from "react";
import { BRAND_NAME, PUBLIC_ROUTES } from "@/lib/brand";
import { LogoMark } from "./icons";
import { PublicFooter } from "./PublicFooter";

const navigation = [
  ["about", "About", PUBLIC_ROUTES.about],
  ["privacy", "Privacy", PUBLIC_ROUTES.privacy],
  ["terms", "Terms", PUBLIC_ROUTES.terms],
  ["security", "Security", PUBLIC_ROUTES.security],
  ["support", "Support", PUBLIC_ROUTES.support],
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
  return (
    <div className="app-safe-top min-h-screen">
      <header className="border-b border-white/[0.08] bg-black/80 backdrop-blur-xl">
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
        <div className="max-w-3xl">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="display-h mt-3 text-[36px] text-white sm:text-[52px]">{title}</h1>
          <p className="mt-5 max-w-[65ch] text-[16px] leading-7 text-neutral-300">{summary}</p>
          <p className="mt-4 text-[12px] text-neutral-500">
            Effective 28 August 2026 · Legal text version 1.1
          </p>
        </div>

        <nav
          aria-label="Legal navigation"
          className="mt-9 grid grid-cols-2 gap-2 rounded-2xl bg-white/[0.05] p-1.5 sm:inline-grid sm:grid-cols-5"
        >
          {navigation.map(([id, label, href]) => (
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
              {label}
            </a>
          ))}
        </nav>

        <div className="mt-10 max-w-3xl">
          <aside aria-label="At a glance" className="legal-highlights">
            <p>At a glance</p>
            <ul>
              {highlights.map((highlight) => (
                <li key={highlight}>{highlight}</li>
              ))}
            </ul>
          </aside>

          <nav aria-label="On this page" className="legal-contents">
            <p>On this page</p>
            <ol>
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    {section.label}
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
