import {
  COPYRIGHT_OWNER,
  COPYRIGHT_YEAR,
  PUBLIC_ROUTES,
  SOURCE_REPOSITORY_URL,
} from "@/lib/brand";

export function PublicFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer
      className={`mx-auto w-full max-w-3xl text-center text-neutral-400 ${compact ? "px-2 py-5" : "px-5 py-10"}`}
    >
      <nav
        aria-label="Legal"
        className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] font-medium"
      >
        <a className="link min-h-11 content-center" href={PUBLIC_ROUTES.about}>About</a>
        <a className="link min-h-11 content-center" href={PUBLIC_ROUTES.privacy}>Privacy</a>
        <a className="link min-h-11 content-center" href={PUBLIC_ROUTES.terms}>Terms</a>
        <a className="link min-h-11 content-center" href={PUBLIC_ROUTES.security}>Security</a>
        <a className="link min-h-11 content-center" href={PUBLIC_ROUTES.support}>Support</a>
        <a className="link min-h-11 content-center" href={PUBLIC_ROUTES.changelog}>Changelog</a>
        <a className="link min-h-11 content-center" href={SOURCE_REPOSITORY_URL}>Source</a>
      </nav>
      <p className="mt-2 text-[11.5px]">
        © {COPYRIGHT_YEAR} {COPYRIGHT_OWNER}. All rights reserved.
      </p>
      <p className="mx-auto mt-2 max-w-2xl text-[10.5px] leading-relaxed text-neutral-500">
        This is an independent project, not affiliated with, sponsored or endorsed by the Stellar
        Development Foundation. “Stellar” is a trademark of the Stellar Development Foundation.
      </p>
    </footer>
  );
}
